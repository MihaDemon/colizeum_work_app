import hashlib
import hmac
import json
import tempfile
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from threading import Barrier
from urllib.parse import urlencode

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import close_old_connections, connections
from django.test import TransactionTestCase, override_settings, skipUnlessDBFeature
from django.utils import timezone
from PIL import Image
from rest_framework.test import APITestCase, APIClient

from reports.models import CashRegister, Expenses, Report
from users.models import AdminUser
from .models import Shift, Task, TaskSubmission, TelegramNotification
from .notifications import DeliveryError, deliver_one
from .services import open_shift, Conflict

User = get_user_model()


def photo(name='photo.png'):
    stream = BytesIO()
    Image.new('RGB', (2, 2), 'white').save(stream, format='PNG')
    return SimpleUploadedFile(name, stream.getvalue(), content_type='image/png')


class WorkflowTests(APITestCase):
    def setUp(self):
        self.media = tempfile.TemporaryDirectory()
        self.settings_override = override_settings(MEDIA_ROOT=self.media.name, BOT_SERVICE_TOKEN='test-service')
        self.settings_override.enable()
        self.addCleanup(self.settings_override.disable)
        self.addCleanup(self.media.cleanup)
        self.admin = User.objects.create_user(username='admin', telegram_id='101')
        self.other = User.objects.create_user(username='other', telegram_id='102')
        self.manager = User.objects.create_user(username='manager', is_staff=True, telegram_id='103')
        self.manager2 = User.objects.create_user(username='manager2', is_staff=True, telegram_id='104')
        self.owner = User.objects.create_superuser(username='owner', password='test-password', telegram_id='105')
        CashRegister.objects.create(balance=1000)
        self.client.force_authenticate(self.admin)

    def act_as(self, user):
        self.client.force_authenticate(user)

    def open(self, kind='night'):
        response = self.client.post('/api/shifts/open/', {'shift_type': kind})
        self.assertEqual(response.status_code, 201, response.data)
        return response.data['id']

    def create_task(self, target=None, required=False):
        self.act_as(self.manager)
        response = self.client.post('/api/tasks/', {'title': 'Clean desk', 'description': 'Wipe the entire desk', 'assignee': (target or self.admin).pk, 'requires_photo': required})
        self.assertEqual(response.status_code, 201, response.data)
        return response.data['id']

    def close_data(self):
        return {'cash': '100.10', 'cards': '200.20', 'sbp': '300.30', 'desk_photo': photo('desk.png'), 'receipt_photo': photo('receipt.png')}

    def test_shift_lock_ownership_and_opening_type(self):
        pk = self.open()
        self.act_as(self.other)
        self.assertEqual(self.client.post('/api/shifts/open/', {'shift_type': 'day'}).status_code, 409)
        self.assertEqual(self.client.post(f'/api/shifts/{pk}/close/', self.close_data()).status_code, 409)
        self.act_as(self.admin)
        bad = self.close_data()
        bad['shift_type'] = 'day'
        self.assertEqual(self.client.post(f'/api/shifts/{pk}/close/', bad).status_code, 400)
        self.assertEqual(self.client.post(f'/api/shifts/{pk}/close/', self.close_data()).status_code, 200)
        shift = Shift.objects.get(pk=pk)
        self.assertEqual(shift.report.shift, 'night')
        self.assertEqual(str(shift.report.cash), '100.10')
        self.assertEqual(shift.report.photos.count(), 2)
        self.assertEqual(str(CashRegister.objects.get().balance), '1100.10')
        self.assertEqual(self.client.post(f'/api/shifts/{pk}/close/', self.close_data()).status_code, 409)
        self.act_as(self.other)
        self.open('day')

    def test_close_requires_named_photos_and_nonnegative_amounts(self):
        pk = self.open()
        self.assertEqual(self.client.post(f'/api/shifts/{pk}/close/', {'cash': 1, 'cards': 0, 'sbp': 0}).status_code, 400)
        data = self.close_data()
        data['cash'] = '-1'
        self.assertEqual(self.client.post(f'/api/shifts/{pk}/close/', data).status_code, 400)
        self.assertEqual(Report.objects.count(), 0)
        self.assertIsNone(Shift.objects.get(pk=pk).closed_at)

    def test_expense_cash_only_text_required_optional_photo_and_balance_guard(self):
        self.assertEqual(self.client.post('/api/shift-expenses/', {'amount': 1, 'description': 'Supplies'}).status_code, 409)
        self.open()
        for data in [{'amount': 0, 'description': 'zero'}, {'amount': 1}, {'amount': 1, 'description': ' '}]:
            self.assertEqual(self.client.post('/api/shift-expenses/', data).status_code, 400)
        self.assertEqual(self.client.post('/api/shift-expenses/', {'amount': '1200', 'description': 'Too much'}).status_code, 400)
        self.assertEqual(Expenses.objects.count(), 0)
        response = self.client.post('/api/shift-expenses/', {'amount': '12.34', 'description': 'Supplies', 'photo': photo(), 'from_register': False})
        self.assertEqual(response.status_code, 201)
        self.assertTrue(Expenses.objects.get().from_register)
        self.assertEqual(str(CashRegister.objects.get().balance), '987.66')
        self.act_as(self.manager)
        self.assertEqual(self.client.post('/api/shift-expenses/', {'amount': 1, 'description': 'No own shift'}).status_code, 403)

    def test_task_required_evidence_moderation_rejection_resubmission_and_acceptance(self):
        shift = self.open()
        pk = self.create_task(required=True)
        self.act_as(self.admin)
        self.assertEqual(self.client.post(f'/api/tasks/{pk}/submit/', {'note': 'done'}).status_code, 409)
        self.assertEqual(self.client.post(f'/api/tasks/{pk}/submit/', {'note': 'done', 'photo': photo()}).status_code, 200)
        workspace = self.client.get('/api/workspace/').data
        self.assertEqual(workspace['state']['tasks'][0]['status'], 'moderation')
        self.assertEqual(TelegramNotification.objects.count(), 1)
        self.assertEqual(self.client.post(f'/api/tasks/{pk}/submit/').status_code, 409)
        self.act_as(self.manager2)
        self.assertEqual(self.client.post(f'/api/tasks/{pk}/review/', {'accept': True, 'version': 1}).status_code, 404)
        self.act_as(self.manager)
        self.assertEqual(self.client.post(f'/api/tasks/{pk}/review/', {'accept': False, 'version': 1}).status_code, 400)
        self.assertEqual(self.client.post(f'/api/tasks/{pk}/review/', {'accept': False, 'reason': 'Clean the corners', 'version': 1}).status_code, 200)
        self.act_as(self.admin)
        self.assertEqual(self.client.post(f'/api/shifts/{shift}/close/', self.close_data()).status_code, 200)
        task = Task.objects.get(pk=pk)
        self.assertIsNone(task.shift_id)  # Unfinished work follows the recipient to their next shift.
        self.open()
        self.assertEqual(self.client.post(f'/api/tasks/{pk}/submit/', {'note': 'corrected'}).status_code, 200)  # Prior photo may be reused.
        self.act_as(self.manager)
        self.assertEqual(self.client.post(f'/api/tasks/{pk}/review/', {'accept': True, 'version': 1}).status_code, 409)
        self.assertEqual(self.client.post(f'/api/tasks/{pk}/review/', {'accept': True, 'version': 2}).status_code, 200)
        self.assertEqual(TaskSubmission.objects.filter(task_id=pk).count(), 2)
        self.assertEqual(TelegramNotification.objects.count(), 2)
        self.assertEqual(Task.objects.get(pk=pk).status, 'accepted')

    def test_assignment_roles_and_manager_personal_tasks_without_shift(self):
        self.act_as(self.manager)
        self.assertEqual(self.client.post('/api/tasks/', {'title': 'No shift', 'assignee': self.admin.pk}).status_code, 403)
        self.act_as(self.owner)
        for target in [self.owner]:
            self.assertEqual(self.client.post('/api/tasks/', {'title': 'Self', 'assignee': target.pk}).status_code, 403)
        response = self.client.post('/api/tasks/', {'title': 'Manager report', 'assignee': self.manager.pk})
        self.assertEqual(response.status_code, 201)
        pk = response.data['id']
        self.act_as(self.manager)
        self.assertEqual(self.client.post(f'/api/tasks/{pk}/submit/', {'note': 'ready'}).status_code, 200)
        self.assertEqual(self.client.post(f'/api/tasks/{pk}/review/', {'accept': True, 'version': 1}).status_code, 403)
        self.act_as(self.owner)
        self.assertEqual(self.client.post(f'/api/tasks/{pk}/submit/').status_code, 403)
        self.assertEqual(self.client.post(f'/api/tasks/{pk}/review/', {'accept': True, 'version': 1}).status_code, 200)
        response = self.client.post('/api/tasks/', {'title': 'Prepare stations', 'assignee': self.other.pk})
        self.assertEqual(response.status_code, 201)
        self.act_as(self.other)
        self.assertEqual(self.client.post(f"/api/tasks/{response.data['id']}/submit/").status_code, 409)

    def test_manager_cannot_assign_other_staff_or_managers(self):
        self.open()
        self.act_as(self.manager)
        for target in [self.other, self.manager2, self.owner]:
            self.assertEqual(self.client.post('/api/tasks/', {'title': 'Invalid', 'assignee': target.pk}).status_code, 403)
        self.act_as(self.admin)
        self.assertEqual(self.client.post('/api/tasks/', {'title': 'Invalid', 'assignee': self.other.pk}).status_code, 403)

    def test_private_evidence_and_scoped_history(self):
        shift = self.open()
        pk = self.create_task(required=True)
        self.act_as(self.admin)
        self.client.post(f'/api/tasks/{pk}/submit/', {'photo': photo()})
        self.client.post(f'/api/shifts/{shift}/close/', self.close_data())
        submission = TaskSubmission.objects.get()
        endpoint = f'/api/files/submission/{submission.pk}/'
        self.assertEqual(self.client.get(endpoint).status_code, 200)
        self.act_as(self.other)
        self.assertEqual(self.client.get(endpoint).status_code, 404)
        workspace = self.client.get('/api/workspace/').data
        self.assertEqual(workspace['state']['shifts'], [])
        self.assertEqual(workspace['state']['tasks'], [])
        self.act_as(self.manager2)
        self.assertEqual(self.client.get(endpoint).status_code, 404)
        history = self.client.get('/api/workspace/').data['state']['shifts']
        self.assertEqual(history[0]['total'], '600.60')
        self.act_as(self.owner)
        self.assertEqual(self.client.get(endpoint).status_code, 200)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(endpoint).status_code, 401)
        self.assertEqual(self.client.get('/media/tasks/completion/test.png').status_code, 404)

    def test_legacy_endpoints_cannot_bypass_workflow(self):
        shift = self.open()
        self.assertEqual(self.client.post('/api/expenses/', {'amount': 1, 'info': 'bypass', 'from_register': False}).status_code, 403)
        self.client.post(f'/api/shifts/{shift}/close/', self.close_data())
        report = Report.objects.get()
        self.assertEqual(self.client.patch(f'/api/reports/{report.pk}/', {'cash': '999'}, format='json').status_code, 403)
        self.assertEqual(self.client.delete(f'/api/report-photos/{report.photos.first().pk}/').status_code, 403)

    def test_idempotent_money_and_same_key_payload_conflict(self):
        key = str(uuid.uuid4())
        first = self.client.post('/api/shifts/open/', {'shift_type': 'night'}, HTTP_IDEMPOTENCY_KEY=key)
        again = self.client.post('/api/shifts/open/', {'shift_type': 'night'}, HTTP_IDEMPOTENCY_KEY=key)
        self.assertEqual(first.data, again.data)
        self.assertEqual(Shift.objects.count(), 1)
        key = str(uuid.uuid4())
        for _ in range(2):
            response = self.client.post('/api/shift-expenses/', {'amount': '10.00', 'description': 'Retry-safe'}, HTTP_IDEMPOTENCY_KEY=key)
            self.assertEqual(response.status_code, 201)
        self.assertEqual(Expenses.objects.count(), 1)
        self.assertEqual(CashRegister.objects.get().balance, 990)
        self.assertEqual(self.client.post('/api/shift-expenses/', {'amount': '20.00', 'description': 'Retry-safe'}, HTTP_IDEMPOTENCY_KEY=key).status_code, 409)

    def test_notification_outbox_retries_and_recovers_without_duplicate_jobs(self):
        self.open()
        pk = self.create_task()
        self.act_as(self.admin)
        self.client.post(f'/api/tasks/{pk}/submit/', {'note': 'ready'})
        def fail(recipient, task):
            raise DeliveryError('Telegram HTTP 503.')
        self.assertTrue(deliver_one(send=fail))
        job = TelegramNotification.objects.get()
        self.assertEqual(job.status, 'pending')
        self.assertEqual(job.attempts, 1)
        TelegramNotification.objects.update(next_attempt_at=timezone.now())
        sent = []
        self.assertTrue(deliver_one(send=lambda recipient, task: sent.append((recipient.pk, task.pk))))
        self.assertEqual(sent, [(self.manager.pk, int(pk))])
        self.assertEqual(TelegramNotification.objects.get().status, 'sent')
        self.assertFalse(deliver_one(send=fail))

    def test_bot_contact_binding_needs_shared_secret_and_own_allowlisted_number(self):
        AdminUser.objects.create(phone_number='9991234567')
        payload = {'telegram_id': '500', 'phone_number': '+79991234567'}
        self.assertEqual(self.client.post('/api/bot/contact/', payload).status_code, 403)
        self.assertEqual(self.client.post('/api/bot/contact/', payload, HTTP_X_BOT_SERVICE_TOKEN='test-service').status_code, 200)
        self.assertEqual(AdminUser.objects.get().telegram_id, '500')
        payload['telegram_id'] = '501'
        self.assertEqual(self.client.post('/api/bot/contact/', payload, HTTP_X_BOT_SERVICE_TOKEN='test-service').status_code, 403)


@override_settings(TELEGRAM_BOT_TOKEN='test-bot-token')
class AuthSafetyTests(APITestCase):
    def signed(self, user, age=0):
        fields = {'auth_date': str(int(time.time()) - age), 'user': json.dumps(user)}
        secret = hmac.new(b'WebAppData', b'test-bot-token', hashlib.sha256).digest()
        fields['hash'] = hmac.new(secret, '\n'.join(f'{k}={v}' for k, v in sorted(fields.items())).encode(), hashlib.sha256).hexdigest()
        return urlencode(fields)

    def test_stale_missing_id_and_disabled_accounts(self):
        self.assertEqual(self.client.post('/api/telegram/telegram/', {'initData': self.signed({'id': 3}, age=4000)}).status_code, 403)
        self.assertEqual(self.client.post('/api/telegram/telegram/', {'initData': self.signed({})}).status_code, 400)
        User.objects.create(username='disabled', telegram_id='3', is_active=False)
        self.assertEqual(self.client.post('/api/telegram/telegram/', {'initData': self.signed({'id': 3})}).status_code, 403)

    def test_unverified_phone_does_not_grant_account_access(self):
        AdminUser.objects.create(phone_number='9991234567')
        payload = {'initData': self.signed({'id': 3}), 'username': 'newuser', 'phone_number': '9991234567'}
        self.assertEqual(self.client.post('/api/telegram/telegram/', payload).status_code, 403)
        self.assertFalse(User.objects.exists())

    def test_verified_manager_registration_and_optional_unique_fields(self):
        AdminUser.objects.create(phone_number='9991234567', telegram_id='3', role='manager')
        response = self.client.post('/api/telegram/telegram/', {'initData': self.signed({'id': 3}), 'username': 'manager', 'phone_number': '9991234567'})
        self.assertEqual(response.status_code, 201)
        self.assertTrue(User.objects.get().is_staff)
        User.objects.create(username='second')
        User.objects.create(username='third')


class ShiftConcurrencyTests(TransactionTestCase):
    @skipUnlessDBFeature('has_select_for_update')
    def test_simultaneous_open_only_creates_one_shift(self):
        CashRegister.objects.create(balance=0)
        users = [User.objects.create(username=f'admin{i}') for i in range(2)]
        barrier = Barrier(2)
        def worker(user):
            close_old_connections()
            barrier.wait(timeout=10)
            try:
                open_shift(user, {'shift_type': 'day'})
                return 'opened'
            except Conflict:
                return 'conflict'
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(worker, users))
        self.assertCountEqual(results, ['opened', 'conflict'])
        self.assertEqual(Shift.objects.filter(closed_at__isnull=True).count(), 1)

    @skipUnlessDBFeature('has_select_for_update')
    def test_simultaneous_expenses_cannot_overdraw(self):
        CashRegister.objects.create(balance=100)
        user = User.objects.create(username='expense_admin')
        open_shift(user, {'shift_type': 'day'})
        barrier = Barrier(2)
        def worker(_):
            close_old_connections()
            client = APIClient()
            client.force_authenticate(user)
            barrier.wait(timeout=10)
            try:
                return client.post('/api/shift-expenses/', {'amount': '70.00', 'description': 'Concurrent purchase'}).status_code
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(worker, range(2)))
        self.assertCountEqual(results, [201, 400])
        self.assertEqual(CashRegister.objects.get().balance, 30)
        self.assertEqual(Expenses.objects.count(), 1)

    @skipUnlessDBFeature('has_select_for_update')
    def test_simultaneous_close_credits_cash_once(self):
        CashRegister.objects.create(balance=0)
        user = User.objects.create(username='closing_admin')
        shift = open_shift(user, {'shift_type': 'night'})
        barrier = Barrier(2)
        with tempfile.TemporaryDirectory() as directory, override_settings(MEDIA_ROOT=directory):
            def worker(_):
                connections.close_all()
                client = APIClient()
                client.force_authenticate(user)
                data = {'cash': '99.99', 'cards': 0, 'sbp': 0, 'desk_photo': photo(), 'receipt_photo': photo()}
                barrier.wait(timeout=10)
                try:
                    return client.post(f'/api/shifts/{shift.pk}/close/', data).status_code
                finally:
                    connections.close_all()
            with ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(worker, range(2)))
        self.assertCountEqual(results, [200, 409])
        self.assertEqual(str(CashRegister.objects.get().balance), '99.99')
        self.assertEqual(Report.objects.count(), 1)
