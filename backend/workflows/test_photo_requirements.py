import json
import tempfile
import uuid

from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.test import APITestCase

from reports.models import CashRegister, Report
from .models import PhotoSettings, Shift, Task, TaskSubmission, TelegramNotification
from .photos import default_report_fields
from .tests import photo

User = get_user_model()


class PhotoRequirementTests(APITestCase):
    def setUp(self):
        self.media = tempfile.TemporaryDirectory()
        settings = override_settings(MEDIA_ROOT=self.media.name)
        settings.enable()
        self.addCleanup(settings.disable)
        self.addCleanup(self.media.cleanup)
        self.admin = User.objects.create_user(username='administrator')
        self.other = User.objects.create_user(username='other')
        self.manager = User.objects.create_user(username='manager', is_staff=True)
        self.manager2 = User.objects.create_user(username='manager2', is_staff=True)
        self.owner = User.objects.create_superuser(username='owner')
        CashRegister.objects.create(balance=0)
        self.client.force_authenticate(self.admin)

    def configure(self, fields, version=1, actor=None):
        self.client.force_authenticate(actor or self.manager)
        return self.client.post('/api/photo-settings/', {'report_fields': fields, 'version': version}, format='json')

    def open(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post('/api/shifts/open/', {'shift_type': 'day'})
        self.assertEqual(response.status_code, 201, response.data)
        return response.data['id']

    def task(self, mode, fields=None):
        self.client.force_authenticate(self.manager)
        response = self.client.post('/api/tasks/', {
            'title': 'Clean the club', 'assignee': self.admin.pk,
            'photo_mode': mode, 'photo_requirements': json.dumps(fields or []),
        })
        self.assertEqual(response.status_code, 201, response.data)
        self.client.force_authenticate(self.admin)
        return response.data['id']

    def test_only_managers_and_superusers_configure_report_photos(self):
        fields = [{'id': 'reception', 'label': 'Reception', 'required': True}]
        self.assertEqual(self.configure(fields, actor=self.admin).status_code, 403)
        self.assertFalse(PhotoSettings.objects.exists())
        self.assertEqual(self.configure(fields).status_code, 200)
        response = self.configure([], version=2, actor=self.owner)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['version'], 3)
        self.assertEqual(self.configure(fields).status_code, 409)
        self.assertEqual(PhotoSettings.objects.get().report_fields, [])

    def test_report_settings_validate_labels_ids_and_limits(self):
        bad = [
            [{'id': 'x', 'label': '', 'required': True}],
            [{'id': 'x', 'label': 'One'}, {'id': 'x', 'label': 'Two'}],
            [{'id': 'x', 'label': 'Desk'}, {'id': 'y', 'label': 'desk'}],
            [{'id': '../path', 'label': 'Desk'}],
            [{'id': str(index), 'label': str(index)} for index in range(11)],
        ]
        for fields in bad:
            with self.subTest(fields=fields):
                self.assertEqual(self.configure(fields).status_code, 400)

    def test_custom_report_fields_are_snapshotted_and_labels_saved(self):
        fields = [{'id': 'reception', 'label': 'Reception desk', 'required': True}, {'id': 'hall', 'label': 'Gaming hall', 'required': False}]
        self.assertEqual(self.configure(fields).status_code, 200)
        shift = self.open()
        self.assertEqual(self.configure([{'id': 'receipt', 'label': 'Receipt', 'required': True}], version=2).status_code, 200)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get('/api/workspace/').data['state']['shift']['photoRequirements'], fields)
        url = f'/api/shifts/{shift}/close/'
        totals = {'cash': '10.00', 'cards': '20.00', 'sbp': '30.00'}
        self.assertEqual(self.client.post(url, totals).status_code, 400)
        response = self.client.post(url, {**totals, 'photos': [photo()], 'photo_slots': json.dumps(['reception'])})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(Report.objects.get().photos.get().label, 'Reception desk')
        self.assertEqual(str(CashRegister.objects.get().balance), '10.00')
        self.assertEqual(self.client.get('/api/workspace/').data['state']['shifts'][0]['photos'].keys(), {'Reception desk'})
        self.assertEqual(Shift.objects.get(pk=self.open()).photo_requirements[0]['label'], 'Receipt')

    def test_unknown_or_duplicate_report_slots_cannot_replace_required_photos(self):
        shift = self.open()
        for slots in [['unknown', 'receipt'], ['desk', 'desk']]:
            response = self.client.post(f'/api/shifts/{shift}/close/', {
                'cash': 0, 'cards': 0, 'sbp': 0, 'photos': [photo(), photo()], 'photo_slots': json.dumps(slots),
            })
            self.assertEqual(response.status_code, 400)
        self.assertFalse(Report.objects.exists())

    def test_report_with_no_configured_fields_can_close_without_images(self):
        self.assertEqual(self.configure([]).status_code, 200)
        shift = self.open()
        self.assertEqual(self.client.post(f'/api/shifts/{shift}/close/', {'cash': 0, 'cards': 0, 'sbp': 0}).status_code, 200)

    def test_named_task_requires_each_required_field_and_shows_all_evidence(self):
        self.open()
        fields = [{'id': 'before', 'label': 'Before cleaning', 'required': True}, {'id': 'after', 'label': 'After cleaning', 'required': True}]
        task = self.task('named', fields)
        url = f'/api/tasks/{task}/submit/'
        self.assertEqual(self.client.post(url, {'photos': [photo()], 'photo_slots': json.dumps(['before'])}).status_code, 400)
        self.assertFalse(TaskSubmission.objects.exists())
        response = self.client.post(url, {'photos': [photo(), photo()], 'photo_slots': json.dumps(['before', 'after']), 'note': 'Done'})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([item['label'] for item in response.data['photos']], ['Before cleaning', 'After cleaning'])
        self.assertEqual(TaskSubmission.objects.get().photos.count(), 2)
        self.assertEqual(TelegramNotification.objects.count(), 1)
        self.assertEqual(response.data['status'], 'moderation')
        image_url = response.data['photos'][0]['url']
        self.assertEqual(self.client.get(image_url).status_code, 200)
        self.client.force_authenticate(self.manager2)
        self.assertEqual(self.client.get(image_url).status_code, 404)
        self.client.force_authenticate(self.manager)
        self.assertEqual(self.client.get(image_url).status_code, 200)
        self.assertEqual(len(self.client.get(f'/api/tasks/{task}/').data['photos']), 2)
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.get(image_url).status_code, 200)

    def test_single_and_multiple_unspecified_photos(self):
        self.open()
        for mode in ['single', 'multiple']:
            task = self.task(mode)
            url = f'/api/tasks/{task}/submit/'
            self.assertEqual(self.client.post(url, {}).status_code, 409)
            response = self.client.post(url, {'photos': [photo(), photo()]})
            self.assertEqual(response.status_code, 400 if mode == 'single' else 200)
            if mode == 'single':
                response = self.client.post(url, {'photos': [photo()]})
                self.assertEqual(response.status_code, 200, response.data)
            self.assertEqual([item['label'] for item in response.data['photos']], ['Фото выполнения'] if mode == 'single' else ['Фото 1', 'Фото 2'])

    def test_rework_retains_selected_photos_and_preserves_older_versions(self):
        self.open()
        task = self.task('multiple')
        first = self.client.post(f'/api/tasks/{task}/submit/', {'photos': [photo('one.png'), photo('two.png')]}).data
        original = list(TaskSubmission.objects.get().photos.values_list('image', flat=True))
        self.client.force_authenticate(self.manager)
        self.assertEqual(self.client.post(f'/api/tasks/{task}/review/', {'version': 1, 'accept': False, 'reason': 'Replace the first photo'}).status_code, 200)
        self.client.force_authenticate(self.admin)
        response = self.client.post(f'/api/tasks/{task}/submit/', {
            'photos': [photo('replacement.png')], 'retained_photos': json.dumps([first['photos'][1]['id']]),
        })
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data['photos']), 2)
        self.assertEqual(list(TaskSubmission.objects.get(version=1).photos.values_list('image', flat=True)), original)
        self.assertEqual(TaskSubmission.objects.get(version=2).photos.last().image.name, original[1])
        self.assertEqual(TelegramNotification.objects.count(), 2)

    def test_foreign_or_duplicate_photo_references_are_rejected(self):
        self.open()
        task = self.task('multiple')
        for retained in [['99999'], ['1', '1']]:
            response = self.client.post(f'/api/tasks/{task}/submit/', {'retained_photos': json.dumps(retained)})
            self.assertEqual(response.status_code, 400)
        self.assertFalse(TaskSubmission.objects.exists())

    def test_named_task_configuration_and_slot_validation(self):
        self.open()
        self.client.force_authenticate(self.manager)
        for mode, fields in [('named', []), ('single', [{'id': 'x', 'label': 'Desk'}])]:
            response = self.client.post('/api/tasks/', {'title': 'Task', 'assignee': self.admin.pk, 'photo_mode': mode, 'photo_requirements': json.dumps(fields)})
            self.assertEqual(response.status_code, 400)
        task = self.task('named', [{'id': 'desk', 'label': 'Desk', 'required': True}])
        for slots in [['unknown'], ['desk', 'desk']]:
            response = self.client.post(f'/api/tasks/{task}/submit/', {'photos': [photo() for _ in slots], 'photo_slots': json.dumps(slots)})
            self.assertEqual(response.status_code, 400)

    def test_repeated_upload_idempotency_hash_includes_all_images(self):
        self.open()
        task = self.task('multiple')
        key = str(uuid.uuid4())
        url = f'/api/tasks/{task}/submit/'
        self.assertEqual(self.client.post(url, {'photos': [photo(), photo()]}, HTTP_IDEMPOTENCY_KEY=key).status_code, 200)
        self.assertEqual(self.client.post(url, {'photos': [photo(), photo()]}, HTTP_IDEMPOTENCY_KEY=key).status_code, 200)
        changed = photo()
        changed.file.write(b'changed')
        changed.seek(0)
        self.assertEqual(self.client.post(url, {'photos': [changed, photo()]}, HTTP_IDEMPOTENCY_KEY=key).status_code, 409)
        self.assertEqual(TaskSubmission.objects.count(), 1)
