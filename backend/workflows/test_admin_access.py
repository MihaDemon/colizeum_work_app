import tempfile
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from pathlib import Path
from threading import Barrier
from unittest.mock import Mock, patch

from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.db import close_old_connections, connections
from django.test import RequestFactory, TestCase, TransactionTestCase, override_settings, skipUnlessDBFeature
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APIClient

from reports.models import CashRegister, ExpensePhoto, Expenses, Report, ReportPhoto
from users.models import AdminUser
from users.deletion import delete_employees
from .models import Activity, Shift, ShiftExpense, Task, TaskSubmission, TaskSubmissionPhoto, TelegramNotification
from .notifications import DeliveryError, deliver_one, telegram_send
from .presentation import workspace_data
from .services import open_shift, review_task, submit_task
from .tests import photo

User = get_user_model()


@override_settings(BOT_SERVICE_TOKEN='test-service')
class SuperuserAccessTests(TestCase):
    def setUp(self):
        self.media = tempfile.TemporaryDirectory()
        self.settings_override = override_settings(MEDIA_ROOT=self.media.name)
        self.settings_override.enable()
        self.addCleanup(self.media.cleanup)
        self.addCleanup(self.settings_override.disable)
        self.owner = User.objects.create_superuser(username='owner', password='test-password')
        self.card = AdminUser.objects.create(phone_number='9991234567', first_name='Иван', last_name='Петров', telegram_id='101')
        self.employee = User.objects.create_user(username='employee', phone_number=self.card, telegram_id='101')
        self.manager = User.objects.create_user(username='manager', first_name='Анна', last_name='Иванова', is_staff=True)
        self.employee_id = self.employee.pk
        self.manager_id = self.manager.pk
        self.token = Token.objects.create(user=self.employee).key
        self.client.force_login(self.owner)
        CashRegister.objects.create(balance=1000)

    def seed_history(self):
        self.report = Report.objects.create(admin=self.employee, cash=100, cards=50, spb=25, date=timezone.localdate())
        self.closed = Shift.objects.create(admin=self.employee, shift_type='day', report=self.report, closed_at=timezone.now())
        self.current = Shift.objects.create(admin=self.employee, shift_type='night')
        self.expense = Expenses.objects.create(admin=self.employee, amount=30, info='Уборка')
        ShiftExpense.objects.create(shift=self.closed, expense=self.expense)
        self.task = Task.objects.create(creator=self.manager, assignee=self.employee, shift=self.closed, title='Убрать зал', status='moderation', submission_version=1)
        self.submission = TaskSubmission.objects.create(task=self.task, version=1, submitted_by=self.employee, reviewed_by=self.manager, note='Готово')
        self.event = Activity.objects.create(actor=self.employee, task=self.task, title='Задача на проверке', kind='task')
        self.job = TelegramNotification.objects.create(submission=self.submission, recipient=self.manager, next_attempt_at=timezone.now())
        self.images = [
            ReportPhoto.objects.create(report=self.report, image=photo('report.png')),
            ExpensePhoto.objects.create(expense=self.expense, image=photo('expense.png')),
            TaskSubmissionPhoto.objects.create(submission=self.submission, image=photo('task.png')),
        ]

    def assert_history_preserved(self):
        for record in (self.report, self.closed, self.current, self.expense, self.task, self.submission, self.event, self.job):
            record.refresh_from_db()
            if record is not self.job:
                self.assertTrue(record.user_snapshots, type(record).__name__)
        self.assertIsNone(self.current.admin_id)
        self.assertIsNone(self.task.assignee_id)
        self.assertIsNone(self.report.admin_id)
        self.assertIsNone(self.expense.admin_id)
        self.assertEqual(CashRegister.get_default().balance, Decimal('1070'))
        self.assertEqual(ShiftExpense.objects.count(), 1)
        for image in self.images:
            self.assertTrue(type(image).objects.filter(pk=image.pk).exists())
            self.assertTrue(Path(image.image.path).is_file())
        self.assertFalse(User.objects.filter(pk=self.employee_id).exists())
        self.assertFalse(AdminUser.objects.filter(pk='9991234567').exists())
        self.assertFalse(Token.objects.filter(key=self.token).exists())
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f'Token {self.token}')
        self.assertEqual(client.get('/api/workspace/').status_code, 401)
        client.credentials()
        self.assertEqual(client.post('/api/bot/contact/', {'telegram_id': '101', 'phone_number': '9991234567'}, HTTP_X_BOT_SERVICE_TOKEN='test-service').status_code, 404)
        data = workspace_data(self.owner)
        people = {p['id']: p for p in data['people']}
        archived_id = f'deleted-{self.employee_id}'
        self.assertEqual(data['state']['shift']['adminId'], archived_id)
        self.assertEqual(data['state']['shifts'][0]['total'], '175.00')
        self.assertEqual(people[archived_id]['name'], 'Иван Петров (удалён)')
        self.assertTrue(people[archived_id]['deleted'])
        self.assertNotIn('phone_number', people[archived_id])

    def test_superuser_has_crud_permissions_for_every_registered_model(self):
        request = RequestFactory().get('/admin/')
        request.user = self.owner
        for model, model_admin in admin.site._registry.items():
            with self.subTest(model=model._meta.label):
                self.assertEqual(model_admin.get_model_perms(request), {'add': True, 'change': True, 'delete': True, 'view': True})
                url = f'/admin/{model._meta.app_label}/{model._meta.model_name}/add/'
                self.assertEqual(self.client.get(url).status_code, 200, url)

    def test_single_user_deletion_preserves_history_and_revokes_registration(self):
        self.seed_history()
        url = f'/admin/users/user/{self.employee_id}/delete/'
        confirmation = self.client.get(url)
        self.assertEqual(confirmation.status_code, 200)
        self.assertFalse(confirmation.context['protected'])
        self.assertContains(confirmation, 'Иван Петров')
        self.assertContains(confirmation, 'post')
        self.assertEqual(self.client.post(url, {'post': 'yes'}).status_code, 302)
        self.assert_history_preserved()

    def test_bulk_user_deletion_keeps_both_participants_names(self):
        self.seed_history()
        response = self.client.post('/admin/users/user/', {
            'action': 'delete_selected', '_selected_action': [self.employee_id, self.manager_id], 'post': 'yes',
        })
        self.assertEqual(response.status_code, 302)
        self.assert_history_preserved()
        self.assertFalse(User.objects.filter(pk=self.manager_id).exists())
        self.assertIsNone(self.task.creator_id)
        self.assertEqual(self.task.user_snapshots['creator']['name'], 'Анна Иванова (удалён)')
        self.assertEqual(self.task.user_snapshots['assignee']['name'], 'Иван Петров (удалён)')
        self.assertEqual(set(self.submission.user_snapshots), {'submitted_by', 'reviewed_by'})
        self.assertEqual(self.job.status, 'failed')
        send = Mock()
        self.assertFalse(deliver_one(send))
        send.assert_not_called()
        people = {p['id']: p for p in workspace_data(self.owner)['people']}
        self.assertIn(f'deleted-{self.manager_id}', people)

    def test_staff_card_deletion_also_preserves_history(self):
        self.seed_history()
        url = f'/admin/users/adminuser/{self.card.pk}/delete/'
        self.assertEqual(self.client.get(url).status_code, 200)
        self.assertEqual(self.client.post(url, {'post': 'yes'}).status_code, 302)
        self.assert_history_preserved()

    def test_superuser_can_reassign_shift_after_employee_deletion(self):
        self.current = Shift.objects.create(admin=self.employee, shift_type='night')
        replacement = User.objects.create_user(username='replacement')
        self.client.post(f'/admin/users/user/{self.employee_id}/delete/', {'post': 'yes'})
        response = self.client.post(f'/admin/workflows/shift/{self.current.pk}/change/', {
            'admin': replacement.pk, 'shift_type': 'night', 'photo_requirements': '[]', '_save': 'Сохранить',
        })
        self.assertEqual(response.status_code, 302, response.context['adminform'].form.errors if response.status_code == 200 else None)
        self.current.refresh_from_db()
        self.assertEqual(self.current.admin_id, replacement.pk)

    def test_superuser_can_create_edit_and_delete_task(self):
        url = '/admin/workflows/task/'
        data = {'creator': self.manager_id, 'assignee': self.employee_id, 'title': 'Убрать зал',
                'priority': 'normal', 'photo_mode': 'optional', 'photo_requirements': '[]',
                'status': 'active', 'submission_version': '0'}
        response = self.client.post(url + 'add/', data)
        self.assertEqual(response.status_code, 302, response.context['adminform'].form.errors if response.status_code == 200 else None)
        task = Task.objects.get()
        data['title'] = 'Проверить зал'
        self.assertEqual(self.client.post(f'{url}{task.pk}/change/', data).status_code, 302)
        task.refresh_from_db()
        self.assertEqual(task.title, 'Проверить зал')
        self.assertEqual(self.client.post(f'{url}{task.pk}/delete/', {'post': 'yes'}).status_code, 302)
        self.assertFalse(Task.objects.exists())
        data['photo_requirements'] = ''
        response = self.client.post(url + 'add/', data)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(Task.objects.get().photo_requirements, [])

    def test_admin_photo_configuration_rejects_invalid_shapes(self):
        for value in ('{}', '[{"id": "desk"}]', '[{"id":"desk","label":"Стол"},{"id":"desk","label":"Зал"}]'):
            with self.subTest(value=value):
                response = self.client.post('/admin/workflows/photosettings/add/', {'report_fields': value, 'version': 1})
                self.assertContains(response, 'Укажите список из не более 10 полей')

    def test_deleted_creator_task_can_be_completed_and_reviewed_by_superuser(self):
        Shift.objects.create(admin=self.employee, shift_type='day')
        task = Task.objects.create(creator=self.manager, assignee=self.employee, title='Убрать зал')
        self.client.post(f'/admin/users/user/{self.manager_id}/delete/', {'post': 'yes'})
        submit_task(self.employee, task.pk, {'note': 'Готово'})
        self.assertFalse(TelegramNotification.objects.exists())
        result = review_task(self.owner, task.pk, {'version': 1, 'accept': True, 'reason': ''})
        self.assertEqual(result.status, Task.Status.ACCEPTED)
        self.assertEqual(TaskSubmission.objects.get(task=task).reviewed_by, self.owner)

    def test_non_superusers_cannot_delete_users_or_edit_workflow_records(self):
        # Even a manager explicitly granted model permissions cannot bypass the
        # superuser-only policy in these Django administration classes.
        self.manager.user_permissions.add(*Permission.objects.all())
        self.client.force_login(self.manager)
        self.assertEqual(self.client.post(f'/admin/users/user/{self.employee_id}/delete/', {'post': 'yes'}).status_code, 403)
        for path in ('/admin/workflows/shift/add/', '/admin/reports/cashregister/1/change/'):
            self.assertEqual(self.client.post(path, {'balance': '500'}).status_code, 403)
        self.assertTrue(User.objects.filter(pk=self.employee_id).exists())

    def test_stale_authenticated_user_cannot_write_after_deletion(self):
        stale_user = User.objects.get(pk=self.employee_id)
        self.client.post(f'/admin/users/user/{self.employee_id}/delete/', {'post': 'yes'})
        from rest_framework.exceptions import PermissionDenied
        with self.assertRaises(PermissionDenied):
            open_shift(stale_user, {'shift_type': 'day'})

    def test_removed_notification_and_null_recipient_do_not_crash_worker(self):
        task = Task.objects.create(creator=self.manager, assignee=self.employee, title='Убрать зал')
        submission = TaskSubmission.objects.create(task=task, version=1, submitted_by=self.employee)
        job = TelegramNotification.objects.create(submission=submission, recipient=None, next_attempt_at=timezone.now())
        send = Mock()
        self.assertTrue(deliver_one(send))
        send.assert_not_called()
        job.refresh_from_db()
        self.assertEqual(job.status, 'failed')
        with self.assertRaises(DeliveryError):
            telegram_send(None, task)
        job.status = 'pending'
        job.next_attempt_at = timezone.now()
        job.save(update_fields=['status', 'next_attempt_at'])
        real_save = TelegramNotification.save

        def delete_after_claim(instance, *args, **kwargs):
            real_save(instance, *args, **kwargs)
            TelegramNotification.objects.filter(pk=instance.pk).delete()

        with patch.object(TelegramNotification, 'save', delete_after_claim):
            self.assertTrue(deliver_one(send))


class EmployeeDeletionConcurrencyTests(TransactionTestCase):
    @skipUnlessDBFeature('has_select_for_update')
    def test_concurrent_deletions_preserve_both_names_on_shared_task(self):
        CashRegister.objects.create(balance=1000)
        creator = User.objects.create_user(username='manager', first_name='Анна', is_staff=True)
        assignee = User.objects.create_user(username='employee', first_name='Иван')
        task = Task.objects.create(creator=creator, assignee=assignee, title='Убрать зал')
        barrier = Barrier(2)

        def worker(pk):
            close_old_connections()
            barrier.wait(timeout=10)
            try:
                delete_employees(User.objects.filter(pk=pk))
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(worker, [creator.pk, assignee.pk]))
        task.refresh_from_db()
        self.assertIsNone(task.creator_id)
        self.assertIsNone(task.assignee_id)
        self.assertEqual(task.user_snapshots['creator']['name'], 'Анна (удалён)')
        self.assertEqual(task.user_snapshots['assignee']['name'], 'Иван (удалён)')
        self.assertEqual(CashRegister.get_default().balance, Decimal('1000'))
