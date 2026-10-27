from importlib import import_module
from io import BytesIO
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.apps import apps
from django.contrib.auth import get_user_model
from django.db import connection
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from reports.models import Report, ReportPhoto
from .models import Activity, PhotoSettings, Shift, Task, TaskSubmission, TaskSubmissionPhoto
from .notifications import telegram_send
from .serializers import PhotoSettingsSerializer


class RussianLocalizationTests(APITestCase):
    def test_existing_system_text_is_localized_and_custom_content_is_preserved(self):
        user = get_user_model().objects.create_user(username='employee')
        manager = get_user_model().objects.create_user(username='manager', is_staff=True)
        fields = [
            {'id': 'desk', 'label': 'Administrator desk', 'required': True},
            {'id': 'custom', 'label': 'Gaming hall', 'required': False},
        ]
        config = PhotoSettings.objects.create(pk=1, report_fields=fields)
        report = Report.objects.create(admin=user, shift='day', date=timezone.localdate(), info='Administrator desk')
        shift = Shift.objects.create(admin=user, shift_type='day', report=report, closed_at=timezone.now(), photo_requirements=fields)
        default_photo = ReportPhoto.objects.create(report=report, label='Administrator desk', image='reports/existing.png')
        custom_photo = ReportPhoto.objects.create(report=report, label='Gaming hall', image='reports/custom.png')
        task = Task.objects.create(creator=manager, assignee=user, title='Task assigned', description='Keep this custom English text')
        submission = TaskSubmission.objects.create(task=task, version=1, submitted_by=user, note='All clear here')
        generic = TaskSubmissionPhoto.objects.create(submission=submission, image='tasks/existing.png', label='Photo 1')
        named = TaskSubmissionPhoto.objects.create(submission=submission, image='tasks/custom.png', slot='custom', label='Photo 1')
        event = Activity.objects.create(actor=user, title='Shift opened', description='Day', kind='shift')
        custom_event = Activity.objects.create(actor=manager, task=task, title='Task assigned', description='Task assigned', kind='task')
        migration = import_module('workflows.migrations.0005_russian_system_text')
        migration.localize_system_text(apps, SimpleNamespace(connection=connection))
        for record in [config, shift, report, default_photo, custom_photo, task, submission, generic, named, event, custom_event]:
            record.refresh_from_db()
        self.assertEqual(config.version, 2)
        self.assertEqual(config.report_fields[0]['label'], 'Стол администратора')
        self.assertEqual(config.report_fields[1]['label'], 'Gaming hall')
        self.assertEqual(shift.photo_requirements, config.report_fields)
        self.assertEqual(default_photo.label, 'Стол администратора')
        self.assertEqual(custom_photo.label, 'Gaming hall')
        self.assertEqual(report.info, 'Administrator desk')
        self.assertEqual(task.title, 'Task assigned')
        self.assertEqual(task.description, 'Keep this custom English text')
        self.assertEqual(submission.note, 'All clear here')
        self.assertEqual(generic.label, 'Фото 1')
        self.assertEqual(named.label, 'Photo 1')
        self.assertEqual((event.title, event.description), ('Смена открыта', 'День'))
        self.assertEqual((custom_event.title, custom_event.description), ('Задача назначена', 'Task assigned'))
        migration.localize_system_text(apps, SimpleNamespace(connection=connection))
        config.refresh_from_db()
        self.assertEqual(config.version, 2)

    @override_settings(TELEGRAM_BOT_TOKEN='test-token', WEBAPP_URL='https://work.invalid')
    def test_telegram_notification_and_review_button_are_russian(self):
        with patch('workflows.notifications.urlopen') as send:
            send.return_value.__enter__.return_value = BytesIO(b'{"ok":true}')
            telegram_send(SimpleNamespace(telegram_id='101', is_active=True), SimpleNamespace(title='Убрать зал', pk=5))
        payload = json.loads(send.call_args.args[0].data)
        self.assertEqual(payload['text'], 'Задача выполнена: Убрать зал\nРезультат ожидает вашей проверки.')
        self.assertEqual(payload['reply_markup']['inline_keyboard'][0][0]['text'], 'Проверить задачу')

    def test_default_validation_messages_and_admin_labels_are_russian(self):
        serializer = PhotoSettingsSerializer(data={'report_fields': [], 'version': 'invalid'})
        self.assertFalse(serializer.is_valid())
        self.assertRegex(str(serializer.errors['version'][0]), '[а-яА-Я]')
        self.assertEqual(Task._meta.verbose_name, 'Задача')
        self.assertEqual(Task._meta.get_field('assignee').verbose_name, 'Исполнитель')
