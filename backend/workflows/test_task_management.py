import uuid
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase
from .models import Activity, Task, TaskSubmission, TelegramNotification
from .notifications import deliver_one

User = get_user_model()


class TaskManagementTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username='admin', telegram_id='100')
        self.offshift = User.objects.create_user(username='offshift')
        self.disabled = User.objects.create_user(username='disabled', is_active=False)
        self.manager = User.objects.create_user(username='manager', is_staff=True)
        self.other = User.objects.create_user(username='other', is_staff=True)
        self.owner = User.objects.create_superuser(username='owner')

    def task(self, **kwargs):
        return Task.objects.create(creator=self.manager, assignee=self.admin, title='Проверить места', **kwargs)

    def test_manager_assigns_any_active_admin_without_shift(self):
        self.client.force_authenticate(self.manager)
        people = self.client.get('/api/workspace/').data['people']
        self.assertIn(str(self.offshift.pk), [p['id'] for p in people])
        self.assertNotIn(str(self.disabled.pk), [p['id'] for p in people])
        for admin in (self.admin, self.offshift):
            result = self.client.post('/api/tasks/', {'assignee': admin.pk, 'title': 'Заранее'})
            self.assertEqual(result.status_code, 201)
            self.assertIsNone(result.data['shiftId'])
        self.assertEqual(self.client.post('/api/tasks/', {'assignee': self.disabled.pk, 'title': 'Нет'}).status_code, 400)

    def test_deletion_permissions_and_accepted_history(self):
        for status in ('active', 'rejected', 'moderation'):
            task = self.task(status=status)
            path = f'/api/tasks/{task.pk}/'
            self.client.force_authenticate(self.admin)
            self.assertEqual(self.client.delete(path).status_code, 403)
            self.client.force_authenticate(self.other)
            self.assertEqual(self.client.delete(path).status_code, 404)
            self.client.force_authenticate(self.manager)
            self.assertEqual(self.client.delete(path).status_code, 204)
            task.refresh_from_db()
            self.assertIsNotNone(task.deleted_at)
            self.assertEqual(self.client.get(path).status_code, 404)
        accepted = self.task(status='accepted')
        received = Task.objects.create(creator=self.other, assignee=self.manager, title='Личная задача управляющего')
        self.client.force_authenticate(self.manager)
        self.assertEqual(self.client.delete(f'/api/tasks/{received.pk}/').status_code, 403)
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.delete(f'/api/tasks/{accepted.pk}/').status_code, 409)
        task = self.task()
        self.assertEqual(self.client.delete(f'/api/tasks/{task.pk}/').status_code, 204)

    def test_delete_preserves_evidence_cancels_jobs_and_is_retry_safe(self):
        task = self.task(status='moderation')
        submission = TaskSubmission.objects.create(task=task, version=1, submitted_by=self.admin, note='Результат')
        job = TelegramNotification.objects.create(submission=submission, recipient=self.manager, next_attempt_at=timezone.now())
        self.client.force_authenticate(self.manager)
        key = str(uuid.uuid4())
        path = f'/api/tasks/{task.pk}/'
        for _ in range(2):
            self.assertEqual(self.client.delete(path, HTTP_IDEMPOTENCY_KEY=key).status_code, 204)
        self.assertTrue(TaskSubmission.objects.filter(pk=submission.pk).exists())
        self.assertEqual(Activity.objects.filter(title='Задача удалена').count(), 1)
        job.refresh_from_db()
        self.assertEqual(job.status, 'failed')
        # A manual retry of an old job must still not send deleted work.
        job.status = 'pending'
        job.save(update_fields=['status'])
        self.assertTrue(deliver_one(send=lambda *_: self.fail('Deleted task sent')))
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get('/api/workspace/').data['state']['tasks'], [])
        self.assertEqual(self.client.post(path + 'submit/', {'note': 'Поздно'}).status_code, 404)
