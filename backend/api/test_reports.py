from django.test import override_settings
from decimal import Decimal
import tempfile
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from reports.models import CashRegister, Expenses, Report
from reports.tests import photo


@override_settings(ENABLE_LEGACY_FINANCIAL_WRITES=True)
class FinancialApiTests(APITestCase):
    def setUp(self):
        self.media = tempfile.TemporaryDirectory()
        self.settings = override_settings(MEDIA_ROOT=self.media.name)
        self.settings.enable()
        self.addCleanup(self.media.cleanup)
        self.addCleanup(self.settings.disable)
        self.user = get_user_model().objects.create(username='worker', telegram_id='42')
        self.client.force_authenticate(self.user)

    def report(self, **values):
        return self.client.post('/api/reports/', {
            'date': '2026-10-11', 'shift': 'night',
            'cards': '10.00', 'spb': '5.00', 'cash': '100.25',
            'uploaded_photos': [photo()], **values,
        }, format='multipart')

    def test_report_crud_with_explicit_date_and_cash_accounting(self):
        created = self.report(admin=999)
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(created.data['admin'], self.user.pk)
        self.assertNotIn('remaining_cash', created.data)
        self.assertNotIn('encashment', created.data)
        self.assertEqual(len(created.data['photos']), 1)
        self.assertEqual(CashRegister.get_default().balance, Decimal('100.25'))
        url = f"/api/reports/{created.data['id']}/"
        updated = self.client.patch(url, {'cash': '150.30', 'date': '2026-10-10'})
        self.assertEqual(updated.status_code, 200, updated.data)
        self.assertEqual(updated.data['date'], '2026-10-10')
        self.assertEqual(CashRegister.get_default().balance, Decimal('150.30'))
        self.assertEqual(self.client.get('/api/reports/').status_code, 200)
        self.assertEqual(self.client.delete(url).status_code, 204)
        self.assertEqual(CashRegister.get_default().balance, Decimal('0.00'))

    def test_required_date_and_photo_fail_without_changing_balance(self):
        response = self.client.post('/api/reports/', {'uploaded_photos': [photo()]}, format='multipart')
        self.assertEqual(response.status_code, 400)
        self.assertIn('date', response.data)
        response = self.client.post('/api/reports/', {'date': '2026-10-11'})
        self.assertEqual(response.status_code, 400)
        self.assertIn('uploaded_photos', response.data)
        self.assertFalse(Report.objects.exists())
        self.assertEqual(CashRegister.get_default().balance, Decimal('0.00'))

    def test_expense_crud_and_funding_source(self):
        response = self.client.post('/api/expenses/', {'amount': '25.15', 'from_register': False, 'info': 'Supplies'})
        self.assertEqual(response.status_code, 201, response.data)
        self.assertFalse(response.data['from_register'])
        self.assertEqual(CashRegister.get_default().balance, Decimal('0.00'))
        Report.objects.create(date=timezone.localdate(), cash='100.00')
        url = f"/api/expenses/{response.data['id']}/"
        response = self.client.patch(url, {'from_register': True, 'amount': '30.20'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(CashRegister.get_default().balance, Decimal('69.80'))
        self.assertEqual(self.client.delete(url).status_code, 204)
        self.assertEqual(CashRegister.get_default().balance, Decimal('100.00'))

    def test_expense_defaults_to_register_and_date_is_read_only(self):
        Report.objects.create(date=timezone.localdate(), cash='100.00')
        response = self.client.post('/api/expenses/', {'amount': '5.00', 'info': 'Supplies', 'date': '2020-01-01T00:00:00Z'})
        self.assertTrue(response.data['from_register'])
        self.assertFalse(response.data['date'].startswith('2020-01-01'))
        self.assertEqual(CashRegister.get_default().balance, Decimal('95.00'))

    def test_cash_register_read_only_and_authenticated(self):
        response = self.client.get('/api/cash-register/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {'id': 1, 'balance': '0.00'})
        Report.objects.create(date=timezone.localdate(), cash='100.00')
        self.client.post('/api/expenses/', {'amount': '5.25', 'info': 'Supplies'})
        self.assertEqual(self.client.get('/api/cash-register/').data['balance'], '94.75')
        self.assertEqual(self.client.post('/api/cash-register/', {'balance': '50'}).status_code, 405)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get('/api/cash-register/').status_code, 401)

    def test_photo_failure_rolls_back_record_and_cash_balance(self):
        with patch('api.serializers.FinancialRecordSerializer.save_photos', side_effect=RuntimeError('Failed upload')):
            with self.assertRaises(RuntimeError):
                self.report()
        self.assertFalse(Report.objects.exists())
        self.assertEqual(CashRegister.get_default().balance, Decimal('0.00'))

    def test_last_report_photo_cannot_be_deleted(self):
        response = self.report()
        image_id = response.data['photos'][0]['id']
        response = self.client.delete(f'/api/report-photos/{image_id}/')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Report.objects.get().photos.count(), 1)

    def test_report_date_rejects_datetime_values(self):
        response = self.report(date='2026-10-11T20:00:00+03:00')
        self.assertEqual(response.status_code, 400)
        self.assertIn('date', response.data)
        self.assertFalse(Report.objects.exists())

    def test_expense_description_is_required_and_cannot_be_cleared(self):
        for payload in ({'amount': '5.00'}, {'amount': '5.00', 'info': ''},
                        {'amount': '5.00', 'info': '   '}, {'amount': '5.00', 'info': None}):
            response = self.client.post('/api/expenses/', payload, format='json')
            self.assertEqual(response.status_code, 400, response.data)
            self.assertIn('info', response.data)
        self.assertFalse(Expenses.objects.exists())
        self.assertEqual(CashRegister.get_default().balance, Decimal('0.00'))
        Report.objects.create(date=timezone.localdate(), cash='100.00')
        created = self.client.post('/api/expenses/', {'amount': '5.00', 'info': 'Supplies'})
        url = f"/api/expenses/{created.data['id']}/"
        self.assertEqual(self.client.patch(url, {'info': ''}).status_code, 400)
        self.assertEqual(self.client.patch(url, {'amount': '10.00'}).status_code, 200)
        self.assertEqual(Expenses.objects.get().info, 'Supplies')

    def test_overspending_returns_validation_error_without_creating_expense(self):
        response = self.client.post('/api/expenses/', {'amount': '0.01', 'info': 'Supplies'})
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn('Недостаточно наличных', str(response.data))
        self.assertFalse(Expenses.objects.exists())
        self.assertEqual(CashRegister.get_default().balance, Decimal('0.00'))

    def test_spent_report_cannot_be_reduced_or_deleted_through_api(self):
        created = self.report()
        report = Report.objects.get(pk=created.data['id'])
        Expenses.objects.create(amount='100.00', info='Supplies')
        url = f'/api/reports/{report.pk}/'
        response = self.client.patch(url, {'cash': '99.99'})
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(self.client.delete(url).status_code, 400)
        report.refresh_from_db()
        self.assertEqual(report.cash, Decimal('100.25'))
        self.assertEqual(report.photos.count(), 1)
        self.assertEqual(CashRegister.get_default().balance, Decimal('0.25'))

    def test_negative_payment_and_expense_amounts_are_rejected(self):
        for field in ('cards', 'spb', 'cash'):
            response = self.report(**{field: '-0.01'})
            self.assertEqual(response.status_code, 400)
            self.assertIn(field, response.data)
        response = self.client.post('/api/expenses/', {
            'amount': '-0.01', 'from_register': False, 'info': 'Supplies',
        })
        self.assertEqual(response.status_code, 400)
        self.assertIn('amount', response.data)
