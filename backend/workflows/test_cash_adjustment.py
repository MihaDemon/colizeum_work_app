import uuid
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier

from django.contrib.auth import get_user_model
from django.db import close_old_connections, connections
from django.test import TransactionTestCase, skipUnlessDBFeature
from rest_framework.test import APIClient, APITestCase

from reports.models import CashRegister, Expenses, Report
from .models import Activity

User = get_user_model()


class CashAdjustmentTests(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_superuser(username='owner')
        self.admin = User.objects.create_user(username='administrator')
        self.manager = User.objects.create_user(username='manager', is_staff=True)
        CashRegister.objects.create(balance='1000.00')

    def change(self, **data):
        return self.client.post('/api/cash-adjustment/', {
            'balance': '1234.56', 'expected_balance': '1000.00', **data,
        }, format='json', HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()))

    def test_only_superuser_can_correct_cash_and_change_is_in_activity(self):
        for user in (self.admin, self.manager):
            self.client.force_authenticate(user)
            self.assertEqual(self.change().status_code, 403)
        self.client.force_authenticate(self.owner)
        response = self.change()
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['balance'], '1234.56')
        self.assertEqual(CashRegister.get_default().balance, Decimal('1234.56'))
        entry = Activity.objects.get(kind='cash')
        self.assertEqual(entry.actor_id, self.owner.pk)
        self.assertEqual(entry.title, 'Остаток кассы изменён')
        self.assertIn('1\xa0000,00', entry.description)
        self.assertIn('1\xa0234,56', entry.description)
        self.assertFalse(Report.objects.exists())
        self.assertFalse(Expenses.objects.exists())

    def test_retries_do_not_overwrite_later_expense(self):
        self.client.force_authenticate(self.owner)
        body = {'balance': '1234.56', 'expected_balance': '1000.00'}
        key = str(uuid.uuid4())
        first = self.client.post('/api/cash-adjustment/', body, HTTP_IDEMPOTENCY_KEY=key)
        Expenses.objects.create(admin=self.admin, amount='100', info='Средства для уборки')
        again = self.client.post('/api/cash-adjustment/', body, HTTP_IDEMPOTENCY_KEY=key)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(again.data, first.data)
        self.assertEqual(CashRegister.get_default().balance, Decimal('1134.56'))
        self.assertEqual(Activity.objects.filter(kind='cash').count(), 1)
        self.assertEqual(self.change().status_code, 409)
        self.assertEqual(CashRegister.get_default().balance, Decimal('1134.56'))

    def test_invalid_amounts_and_missing_current_balance_do_not_change_cash(self):
        self.client.force_authenticate(self.owner)
        for invalid in ('-1', 'NaN', 'Infinity', '0.001', '1000000000000000000.00', 'foo'):
            response = self.change(balance=invalid)
            self.assertEqual(response.status_code, 400, response.data)
        response = self.client.post('/api/cash-adjustment/', {'balance': '0'}, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(CashRegister.get_default().balance, Decimal('1000.00'))
        self.assertEqual(self.change(balance='0').status_code, 200)
        self.assertEqual(CashRegister.get_default().balance, Decimal('0.00'))


class CashAdjustmentConcurrencyTests(TransactionTestCase):
    @skipUnlessDBFeature('has_select_for_update')
    def test_two_corrections_from_same_balance_cannot_both_succeed(self):
        owner = User.objects.create_superuser(username='owner')
        CashRegister.objects.create(balance='1000.00')
        barrier = Barrier(2)

        def change(value):
            close_old_connections()
            try:
                client = APIClient()
                client.force_authenticate(User.objects.get(pk=owner.pk))
                barrier.wait(timeout=10)
                return client.post('/api/cash-adjustment/', {
                    'balance': value, 'expected_balance': '1000.00',
                }, HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4())).status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(change, ['1200.00', '1400.00']))
        self.assertCountEqual(statuses, [200, 409])
        self.assertEqual(Activity.objects.filter(kind='cash').count(), 1)
