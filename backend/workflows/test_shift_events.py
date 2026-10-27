import json
import tempfile
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from io import BytesIO
from threading import Barrier
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from django.contrib.auth import get_user_model
from django.db import close_old_connections, connections, IntegrityError, transaction
from django.test import TransactionTestCase, override_settings, skipUnlessDBFeature
from django.utils import timezone
from rest_framework.test import APITestCase, APIClient

from reports.models import CashRegister, Report
from .models import CleanerVisit, Shift, TelegramNotification
from .notifications import deliver_one, telegram_send, DeliveryError
from .tests import photo

User = get_user_model()


@override_settings(TELEGRAM_BOT_TOKEN='test-token', WEBAPP_URL='https://work.invalid/?club=perovo&shift=999')
class ShiftEventTests(APITestCase):
    def setUp(self):
        self.media = tempfile.TemporaryDirectory()
        override = override_settings(MEDIA_ROOT=self.media.name)
        override.enable()
        self.addCleanup(self.media.cleanup)
        self.addCleanup(override.disable)
        self.admin = User.objects.create_user(username='administrator', first_name='Иван', telegram_id='100')
        self.other = User.objects.create_user(username='other', telegram_id='101')
        self.manager = User.objects.create_user(username='manager', is_staff=True, telegram_id='102')
        self.manager2 = User.objects.create_user(username='manager2', is_staff=True, telegram_id='103')
        self.owner = User.objects.create_superuser(username='owner', telegram_id='104')
        User.objects.create_user(username='disabled', is_staff=True, is_active=False, telegram_id='105')
        User.objects.create_user(username='unlinked', is_staff=True)
        CashRegister.objects.create(balance=1000)
        self.client.force_authenticate(self.admin)

    def open(self, key=None):
        response = self.client.post('/api/shifts/open/', {'shift_type': 'day'}, HTTP_IDEMPOTENCY_KEY=key or str(uuid.uuid4()))
        self.assertEqual(response.status_code, 201, response.data)
        return response.data['id']

    def close(self, pk):
        response = self.client.post(f'/api/shifts/{pk}/close/', {'cash': '100', 'cards': '200', 'sbp': '300', 'desk_photo': photo(), 'receipt_photo': photo()})
        self.assertEqual(response.status_code, 200, response.data)

    def assert_recipients(self, kind):
        self.assertCountEqual(TelegramNotification.objects.filter(kind=kind).values_list('recipient_id', flat=True), [self.manager.pk, self.manager2.pk, self.owner.pk])

    def test_shift_and_expense_notify_every_active_linked_manager_and_superuser(self):
        with patch('workflows.notifications.urlopen') as network:
            pk = self.open()
            expense = self.client.post('/api/shift-expenses/', {'amount': '125', 'description': 'Средства для уборки'})
            self.assertEqual(expense.status_code, 201)
            self.close(pk)
            network.assert_not_called()
        for kind in ('shift_open', 'shift_close', 'expense'):
            self.assert_recipients(kind)
        message = TelegramNotification.objects.filter(kind='shift_close').first().message
        for fragment in ('Иван', 'Итого: 600,00 ₽', 'Наличные в кассе: 975,00 ₽', 'Тип: День'):
            self.assertIn(fragment, message)
        self.assertIn('Средства для уборки', TelegramNotification.objects.filter(kind='expense').first().message)

    def test_cleaner_needs_confirmation_owner_and_active_shift_and_is_once_per_shift(self):
        pk = self.open()
        path = f'/api/shifts/{pk}/cleaner/'
        for body in ({}, {'confirmed': False}):
            self.assertEqual(self.client.post(path, body).status_code, 400)
        for user, status in ((self.other, 409), (self.manager, 403), (self.owner, 403)):
            self.client.force_authenticate(user)
            self.assertEqual(self.client.post(path, {'confirmed': True}).status_code, status)
        self.client.force_authenticate(self.admin)
        key = str(uuid.uuid4())
        with patch('django.utils.timezone.now', return_value=datetime.fromisoformat('2026-10-31T21:05:00+00:00')):
            response = self.client.post(path, {'confirmed': True}, HTTP_IDEMPOTENCY_KEY=key)
        self.assertEqual(response.status_code, 201)
        again = self.client.post(path, {'confirmed': True}, HTTP_IDEMPOTENCY_KEY=key)
        self.assertEqual(again.data, response.data)
        self.assertEqual(self.client.post(path, {'confirmed': True}).status_code, 409)
        self.assertEqual(CleanerVisit.objects.count(), 1)
        self.assert_recipients('cleaner')
        self.assertEqual(TelegramNotification.objects.filter(kind='cleaner').first().message, 'Уборщица пришла 01/11/26 00:05')
        self.assertEqual(self.client.get('/api/workspace/').data['state']['shift']['cleanerVisitedAt'], response.data['occurredAt'])
        self.close(pk)
        self.assertEqual(self.client.post(path, {'confirmed': True}).status_code, 409)
        new = self.open()
        self.assertIsNone(self.client.get('/api/workspace/').data['state']['shift']['cleanerVisitedAt'])
        self.assertEqual(self.client.post(f'/api/shifts/{new}/cleaner/', {'confirmed': True}).status_code, 201)
        self.assertEqual(CleanerVisit.objects.count(), 2)

    def test_replayed_shift_and_expense_commands_do_not_duplicate_notifications(self):
        key = str(uuid.uuid4())
        pk = self.open(key)
        self.assertEqual(self.open(key), pk)
        key = str(uuid.uuid4())
        for _ in range(2):
            self.assertEqual(self.client.post('/api/shift-expenses/', {'amount': '10', 'description': 'Уборка'}, HTTP_IDEMPOTENCY_KEY=key).status_code, 201)
        self.assert_recipients('shift_open')
        self.assert_recipients('expense')
        self.assertEqual(CashRegister.get_default().balance, 990)

    def test_notification_buttons_link_to_exact_shift_expense_and_cleaner_month(self):
        pk = self.open()
        self.client.post(f'/api/shifts/{pk}/cleaner/', {'confirmed': True})
        expense = self.client.post('/api/shift-expenses/', {'amount': 10, 'description': 'Уборка'}).data['id']
        self.close(pk)
        for kind, query, ident in [('shift_open', 'shift', pk), ('shift_close', 'shift', pk), ('expense', 'expense', expense), ('cleaner', 'cleaner', timezone.localtime().strftime('%Y-%m'))]:
            job = TelegramNotification.objects.filter(kind=kind).first()
            with patch('workflows.notifications.urlopen') as send:
                send.return_value.__enter__.return_value = BytesIO(b'{"ok":true}')
                telegram_send(job.recipient, job)
            payload = json.loads(send.call_args.args[0].data)
            url = payload['reply_markup']['inline_keyboard'][0][0]['web_app']['url']
            self.assertEqual(parse_qs(urlsplit(url).query), {'club': ['perovo'], query: [str(ident)]})
            self.assertEqual(payload['text'], job.message)

    def test_event_delivery_retries_without_changing_record(self):
        pk = self.open()
        def fail(*args):
            raise DeliveryError('Временная ошибка Telegram.')
        self.assertTrue(deliver_one(fail))
        job = TelegramNotification.objects.get(attempts=1)
        self.assertEqual(job.status, 'pending')
        TelegramNotification.objects.filter(pk=job.pk).update(next_attempt_at=timezone.now())
        sent = []
        while deliver_one(lambda recipient, event: sent.append(event.kind)):
            pass
        self.assertEqual(sent, ['shift_open'] * 3)
        self.assertEqual(Shift.objects.count(), 1)
        self.assertEqual(str(Shift.objects.get().pk), pk)

    def test_details_enforce_scope_and_show_report_and_all_photos(self):
        pk = self.open()
        expense = self.client.post('/api/shift-expenses/', {'amount': 10, 'description': 'Уборка', 'photo': photo()}).data['id']
        self.close(pk)
        for user in (self.admin, self.manager, self.owner):
            self.client.force_authenticate(user)
            detail = self.client.get(f'/api/shifts/{pk}/')
            self.assertEqual(detail.status_code, 200)
            self.assertEqual(detail.data['total'], '600.00')
            self.assertEqual(len(detail.data['photos']), 2)
            record = self.client.get(f'/api/shift-expenses/{expense}/')
            self.assertEqual(record.status_code, 200)
            self.assertEqual(record.data['adminName'], 'Иван')
            self.assertEqual(len(record.data['photos']), 1)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(f'/api/shifts/{pk}/').status_code, 404)
        self.assertEqual(self.client.get(f'/api/shift-expenses/{expense}/').status_code, 404)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(f'/api/shifts/{pk}/').status_code, 401)
        self.assertEqual(self.client.get('/api/cleaner-visits/').status_code, 401)

    def test_month_filter_uses_moscow_time_and_history_survives_user_deletion(self):
        for admin, stamp in ((self.admin, '2026-10-31T20:59:00+00:00'), (self.admin, '2026-10-31T21:00:00+00:00'), (self.other, '2026-10-15T12:00:00+00:00')):
            report = Report.objects.create(admin=admin, date=timezone.localdate(), cash=0)
            shift = Shift.objects.create(admin=admin, shift_type='day', report=report, closed_at=timezone.now())
            CleanerVisit.objects.create(admin=admin, shift=shift, occurred_at=datetime.fromisoformat(stamp))
        self.assertEqual(len(self.client.get('/api/cleaner-visits/?year=2026&month=10').data['results']), 1)
        self.assertEqual(len(self.client.get('/api/cleaner-visits/?year=2026&month=11').data['results']), 1)
        for user in (self.manager, self.owner):
            self.client.force_authenticate(user)
            self.assertEqual(len(self.client.get('/api/cleaner-visits/?year=2026&month=10').data['results']), 2)
        for params in ('year=no&month=10', 'year=2026&month=13'):
            self.assertEqual(self.client.get('/api/cleaner-visits/?' + params).status_code, 400)
        self.admin.delete()
        rows = self.client.get('/api/cleaner-visits/?year=2026&month=10').data['results']
        self.assertTrue(any(row['adminName'] == 'Иван (удалён)' for row in rows))
        self.assertEqual(CashRegister.get_default().balance, 1000)

    def test_notification_failure_rolls_back_cleaner_record_and_duplicate_constraint(self):
        pk = self.open()
        with patch('workflows.services.queue_management', side_effect=RuntimeError('test')):
            with self.assertRaises(RuntimeError):
                self.client.post(f'/api/shifts/{pk}/cleaner/', {'confirmed': True})
        self.assertFalse(CleanerVisit.objects.exists())
        self.client.post(f'/api/shifts/{pk}/cleaner/', {'confirmed': True})
        with self.assertRaises(IntegrityError), transaction.atomic():
            CleanerVisit.objects.create(shift_id=pk, admin=self.admin)

    def test_demoted_manager_does_not_receive_queued_financial_details(self):
        self.open()
        TelegramNotification.objects.exclude(recipient=self.manager).delete()
        self.manager.is_staff = False
        self.manager.save(update_fields=['is_staff'])
        with patch('workflows.notifications.telegram_send') as send:
            self.assertTrue(deliver_one(send))
            send.assert_not_called()
        self.assertEqual(TelegramNotification.objects.get().status, 'failed')


class CleanerConcurrencyTests(TransactionTestCase):
    @skipUnlessDBFeature('has_select_for_update')
    def test_simultaneous_cleaner_marks_create_one_record_and_notification_per_recipient(self):
        CashRegister.objects.create(balance=0)
        admin = User.objects.create_user(username='administrator')
        User.objects.create_superuser(username='owner', telegram_id='100')
        shift = Shift.objects.create(admin=admin, shift_type='day')
        barrier = Barrier(2)
        def worker(_):
            close_old_connections()
            client = APIClient()
            client.force_authenticate(admin)
            barrier.wait(timeout=10)
            try:
                return client.post(f'/api/shifts/{shift.pk}/cleaner/', {'confirmed': True}, HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4())).status_code
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertCountEqual(list(pool.map(worker, range(2))), [201, 409])
        self.assertEqual(CleanerVisit.objects.count(), 1)
        self.assertEqual(TelegramNotification.objects.filter(kind='cleaner').count(), 1)
