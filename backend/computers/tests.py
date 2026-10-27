from django.contrib import admin
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.test import RequestFactory, TestCase
from rest_framework.test import APITestCase

from computers.models import Headset, Keyboard, Monitor, Mouse, PC, Station


def create_devices():
    devices = {
        field: model.objects.create(model=field, serial_number=field)
        for field, model in (('mouse', Mouse), ('keyboard', Keyboard),
                             ('headset', Headset), ('monitor', Monitor))
    }
    devices['pc'] = PC.objects.create(serial_number='pc', cpu='cpu', gpu='gpu', ram='ram', storage='storage')
    return devices


class StationDeviceTests(TestCase):
    def setUp(self):
        self.devices = create_devices()
        self.station = Station.objects.create(club_number=1, **self.devices)

    def test_database_enforces_one_station_per_device(self):
        for field, device in self.devices.items():
            with self.subTest(field=field):
                with self.assertRaises(IntegrityError), transaction.atomic():
                    Station.objects.create(club_number=2, **{field: device})
                device.refresh_from_db()
                self.assertEqual(device.station.pk, self.station.pk)
        self.assertEqual(Station.objects.count(), 1)

    def test_unassigned_stations_and_reassignment_are_allowed(self):
        second = Station.objects.create(club_number=2)
        Station.objects.create(club_number=3)
        self.station.mouse = None
        self.station.save(update_fields=['mouse'])
        second.mouse = self.devices['mouse']
        second.save()
        self.assertEqual(Station.objects.get(pk=second.pk).mouse_id, self.devices['mouse'].pk)

    def test_deleting_devices_keeps_station_and_clears_assignments(self):
        for device in self.devices.values():
            device.delete()
        self.station.refresh_from_db()
        for field in self.devices:
            self.assertIsNone(getattr(self.station, f'{field}_id'))

    def test_admin_form_rejects_devices_already_assigned(self):
        user = get_user_model().objects.create_superuser(
            username='manager', email='manager@example.com', password='test', telegram_id='manager',
        )
        request = RequestFactory().get('/admin/computers/station/add/')
        request.user = user
        form_class = admin.site.get_model_admin(Station).get_form(request)
        form = form_class(data={'club_number': 2, **{field: device.pk for field, device in self.devices.items()}})
        self.assertFalse(form.is_valid())
        self.assertTrue(set(self.devices).issubset(form.errors))


class StationApiTests(APITestCase):
    def setUp(self):
        self.devices = create_devices()
        user = get_user_model().objects.create(username='manager', is_staff=True, telegram_id='manager')
        self.client.force_authenticate(user)

    def test_api_rejects_duplicate_assignments_and_keeps_existing_on_edit(self):
        device_ids = {field: device.pk for field, device in self.devices.items()}
        created = self.client.post('/api/stations/', {'club_number': 1, **device_ids}, format='json')
        self.assertEqual(created.status_code, 201, created.data)
        duplicate = self.client.post('/api/stations/', {'club_number': 2, **device_ids}, format='json')
        self.assertEqual(duplicate.status_code, 400)
        self.assertTrue(set(device_ids).issubset(duplicate.data))
        url = f"/api/stations/{created.data['id']}/"
        unchanged = self.client.patch(url, {'info': 'Same devices', **device_ids}, format='json')
        self.assertEqual(unchanged.status_code, 200, unchanged.data)
        self.assertEqual(Station.objects.count(), 1)

    def test_api_allows_release_and_reassignment(self):
        first = Station.objects.create(club_number=1, mouse=self.devices['mouse'])
        second = Station.objects.create(club_number=2)
        response = self.client.patch(f'/api/stations/{second.pk}/', {'mouse': self.devices['mouse'].pk})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.client.patch(f'/api/stations/{first.pk}/', {'mouse': None}, format='json').status_code, 200)
        response = self.client.patch(f'/api/stations/{second.pk}/', {'mouse': self.devices['mouse'].pk})
        self.assertEqual(response.status_code, 200, response.data)

    def test_repeated_models_with_distinct_serial_numbers_are_allowed(self):
        for serial in ('mouse-2', 'mouse-3'):
            response = self.client.post('/api/mice/', {'model': 'mouse', 'serial_number': serial})
            self.assertEqual(response.status_code, 201, response.data)
        duplicate = self.client.post('/api/mice/', {'model': 'Another model', 'serial_number': 'mouse-2'})
        self.assertEqual(duplicate.status_code, 400)
        self.assertIn('serial_number', duplicate.data)
