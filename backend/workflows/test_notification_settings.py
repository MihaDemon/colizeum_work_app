import json
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import Activity, NotificationPreferences, Shift, Task, TaskSubmission, TelegramNotification
from .notification_settings import NOTIFICATION_KINDS
from .notifications import deliver_one, queue_management, queue_task_assigned, telegram_send

User = get_user_model()


@override_settings(TELEGRAM_BOT_TOKEN='test-token', WEBAPP_URL='https://work.invalid/?shift=123&club=perovo')
class NotificationSettingsTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(username='admin', telegram_id='101')
        self.manager = User.objects.create_user(username='manager', is_staff=True, telegram_id='102')
        self.owner = User.objects.create_superuser(username='owner', telegram_id='103')
        self.client.force_authenticate(self.owner)

    def task(self, assignee=None):
        return Task.objects.create(creator=self.owner, assignee=assignee or self.admin,
                                   title='Проверить рабочие места', description='Осмотреть оборудование.')

    def test_settings_are_private_default_on_and_patch_preserves_other_categories(self):
        result = self.client.get('/api/notification-settings/')
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.data, dict.fromkeys(NOTIFICATION_KINDS, True))
        result = self.client.patch('/api/notification-settings/', {'expense': False}, format='json')
        self.assertEqual(result.status_code, 200)
        self.assertFalse(result.data['expense'])
        self.assertTrue(result.data['cleaner'])
        self.client.force_authenticate(self.manager)
        self.assertTrue(self.client.get('/api/notification-settings/').data['expense'])
        for body in ({'user': self.owner.pk, 'expense': False}, {'expense': 'no'}, {'expense': 0}, {'expense': None}):
            self.assertEqual(self.client.patch('/api/notification-settings/', body, format='json').status_code, 400)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get('/api/notification-settings/').status_code, 403)
        self.assertEqual(self.client.patch('/api/notification-settings/', {'task_assigned': False}, format='json').status_code, 403)

    def test_assignments_are_queued_once_for_administrator_and_manager(self):
        for recipient in (self.admin, self.manager):
            task = self.task(recipient)
            queue_task_assigned(task)
            queue_task_assigned(task)
            job = TelegramNotification.objects.get(kind='task_assigned', task=task)
            self.assertEqual(job.recipient, recipient)
            self.assertIn('Вам назначена новая задача', job.message)
            self.assertIn(task.description, job.message)
            sent = []
            self.assertTrue(deliver_one(send=lambda user, notification: sent.append((user.pk, notification.task_id))))
            self.assertEqual(sent, [(recipient.pk, task.pk)])

    def test_assignment_payload_opens_assigned_task(self):
        task = self.task()
        queue_task_assigned(task)
        job = TelegramNotification.objects.get(kind='task_assigned')
        with patch('workflows.notifications.urlopen') as network:
            network.return_value.__enter__.return_value.read.return_value = b'{"ok": true}'
            telegram_send(self.admin, job)
        payload = json.loads(network.call_args.args[0].data)
        self.assertEqual(payload['chat_id'], '101')
        button = payload['reply_markup']['inline_keyboard'][0][0]
        self.assertEqual(button['text'], 'Открыть задачу')
        self.assertEqual(parse_qs(urlsplit(button['web_app']['url']).query), {'task': [str(task.pk)], 'club': ['perovo']})

    def test_muted_notifications_never_replay_but_activity_remains(self):
        task = self.task(self.manager)
        queue_task_assigned(task)
        Activity.objects.create(actor=self.owner, task=task, title='Задача назначена', description=task.title, kind='task')
        self.client.force_authenticate(self.manager)
        self.assertEqual(self.client.patch('/api/notification-settings/', {'task_assigned': False}, format='json').status_code, 200)
        job = TelegramNotification.objects.get(kind='task_assigned')
        self.assertEqual(job.status, 'skipped')
        self.assertFalse(deliver_one(send=lambda *_: self.fail('Muted assignment must not be sent.')))
        state = self.client.get('/api/workspace/').data['state']
        self.assertEqual(state['activity'][0]['title'], 'Задача назначена')
        second = self.task(self.manager)
        queue_task_assigned(second)
        self.assertEqual(TelegramNotification.objects.get(task=second).status, 'skipped')
        self.client.patch('/api/notification-settings/', {'task_assigned': True}, format='json')
        self.assertFalse(deliver_one(send=lambda *_: self.fail('Opt-in must not replay skipped messages.')))

    def test_worker_checks_latest_preferences_and_account_status(self):
        task = self.task(self.manager)
        queue_task_assigned(task)
        NotificationPreferences.objects.create(user=self.manager, telegram={'task_assigned': False})
        self.assertTrue(deliver_one(send=lambda *_: self.fail('Worker must recheck preference.')))
        self.assertEqual(TelegramNotification.objects.get(task=task).status, 'skipped')
        second = self.task()
        queue_task_assigned(second)
        self.admin.is_active = False
        self.admin.save(update_fields=['is_active'])
        self.assertTrue(deliver_one(send=lambda *_: self.fail('Disabled account must not receive Telegram.')))
        self.assertEqual(TelegramNotification.objects.get(task=second).status, 'failed')

    def test_worker_rechecks_assignment_and_current_role(self):
        task = self.task()
        queue_task_assigned(task)
        task.assignee = self.manager
        task.save(update_fields=['assignee'])
        self.assertTrue(deliver_one(send=lambda *_: self.fail('Former assignee must not receive task.')))
        self.assertEqual(TelegramNotification.objects.get(task=task).status, 'failed')
        second = self.task(self.manager)
        queue_task_assigned(second)
        self.manager.is_superuser = True
        self.manager.save(update_fields=['is_superuser'])
        self.assertTrue(deliver_one(send=lambda *_: self.fail('Superuser cannot receive assignments.')))

    def test_management_preferences_apply_to_all_event_kinds_and_review(self):
        NotificationPreferences.objects.create(user=self.manager, telegram=dict.fromkeys(NOTIFICATION_KINDS, False))
        shift = Shift.objects.create(admin=self.admin, shift_type='day')
        queue_management('shift_open', 'Смена открыта', shift=shift)
        self.assertEqual(TelegramNotification.objects.get(recipient=self.manager).status, 'skipped')
        self.assertEqual(TelegramNotification.objects.get(recipient=self.owner).status, 'pending')
        TelegramNotification.objects.filter(recipient=self.owner).update(status='sent')
        task = Task.objects.create(creator=self.manager, assignee=self.admin, title='Задача')
        submission = TaskSubmission.objects.create(task=task, version=1, submitted_by=self.admin)
        job = TelegramNotification.objects.create(submission=submission, recipient=self.manager, next_attempt_at=timezone.now())
        self.assertTrue(deliver_one(send=lambda *_: self.fail('Review notifications must honor preference.')))
        job.refresh_from_db()
        self.assertEqual(job.status, 'skipped')

    def test_notification_target_constraint_matches_new_kind(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            TelegramNotification.objects.create(kind='task_assigned', recipient=self.admin, next_attempt_at=timezone.now())
        task = self.task()
        with self.assertRaises(IntegrityError), transaction.atomic():
            TelegramNotification.objects.create(kind='expense', task=task, recipient=self.admin, next_attempt_at=timezone.now())
