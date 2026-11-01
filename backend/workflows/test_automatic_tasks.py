import tempfile
import uuid
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.test import APITestCase

from reports.models import CashRegister, Report
from .models import AutomaticTaskTemplate, PhotoSettings, Shift, Task
from .tests import photo


class AutomaticTaskTests(APITestCase):
    def setUp(self):
        self.media = tempfile.TemporaryDirectory()
        self.addCleanup(self.media.cleanup)
        override = override_settings(MEDIA_ROOT=self.media.name)
        override.enable()
        self.addCleanup(override.disable)
        User = get_user_model()
        self.owner = User.objects.create_superuser(username='owner', telegram_id='900')
        self.manager = User.objects.create_user(username='manager', is_staff=True, telegram_id='901')
        self.other = User.objects.create_user(username='other-manager', is_staff=True)
        self.admin = User.objects.create_user(username='admin', telegram_id='902')
        self.client.force_authenticate(self.manager)
        CashRegister.objects.create(balance=1000)
        PhotoSettings.objects.create(pk=1, report_fields=[])

    def template(self, **values):
        body = {'title': 'Проверить игровые места', 'description': 'Проверьте каждое место.', 'photo_mode': 'optional', **values}
        response = self.client.post('/api/automatic-tasks/', body, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return AutomaticTaskTemplate.objects.get(pk=response.data['id'])

    def open(self, kind='day', key=None):
        self.client.force_authenticate(self.admin)
        body = {'shift_type': kind}
        response = self.client.post('/api/shifts/open/', body, HTTP_IDEMPOTENCY_KEY=key or str(uuid.uuid4()))
        self.assertEqual(response.status_code, 201, response.data)
        return Shift.objects.get(pk=response.data['id'])

    def close(self, shift):
        self.client.force_authenticate(self.admin)
        return self.client.post(f'/api/shifts/{shift.pk}/close/', {'cash': '100', 'cards': '200', 'sbp': '300'})

    def submit(self, task, **data):
        self.client.force_authenticate(self.admin)
        return self.client.post(f'/api/tasks/{task.pk}/submit/', {'note': 'Готово', **data})

    def test_templates_have_management_permissions_and_version_conflicts(self):
        template = self.template()
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get('/api/automatic-tasks/').status_code, 403)
        self.assertEqual(self.client.post('/api/automatic-tasks/', {'title': 'Нельзя'}).status_code, 403)
        self.client.force_authenticate(self.other)
        listing = self.client.get('/api/automatic-tasks/').data
        self.assertFalse(listing[0]['canEdit'])
        data = {'title': 'Изменённая задача', 'version': 1, 'photo_mode': 'optional'}
        self.assertEqual(self.client.post(f'/api/automatic-tasks/{template.pk}/', data).status_code, 403)
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.post(f'/api/automatic-tasks/{template.pk}/', data).status_code, 200)
        self.assertEqual(self.client.post(f'/api/automatic-tasks/{template.pk}/', data).status_code, 409)
        self.assertEqual(self.client.post('/api/automatic-tasks/', {'title': 'Фото', 'photo_mode': 'named'}, format='json').status_code, 400)

    def test_opening_creates_applicable_tasks_once_and_preserves_original_shift(self):
        day = self.template(shift_type='day')
        both = self.template(title='Касса', shift_type='both')
        self.template(title='Ночная задача', shift_type='night')
        self.template(title='Выключенная', enabled=False)
        key = str(uuid.uuid4())
        with patch('workflows.notifications.urlopen') as network:
            shift = self.open(key=key)
            self.assertEqual(self.open(key=key).pk, shift.pk)
            network.assert_not_called()
        tasks = list(Task.objects.filter(required_for_shift=shift))
        self.assertCountEqual([task.automatic_template_id for task in tasks], [day.pk, both.pk])
        self.assertTrue(all(task.creator_id == self.manager.pk and task.assignee_id == self.admin.pk for task in tasks))
        response = self.close(shift)
        self.assertEqual(response.status_code, 409, response.data)
        self.assertIn(day.title, str(response.data))
        self.assertEqual(CashRegister.get_default().balance, 1000)
        self.assertFalse(Report.objects.exists())
        for task in tasks:
            self.assertEqual(self.submit(task).status_code, 200)
        self.assertEqual(self.close(shift).status_code, 200)
        self.assertEqual(CashRegister.get_default().balance, 1100)
        for task in tasks:
            task.refresh_from_db()
            self.assertEqual(task.status, Task.Status.MODERATION)
            self.assertEqual(task.required_for_shift_id, shift.pk)
            self.assertIsNone(task.shift_id)

    def test_rejected_task_blocks_close_until_resubmitted_and_cannot_be_deleted(self):
        self.template()
        shift = self.open()
        task = Task.objects.get(required_for_shift=shift)
        self.assertEqual(self.submit(task).status_code, 200)
        self.client.force_authenticate(self.manager)
        response = self.client.post(f'/api/tasks/{task.pk}/review/', {'accept': False, 'version': 1, 'reason': 'Проверьте повторно'})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.client.delete(f'/api/tasks/{task.pk}/').status_code, 409)
        self.assertEqual(self.close(shift).status_code, 409)
        self.assertEqual(self.submit(task).status_code, 200)
        self.assertEqual(self.close(shift).status_code, 200)

    def test_accepted_required_task_and_unfinished_manual_task_allow_closing(self):
        self.template()
        shift = self.open()
        task = Task.objects.get(required_for_shift=shift)
        self.assertEqual(self.submit(task).status_code, 200)
        self.client.force_authenticate(self.manager)
        self.assertEqual(self.client.post(f'/api/tasks/{task.pk}/review/', {'accept': True, 'version': 1}).status_code, 200)
        Task.objects.create(creator=self.manager, assignee=self.admin, shift=shift, title='Обычная задача')
        self.assertEqual(self.close(shift).status_code, 200)

    def test_template_changes_apply_to_next_shift_only_and_photo_rules_are_enforced(self):
        fields = [{'id': 'desk', 'label': 'Чистый стол', 'required': True}]
        template = self.template(photo_mode='named', photo_requirements=fields, shift_type='day')
        shift = self.open()
        task = Task.objects.get(required_for_shift=shift)
        self.client.force_authenticate(self.manager)
        response = self.client.post(f'/api/automatic-tasks/{template.pk}/', {
            'title': 'Будущая задача', 'version': 1, 'enabled': False, 'photo_mode': 'optional', 'shift_type': 'night',
        }, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        task.refresh_from_db()
        self.assertEqual(task.title, template.title)
        self.assertEqual(task.photo_requirements, fields)
        self.assertEqual(self.close(shift).status_code, 409)
        self.assertIn(self.submit(task).status_code, (400, 409))
        response = self.submit(task, photos=[photo()], photo_slots='["desk"]')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.close(shift).status_code, 200)
        next_shift = self.open('night')
        self.assertFalse(Task.objects.filter(required_for_shift=next_shift).exists())

    def test_deleted_template_creator_falls_back_to_owner(self):
        template = self.template()
        self.manager.delete()
        template.refresh_from_db()
        self.assertIn('creator', template.user_snapshots)
        shift = self.open()
        task = Task.objects.get(required_for_shift=shift)
        self.assertEqual(task.creator_id, self.owner.pk)
        self.assertEqual(self.submit(task).status_code, 200)
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.post(f'/api/tasks/{task.pk}/review/', {'accept': True, 'version': 1}).status_code, 200)

    def test_photo_example_is_available_to_assignee_through_generated_task(self):
        response = self.client.post('/api/automatic-tasks/', {'title': 'Фото', 'reference_photo': photo()})
        self.assertEqual(response.status_code, 201, response.data)
        url = response.data['referencePhoto']
        self.assertEqual(self.client.get(url).status_code, 200)
        shift = self.open()
        self.assertEqual(self.client.get(url).status_code, 403)
        task = Task.objects.get(required_for_shift=shift)
        self.assertEqual(self.client.get(f'/api/files/reference/{task.pk}/').status_code, 200)

    def test_list_toggle_preserves_configuration_and_checks_permissions_and_version(self):
        fields = [{'id': 'desk', 'label': 'Чистый стол', 'required': True}]
        template = self.template(photo_mode='named', photo_requirements=fields, shift_type='night', priority='high')
        url = f'/api/automatic-tasks/{template.pk}/'
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.patch(url, {'enabled': False, 'version': 1}, format='json').status_code, 403)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.patch(url, {'enabled': False, 'version': 1}, format='json').status_code, 403)
        self.client.force_authenticate(self.manager)
        self.assertEqual(self.client.patch(url, {'enabled': False}, format='json').status_code, 400)
        response = self.client.patch(url, {'enabled': False, 'version': 1}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        template.refresh_from_db()
        self.assertFalse(template.enabled)
        self.assertEqual(template.photo_requirements, fields)
        self.assertEqual(template.photo_mode, 'named')
        self.assertEqual(template.shift_type, 'night')
        self.assertEqual(template.priority, 'high')
        self.assertEqual(self.client.patch(url, {'enabled': True, 'version': 1}, format='json').status_code, 409)
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.patch(url, {'enabled': True, 'version': 2}, format='json').status_code, 200)

    def test_deleting_template_preserves_required_task_and_stops_future_assignments(self):
        template = self.template()
        shift = self.open()
        task = Task.objects.get(required_for_shift=shift)
        url = f'/api/automatic-tasks/{template.pk}/'
        self.client.force_authenticate(self.manager)
        key = str(uuid.uuid4())
        response = self.client.delete(url, {'version': 1}, format='json', HTTP_IDEMPOTENCY_KEY=key)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.client.delete(url, {'version': 1}, format='json', HTTP_IDEMPOTENCY_KEY=key).status_code, 200)
        template.refresh_from_db()
        self.assertIsNotNone(template.deleted_at)
        self.assertFalse(template.enabled)
        self.assertEqual(self.client.get('/api/automatic-tasks/').data, [])
        self.assertEqual(self.client.patch(url, {'enabled': True, 'version': 2}, format='json').status_code, 404)
        task.refresh_from_db()
        self.assertEqual(task.automatic_template_id, template.pk)
        self.assertEqual(task.status, Task.Status.ACTIVE)
        self.assertEqual(self.close(shift).status_code, 409)
        self.assertEqual(self.submit(task).status_code, 200)
        self.client.force_authenticate(self.manager)
        self.assertEqual(self.client.post(f'/api/tasks/{task.pk}/review/', {'accept': True, 'version': 1}).status_code, 200)
        self.assertEqual(self.close(shift).status_code, 200)
        next_shift = self.open('night')
        self.assertFalse(Task.objects.filter(required_for_shift=next_shift).exists())

    def test_template_deletion_requires_owner_and_current_version(self):
        template = self.template()
        url = f'/api/automatic-tasks/{template.pk}/'
        for user in [self.admin, self.other]:
            self.client.force_authenticate(user)
            self.assertEqual(self.client.delete(url, {'version': 1}, format='json').status_code, 403)
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.delete(url, {}, format='json').status_code, 400)
        self.assertEqual(self.client.delete(url, {'version': 2}, format='json').status_code, 409)
        self.assertEqual(self.client.delete(url, {'version': 1}, format='json').status_code, 200)
