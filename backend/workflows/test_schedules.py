import json
import tempfile
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from io import BytesIO
from threading import Barrier
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import close_old_connections, connections
from django.test import TransactionTestCase, override_settings, skipUnlessDBFeature
from PIL import Image
from rest_framework.test import APITestCase, APIClient

from reports.models import CashRegister
from .models import PhotoSettings, SchedulePeriod, ScheduleRevision, ScheduleSettings, Shift, TelegramNotification
from . import schedules
from .notifications import telegram_send

User = get_user_model()


def rows(plan):
    return [{'date': key.split('/')[0], 'type': key.split('/')[1], 'admin_id': person['id'] if person else None} for key, person in plan.items()]


class ScheduleTests(APITestCase):
    def setUp(self):
        self.media = tempfile.TemporaryDirectory()
        override = override_settings(MEDIA_ROOT=self.media.name, TELEGRAM_BOT_TOKEN='test-token', WEBAPP_URL='https://work.invalid')
        override.enable()
        self.addCleanup(self.media.cleanup)
        self.addCleanup(override.disable)
        self.clock = patch('django.utils.timezone.now', return_value=datetime.fromisoformat('2026-10-10T12:00:00+03:00')).start()
        self.addCleanup(patch.stopall)
        self.owner = User.objects.create_superuser(username='owner', telegram_id='900')
        self.manager = User.objects.create_user(username='manager', is_staff=True, telegram_id='901')
        self.admins = [User.objects.create_user(username=f'admin{i}', first_name=f'Сотрудник {i}') for i in range(5)]
        self.client.force_authenticate(self.owner)
        CashRegister.objects.create(balance=1000)
        PhotoSettings.objects.create(pk=1, report_fields=[])
        self.overview = self.client.get('/api/schedules/').data
        self.current = self.overview['current']['id']
        self.future = self.overview['future']['id']

    def detail(self, pk=None):
        return self.client.get(f'/api/schedules/{pk or self.current}/').data

    def save(self, pk=None, plan=None, version=None):
        data = self.detail(pk)
        return self.client.post(f'/api/schedules/{pk or self.current}/', {'version': version or data['version'], 'slots': rows(plan or data['plan'])}, format='json')

    def set_default(self, user=None):
        return self.client.post('/api/schedules/settings/', {'version': ScheduleSettings.objects.get().version, 'default_admin': (user or self.admins[4]).pk}, format='json')

    def generate(self, admins, pk=None):
        detail = self.detail(pk or self.future)
        return self.client.post(f'/api/schedules/{pk or self.future}/generate/', {'version': detail['version'], 'admins': [u.pk for u in admins]}, format='json')

    def test_periods_use_calendar_halves_and_roll_over_without_losing_prepared_plan(self):
        self.assertEqual(self.overview['future']['sendAt'], '2026-11-02T00:00:00+03:00')
        for day, end in ((date(2028, 2, 16), 29), (date(2027, 2, 16), 28), (date(2026, 4, 16), 30), (date(2026, 10, 16), 31)):
            self.assertEqual(schedules.bounds(day)[1].day, end)
        plan = self.detail(self.future)['plan']
        plan[next(iter(plan))] = {'id': str(self.admins[0].pk)}
        self.assertEqual(self.save(self.future, plan).status_code, 200)
        self.clock.return_value = datetime.fromisoformat('2026-10-16T00:00:00+03:00')
        data = self.client.get('/api/schedules/').data
        self.assertEqual(data['current']['id'], self.future)
        self.assertEqual(data['future']['start'], '2026-11-01')
        self.assertEqual(data['archive'][0]['id'], self.current)
        self.assertEqual(self.detail(self.future)['plan'][next(iter(plan))]['id'], str(self.admins[0].pk))

    def test_admins_read_both_periods_but_cannot_edit_generate_restore_or_configure(self):
        self.client.force_authenticate(self.admins[0])
        for pk in (self.current, self.future):
            self.assertFalse(self.detail(pk)['canEdit'])
            self.assertEqual(self.save(pk).status_code, 403)
            self.assertEqual(self.generate(self.admins[:4], pk).status_code, 403)
            self.assertEqual(self.client.post(f'/api/schedules/{pk}/restore/', {'version': 1, 'revision': 1}).status_code, 403)
        self.assertEqual(self.set_default().status_code, 403)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get('/api/schedules/').status_code, 401)

    def test_default_is_superuser_only_and_must_be_active_administrator(self):
        self.client.force_authenticate(self.manager)
        self.assertEqual(self.set_default().status_code, 403)
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.set_default(self.manager).status_code, 400)
        self.admins[0].is_active = False
        self.admins[0].save(update_fields=['is_active'])
        self.assertEqual(self.set_default(self.admins[0]).status_code, 400)
        response = self.set_default()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['defaultAdminId'], str(self.admins[4].pk))

    def test_generation_needs_default_for_gaps_and_only_previews_future(self):
        self.assertEqual(self.generate(self.admins[:3]).status_code, 400)
        self.set_default()
        for count in (0, 1, 2, 3):
            response = self.generate(self.admins[:count])
            self.assertEqual(response.status_code, 200, response.data)
            self.assertTrue(response.data['fallbackUsed'])
            self.assertTrue(all(response.data['plan'].values()))
            self.assertIn(str(self.admins[4].pk), {p['id'] for p in response.data['plan'].values()})
        self.assertEqual(self.generate(self.admins[:4], self.current).status_code, 400)
        self.assertEqual(self.generate(self.admins).status_code, 400)
        self.assertEqual(ScheduleRevision.objects.count(), 2)
        self.assertFalse(TelegramNotification.objects.exists())

    def test_two_on_two_off_is_continuous_between_periods(self):
        first = self.generate(self.admins[:4]).data
        self.assertFalse(first['fallbackUsed'])
        period = SchedulePeriod.objects.get(pk=self.future)
        for offset in range((period.end - period.start).days + 1):
            day = period.start + timedelta(days=offset)
            phase = (day - date(2026, 1, 1)).days % 4
            for kind, index in (('day', 0), ('night', 1)):
                expected = self.admins[(0 if phase < 2 else 2) + index]
                self.assertEqual(first['plan'][f'{day}/{kind}']['id'], str(expected.pk))
        response = self.client.post(f'/api/schedules/{self.future}/', {'version': 1, 'source': 'automatic', 'admins': [u.pk for u in self.admins[:4]], 'slots': rows(first['plan'])}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.clock.return_value = datetime.fromisoformat('2026-10-16T12:00:00+03:00')
        next_id = self.client.get('/api/schedules/').data['future']['id']
        second = self.generate(list(reversed(self.admins[:4])), next_id).data
        self.assertEqual(second['admins'], [str(u.pk) for u in self.admins[:4]])

    def test_manual_versions_conflicts_restore_and_invalid_assignments(self):
        self.client.force_authenticate(self.manager)
        original = self.detail()
        plan = original['plan'].copy()
        key = next(iter(plan))
        plan[key] = {'id': str(self.admins[0].pk)}
        saved = self.save(plan=plan, version=1)
        self.assertEqual(saved.status_code, 200, saved.data)
        self.assertEqual(saved.data['version'], 2)
        self.assertEqual(self.save(plan=plan, version=1).status_code, 409)
        self.assertIsNone(self.client.get(f'/api/schedules/{self.current}/?revision=1').data['plan'][key])
        self.assertEqual(self.client.post(f'/api/schedules/{self.current}/restore/', {'version': 2, 'revision': 1}).status_code, 200)
        latest = self.detail()
        self.assertEqual(latest['version'], 3)
        self.assertIsNone(latest['plan'][key])
        plan[key] = {'id': str(self.manager.pk)}
        self.assertEqual(self.save(plan=plan).status_code, 400)
        self.assertEqual(self.client.post(f'/api/schedules/{self.current}/', {'version': 3, 'slots': []}, format='json').status_code, 400)

    def test_shift_completion_shows_actual_and_preserves_plan_at_opening(self):
        plan = self.detail()['plan']
        key = '2026-10-10/day'
        plan[key] = {'id': str(self.admins[1].pk)}
        self.save(plan=plan)
        self.client.force_authenticate(self.admins[0])
        shift_id = self.client.post('/api/shifts/open/', {'shift_type': 'day'}).data['id']
        self.assertEqual(self.client.post(f'/api/shifts/{shift_id}/close/', {'cash': 100, 'cards': 200, 'sbp': 300}).status_code, 200)
        self.client.force_authenticate(self.manager)
        revised = self.detail()['plan']
        revised[key] = {'id': str(self.admins[2].pk)}
        self.save(plan=revised)
        detail = self.detail()
        self.assertEqual(detail['plan'][key]['id'], str(self.admins[2].pk))
        self.assertEqual(detail['actual'][key][0]['adminId'], str(self.admins[0].pk))
        self.assertEqual(detail['actual'][key][0]['proposed']['id'], str(self.admins[1].pk))
        self.assertEqual(detail['actual'][key][0]['revision'], 2)
        self.assertEqual(str(CashRegister.get_default().balance), '1100.00')
        restored = self.client.post(f'/api/schedules/{self.current}/restore/', {'version': detail['version'], 'revision': 2})
        self.assertEqual(restored.status_code, 200)
        self.assertEqual(restored.data['actual'][key], detail['actual'][key])
        self.assertEqual(str(CashRegister.get_default().balance), '1100.00')

    def test_night_stays_with_opening_day_and_has_correction_day(self):
        self.clock.return_value = datetime.fromisoformat('2026-10-15T22:00:00+03:00')
        self.client.force_authenticate(self.admins[0])
        pk = self.client.post('/api/shifts/open/', {'shift_type': 'night'}).data['id']
        self.clock.return_value = datetime.fromisoformat('2026-10-16T10:00:00+03:00')
        self.client.post(f'/api/shifts/{pk}/close/', {'cash': 0, 'cards': 0, 'sbp': 0})
        self.client.force_authenticate(self.manager)
        detail = self.detail()
        self.assertIn('2026-10-15/night', detail['actual'])
        self.assertTrue(detail['canEdit'])
        self.assertEqual(self.save().status_code, 200)
        self.clock.return_value = datetime.fromisoformat('2026-10-17T00:00:00+03:00')
        self.assertFalse(self.detail()['canEdit'])
        self.assertEqual(self.save().status_code, 409)

    def test_summary_is_not_queued_on_creation_or_period_end_but_after_one_full_day(self):
        schedules.publish_due_schedules()
        self.assertFalse(TelegramNotification.objects.filter(kind='schedule').exists())
        self.clock.return_value = datetime.fromisoformat('2026-10-16T00:00:00+03:00')
        schedules.publish_due_schedules()
        self.assertFalse(TelegramNotification.objects.filter(kind='schedule').exists())
        self.clock.return_value = datetime.fromisoformat('2026-10-17T00:00:00+03:00')
        schedules.publish_due_schedules()
        self.assertCountEqual(TelegramNotification.objects.filter(kind='schedule').values_list('recipient_id', flat=True), [self.owner.pk, self.manager.pk])
        period = SchedulePeriod.objects.get(pk=self.current)
        self.assertIsNotNone(period.summary_created_at)
        with period.summary_image.open('rb') as image:
            picture = Image.open(image)
            self.assertEqual(picture.format, 'PNG')
            self.assertLess(sum(picture.size), 10000)
        schedules.publish_due_schedules()
        self.assertEqual(TelegramNotification.objects.filter(kind='schedule').count(), 2)
        self.assertEqual(self.client.get(f'/api/schedules/{period.pk}/image/').status_code, 200)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(f'/api/schedules/{period.pk}/image/').status_code, 401)

    def test_summary_uses_photo_upload_and_opens_its_archive(self):
        self.clock.return_value = datetime.fromisoformat('2026-10-17T12:00:00+03:00')
        schedules.publish_due_schedules()
        job = TelegramNotification.objects.filter(kind='schedule').first()
        with patch('workflows.notifications.urlopen') as send:
            send.return_value.__enter__.return_value = BytesIO(b'{"ok":true}')
            telegram_send(job.recipient, job)
        request = send.call_args.args[0]
        self.assertTrue(request.full_url.endswith('/sendPhoto'))
        self.assertIn(b'\x89PNG\r\n', request.data)
        self.assertIn(f'schedule={job.schedule_id}'.encode(), request.data)
        self.assertIn(b'inline_keyboard', request.data)

    def test_deleted_staff_keeps_version_names_and_unavailable_marker(self):
        plan = self.detail()['plan']
        key = next(iter(plan))
        admin = self.admins[0]
        pk = str(admin.pk)
        plan[key] = {'id': pk}
        self.save(plan=plan)
        self.set_default(admin)
        self.client.force_authenticate(self.manager)
        self.save()
        self.manager.delete()
        admin.delete()
        self.client.force_authenticate(self.owner)
        detail = self.detail()
        self.assertEqual(detail['plan'][key]['name'], 'Сотрудник 0')
        self.assertIn(pk, detail['unavailable'])
        self.assertIn('manager (удалён)', [r['author'] for r in detail['revisions']])
        self.assertIsNone(ScheduleSettings.objects.get().default_admin_id)


class ScheduleConcurrencyTests(TransactionTestCase):
    @skipUnlessDBFeature('has_select_for_update')
    def test_simultaneous_saves_publish_one_version(self):
        owner = User.objects.create_superuser(username='owner')
        data = schedules.overview(owner)
        period = SchedulePeriod.objects.get(pk=data['current']['id'])
        plan = schedules.head(period).plan
        barrier = Barrier(2)
        def worker(_):
            close_old_connections()
            client = APIClient()
            client.force_authenticate(owner)
            barrier.wait(timeout=10)
            try:
                return client.post(f'/api/schedules/{period.pk}/', {'version': 1, 'slots': rows(plan)}, format='json').status_code
            finally:
                connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertCountEqual(list(pool.map(worker, range(2))), [200, 409])
        self.assertEqual(period.revisions.count(), 2)
