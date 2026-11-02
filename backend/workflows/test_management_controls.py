from decimal import Decimal
import uuid

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from reports.models import CashRegister, Report
from .models import Activity, AutomaticTaskTemplate, Shift, Task, TaskSubmission, TelegramNotification


class ManagementControlsTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.admin = User.objects.create_user(username='admin')
        self.other_admin = User.objects.create_user(username='other-admin')
        self.manager = User.objects.create_user(username='manager', is_staff=True, telegram_id='1')
        self.other_manager = User.objects.create_user(username='second-manager', is_staff=True, telegram_id='2')
        self.owner = User.objects.create_superuser(username='owner', telegram_id='3')
        self.other_owner = User.objects.create_superuser(username='second-owner', telegram_id='4')
        self.shift = Shift.objects.create(admin=self.admin, shift_type='day', schedule_date=timezone.localdate())
        register = CashRegister.get_default()
        register.balance = Decimal('1000')
        register.save(update_fields=['balance'])

    def force(self, actor=None, **values):
        self.client.force_authenticate(actor or self.manager)
        body = {'cash': '100.10', 'cards': '200.20', 'sbp': '300.30', 'reason': 'Ошибка телефона администратора', 'confirmed': True, **values}
        return self.client.post(f'/api/shifts/{self.shift.pk}/force-close/', body, format='json')

    def test_force_close_requires_management_reason_confirmation_and_revenue(self):
        self.assertEqual(self.force(self.admin).status_code, 403)
        self.assertEqual(self.force(self.other_admin).status_code, 403)
        for values in ({'reason': ''}, {'confirmed': False}, {'cash': '-1'}, {'cards': ''}):
            self.assertEqual(self.force(**values).status_code, 400)
        self.assertFalse(Report.objects.exists())
        self.shift.refresh_from_db()
        self.assertIsNone(self.shift.closed_at)

    def test_manager_closes_despite_missing_photos_and_tasks_and_preserves_attribution(self):
        pending = Task.objects.create(creator=self.owner, assignee=self.admin, shift=self.shift, required_for_shift=self.shift, title='Не выполнено')
        result = self.force()
        self.assertEqual(result.status_code, 200, result.data)
        self.shift.refresh_from_db()
        self.assertEqual(self.shift.report.admin, self.admin)
        self.assertEqual(self.shift.report.cash, Decimal('100.10'))
        self.assertEqual(CashRegister.get_default().balance, Decimal('1100.10'))
        self.assertEqual(self.shift.closed_by, self.manager)
        self.assertEqual(self.shift.forced_close_reason, 'Ошибка телефона администратора')
        pending.refresh_from_db()
        self.assertEqual(pending.status, Task.Status.ACTIVE)
        self.assertIsNone(pending.shift)
        self.assertEqual(pending.required_for_shift, self.shift)
        self.assertEqual(self.force().status_code, 409)
        self.assertEqual(CashRegister.get_default().balance, Decimal('1100.10'))
        self.assertEqual(Report.objects.count(), 1)
        event = Activity.objects.get(title='Смена закрыта принудительно')
        self.assertEqual(event.actor, self.manager)
        self.assertIn('manager', event.description)
        self.assertTrue(TelegramNotification.objects.filter(kind='shift_close', message__contains='Причина:').exists())
        self.manager.delete()
        self.client.force_authenticate(self.owner)
        record = self.client.get(f'/api/shifts/{self.shift.pk}/').data
        self.assertIn('(удалён)', record['closedBy'])
        self.client.force_authenticate(self.other_admin)
        self.assertEqual(self.client.post('/api/shifts/open/', {'shift_type': 'day'}).status_code, 201)

    def test_superuser_force_close_is_idempotent(self):
        self.client.force_authenticate(self.owner)
        key = str(uuid.uuid4())
        body = {'cash': '500', 'cards': '0', 'sbp': '0', 'reason': 'Забыли закрыть смену', 'confirmed': True}
        url = f'/api/shifts/{self.shift.pk}/force-close/'
        for _ in range(2):
            self.assertEqual(self.client.post(url, body, format='json', HTTP_IDEMPOTENCY_KEY=key).status_code, 200)
        self.assertEqual(Report.objects.count(), 1)
        self.assertEqual(CashRegister.get_default().balance, Decimal('1500'))

    def template(self, actor=None, **values):
        self.client.force_authenticate(actor or self.owner)
        return self.client.post('/api/automatic-tasks/', {'title': 'Автозадача', 'photo_mode': 'optional', **values}, format='json')

    def test_only_superuser_selects_active_management_reviewers(self):
        for actor in (self.admin, self.manager):
            self.assertEqual(self.template(actor, reviewer_ids=[self.other_manager.pk]).status_code, 403)
        for ids in ([], [self.admin.pk], [999999], ['1'], [True]):
            self.assertEqual(self.template(reviewer_ids=ids).status_code, 400)
        self.other_manager.is_active = False
        self.other_manager.save()
        self.assertEqual(self.template(reviewer_ids=[self.other_manager.pk]).status_code, 400)
        self.client.force_authenticate(self.manager)
        self.assertEqual(self.client.get('/api/automatic-tasks/reviewers/').status_code, 403)
        self.client.force_authenticate(self.owner)
        choices = self.client.get('/api/automatic-tasks/reviewers/').data
        self.assertEqual({p['id'] for p in choices}, {str(self.manager.pk), str(self.owner.pk), str(self.other_owner.pk)})

    def test_group_reviewers_get_visibility_notifications_and_review_permission(self):
        selected = [self.manager.pk, self.other_manager.pk, self.owner.pk, self.other_owner.pk]
        response = self.template(reviewer_ids=selected)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertCountEqual(response.data['reviewerIds'], list(map(str, selected)))
        # Use a new shift to generate the automatic task.
        self.force()
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.post('/api/shifts/open/', {'shift_type': 'day'}).status_code, 201)
        task = Task.objects.get(automatic_template_id=response.data['id'])
        self.assertCountEqual(task.reviewers.values_list('pk', flat=True), selected)
        self.assertEqual(self.client.post(f'/api/tasks/{task.pk}/submit/', {'note': 'Готово'}).status_code, 200)
        jobs = TelegramNotification.objects.filter(submission__task=task)
        self.assertCountEqual(jobs.values_list('recipient_id', flat=True), selected)
        self.client.force_authenticate(self.other_manager)
        workspace = self.client.get('/api/workspace/').data
        record = next(t for t in workspace['state']['tasks'] if t['id'] == str(task.pk))
        self.assertIn(str(self.other_manager.pk), record['reviewerIds'])
        self.assertEqual(self.client.post(f'/api/tasks/{task.pk}/review/', {'accept': True, 'version': 1}).status_code, 200)
        self.client.force_authenticate(self.manager)
        self.assertEqual(self.client.post(f'/api/tasks/{task.pk}/review/', {'accept': True, 'version': 1}).status_code, 409)
        self.assertEqual(TaskSubmission.objects.get(task=task).reviewed_by, self.other_manager)

    def test_template_updates_do_not_change_existing_task_reviewers(self):
        response = self.template(reviewer_ids=[self.manager.pk])
        template = AutomaticTaskTemplate.objects.get(pk=response.data['id'])
        from .automatic_tasks import create_shift_tasks
        create_shift_tasks(self.shift)
        task = template.tasks.get()
        self.client.force_authenticate(self.owner)
        response = self.client.post(f'/api/automatic-tasks/{template.pk}/', {'title': template.title, 'reviewer_ids': [self.other_manager.pk], 'version': 1}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(list(task.reviewers.all()), [self.manager])
        self.assertEqual(list(template.reviewers.all()), [self.other_manager])
        self.client.force_authenticate(self.other_manager)
        self.assertEqual(self.client.get(f'/api/tasks/{task.pk}/').status_code, 404)
        self.manager.delete()
        task.refresh_from_db()
        self.assertIn('(удалён)', task.reviewer_snapshots[0]['name'])
        self.assertEqual(CashRegister.get_default().balance, Decimal('1000'))
