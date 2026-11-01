import tempfile
import uuid
from datetime import date, datetime
from io import BytesIO
from unittest.mock import Mock, patch

from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.test import APITestCase

from reports.models import CashRegister
from .models import NotificationPreferences, ScheduleDelivery, ScheduleSettings, Shift, TelegramNotification
from .notifications import deliver_one, telegram_send
from .schedule_images import render_schedule
from . import schedules


class ScheduleDeliveryTests(APITestCase):
    def setUp(self):
        self.media = tempfile.TemporaryDirectory()
        self.addCleanup(self.media.cleanup)
        settings = override_settings(MEDIA_ROOT=self.media.name, TELEGRAM_BOT_TOKEN='test', WEBAPP_URL='https://work.invalid')
        settings.enable()
        self.addCleanup(settings.disable)
        self.clock = patch('django.utils.timezone.now', return_value=datetime.fromisoformat('2026-10-10T12:00:00+03:00'))
        self.now = self.clock.start()
        self.addCleanup(self.clock.stop)
        User = get_user_model()
        self.owner = User.objects.create_superuser(username='owner', telegram_id='900')
        self.manager = User.objects.create_user(username='manager', is_staff=True, telegram_id='901')
        self.admin = User.objects.create_user(username='actual', first_name='Фактический', telegram_id='902')
        self.planned = User.objects.create_user(username='planned', first_name='Плановый')
        CashRegister.objects.create(balance=1000)
        self.client.force_authenticate(self.owner)
        self.period = schedules.ensure_period(date(2026, 10, 10))
        self.revision = schedules.head(self.period)
        self.revision.plan['2026-10-10/day'] = {'id': str(self.planned.pk), 'name': 'Плановый'}
        self.revision.save(update_fields=['plan'])
        Shift.objects.create(admin=self.admin, shift_type='day', schedule_date=date(2026, 10, 10))
        self.config = ScheduleSettings.objects.create(pk=1)

    def send(self, period=None, revision=1, key=None):
        return self.client.post(f'/api/schedules/{(period or self.period).pk}/send/', {'revision': revision},
                                format='json', HTTP_IDEMPOTENCY_KEY=key or str(uuid.uuid4()))

    def test_manual_modes_send_only_to_clicking_employee_and_can_be_sent_again(self):
        self.client.force_authenticate(self.admin)
        for content in ('plan', 'actual', 'both'):
            self.config.manual_content = content
            self.config.save()
            response = self.send()
            self.assertEqual(response.status_code, 202, response.data)
            delivery = ScheduleDelivery.objects.get(pk=response.data['id'])
            self.assertEqual(delivery.content, content)
            self.assertEqual(delivery.author_id, self.admin.pk)
            self.assertEqual(list(delivery.telegramnotification_set.values_list('recipient_id', flat=True)), [self.admin.pk])
            self.assertEqual(response.data['queued'], 1)
            with delivery.image.open('rb') as image:
                self.assertTrue(image.read().startswith(b'\x89PNG\r\n'))
        self.assertEqual(ScheduleDelivery.objects.count(), 3)
        self.assertFalse(TelegramNotification.objects.exclude(recipient=self.admin).exists())
        self.period.refresh_from_db()
        self.assertIsNone(self.period.summary_created_at)

    def test_current_future_archive_and_selected_revision_can_be_sent(self):
        self.client.force_authenticate(self.manager)
        for day in (date(2026, 10, 10), date(2026, 10, 16), date(2026, 9, 16)):
            period = schedules.ensure_period(day)
            response = self.send(period)
            self.assertEqual(response.status_code, 202, response.data)
            self.assertEqual(ScheduleDelivery.objects.get(pk=response.data['id']).period_id, period.pk)
        self.period.version = 2
        self.period.save(update_fields=['version'])
        self.period.revisions.create(number=2, plan=dict.fromkeys(self.revision.plan))
        response = self.send(revision=1)
        self.assertEqual(response.status_code, 202, response.data)
        self.assertEqual(ScheduleDelivery.objects.get(pk=response.data['id']).revision_id, self.revision.pk)
        self.assertEqual(self.send(revision=99).status_code, 400)

    def test_manual_retry_key_does_not_duplicate_a_delivery(self):
        key = str(uuid.uuid4())
        first, again = self.send(key=key), self.send(key=key)
        self.assertEqual(first.status_code, 202, first.data)
        self.assertEqual(first.data, again.data)
        self.assertEqual(ScheduleDelivery.objects.count(), 1)
        self.assertEqual(TelegramNotification.objects.count(), 1)

    def test_requested_copy_is_delivered_even_with_automatic_schedule_notifications_muted(self):
        NotificationPreferences.objects.create(user=self.manager, telegram={'schedule': False})
        self.client.force_authenticate(self.manager)
        response = self.send()
        self.assertEqual(response.status_code, 202, response.data)
        self.assertEqual(self.client.patch('/api/notification-settings/', {'schedule': False}, format='json').status_code, 200)
        job = TelegramNotification.objects.get()
        self.assertEqual(job.status, 'pending')
        send = Mock()
        self.assertTrue(deliver_one(send))
        send.assert_called_once()
        job.refresh_from_db()
        self.assertEqual(job.status, 'sent')

    def test_admin_can_receive_own_manual_copy_but_cannot_configure_shared_settings(self):
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.send().status_code, 202)
        send = Mock()
        self.assertTrue(deliver_one(send))
        send.assert_called_once()
        self.assertEqual(self.client.post('/api/schedules/settings/', {'version': 1, 'manual_content': 'plan'}, format='json').status_code, 403)

    def test_unlinked_employee_gets_actionable_error_without_creating_delivery(self):
        self.client.force_authenticate(self.planned)
        response = self.send()
        self.assertEqual(response.status_code, 400)
        self.assertIn('Telegram', str(response.data))
        self.assertFalse(ScheduleDelivery.objects.exists())
        self.client.force_authenticate(None)
        self.assertEqual(self.send().status_code, 401)

    def test_automatic_content_and_recipients_are_independent_of_manual_setting(self):
        self.config.automatic_content = 'actual'
        self.config.manual_content = 'plan'
        self.config.save()
        self.send()
        self.now.return_value = datetime.fromisoformat('2026-10-17T00:00:00+03:00')
        schedules.publish_due_schedules()
        automatic = ScheduleDelivery.objects.get(source='automatic')
        self.assertEqual(automatic.content, 'actual')
        self.assertCountEqual(automatic.telegramnotification_set.values_list('recipient_id', flat=True), [self.owner.pk, self.manager.pk])
        schedules.publish_due_schedules()
        self.assertEqual(ScheduleDelivery.objects.filter(source='automatic').count(), 1)
        self.assertEqual(self.send().status_code, 202)
        self.assertEqual(ScheduleDelivery.objects.filter(source='manual').count(), 2)

    def test_disabling_automatic_delivery_preserves_archive_image_and_manual_send(self):
        self.config.automatic_enabled = False
        self.config.save()
        self.now.return_value = datetime.fromisoformat('2026-10-17T00:00:00+03:00')
        schedules.publish_due_schedules()
        self.assertFalse(TelegramNotification.objects.exists())
        self.period.refresh_from_db()
        self.assertTrue(self.period.summary_image)
        self.assertIsNotNone(self.period.summary_created_at)
        self.config.automatic_enabled = True
        self.config.save()
        schedules.publish_due_schedules()
        self.assertFalse(TelegramNotification.objects.exists())
        self.assertEqual(self.send().status_code, 202)

    def test_owner_configuration_is_versioned_and_does_not_clear_default_administrator(self):
        self.config.default_admin = self.planned
        self.config.save()
        data = {'version': 1, 'manual_content': 'plan', 'automatic_content': 'actual', 'automatic_enabled': False}
        response = self.client.post('/api/schedules/settings/', data, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['manualContent'], 'plan')
        self.assertEqual(response.data['automaticContent'], 'actual')
        self.assertFalse(response.data['automaticEnabled'])
        self.assertEqual(response.data['defaultAdminId'], str(self.planned.pk))
        self.assertEqual(self.client.post('/api/schedules/settings/', data, format='json').status_code, 409)
        data.update(version=2, manual_content='unknown')
        self.assertEqual(self.client.post('/api/schedules/settings/', data, format='json').status_code, 400)
        self.client.force_authenticate(self.manager)
        self.assertEqual(self.client.post('/api/schedules/settings/', {'version': 2, 'manual_content': 'plan'}, format='json').status_code, 403)

    def test_switching_automatic_delivery_off_skips_queued_automatic_copies_only(self):
        self.now.return_value = datetime.fromisoformat('2026-10-17T00:00:00+03:00')
        schedules.publish_due_schedules()
        self.assertEqual(self.send().status_code, 202)
        response = self.client.post('/api/schedules/settings/', {'version': 1, 'automatic_enabled': False}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(TelegramNotification.objects.filter(schedule_delivery__source='automatic', status='skipped').count(), 2)
        self.assertEqual(TelegramNotification.objects.get(schedule_delivery__source='manual').status, 'pending')
        send = Mock()
        self.assertTrue(deliver_one(send))
        send.assert_called_once()

    def test_worker_checks_automatic_switch_and_manual_recipient_again_before_delivery(self):
        self.now.return_value = datetime.fromisoformat('2026-10-17T00:00:00+03:00')
        schedules.publish_due_schedules()
        self.config.automatic_enabled = False
        self.config.save()
        send = Mock()
        while deliver_one(send):
            pass
        send.assert_not_called()
        self.assertEqual(TelegramNotification.objects.filter(status='skipped').count(), 2)
        response = self.send()
        job = TelegramNotification.objects.get(schedule_delivery_id=response.data['id'])
        job.recipient = self.manager
        job.save(update_fields=['recipient'])
        self.assertTrue(deliver_one(send))
        send.assert_not_called()
        job.refresh_from_db()
        self.assertEqual(job.status, 'failed')

    def test_rendered_modes_include_only_the_requested_staff_names(self):
        snapshot = schedules.period_data(self.period)
        for content in ('plan', 'actual', 'both'):
            with self.subTest(content=content), patch('PIL.ImageDraw.ImageDraw.text', autospec=True) as draw:
                render_schedule(snapshot, content)
                text = '\n'.join(str(call.args[2]) for call in draw.call_args_list)
            self.assertEqual('Плановый' in text, content != 'actual')
            self.assertEqual('Фактический' in text, content != 'plan')
            self.assertEqual('План:' in text, content != 'actual')
            self.assertEqual('Факт:' in text, content != 'plan')

    def test_delivery_image_is_frozen_and_telegram_uploads_that_snapshot(self):
        response = self.send()
        delivery = ScheduleDelivery.objects.get(pk=response.data['id'])
        with delivery.image.open('rb') as image:
            original = image.read()
        self.revision.plan['2026-10-10/day']['name'] = 'Изменённый план'
        self.revision.save()
        self.admin.first_name = 'Другое имя'
        self.admin.save()
        with delivery.image.open('rb') as image:
            self.assertEqual(image.read(), original)
        job = TelegramNotification.objects.get()
        with patch('workflows.notifications.urlopen') as send:
            send.return_value.__enter__.return_value = BytesIO(b'{"ok":true}')
            telegram_send(job.recipient, job)
        request = send.call_args.args[0]
        self.assertTrue(request.full_url.endswith('/sendPhoto'))
        self.assertIn(original, request.data)
        self.assertIn(f'schedule={self.period.pk}'.encode(), request.data)
