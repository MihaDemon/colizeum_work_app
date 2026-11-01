from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from rest_framework.test import APITestCase

from .models import Gamepad, PlayStation, PlayStationGamepad


class GamepadTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.manager = User.objects.create_user(username='manager', is_staff=True)
        self.admin = User.objects.create_user(username='admin')
        self.client.force_authenticate(self.manager)
        self.pads = [Gamepad.objects.create(model='DualSense', serial_number=f'PAD-{index}') for index in range(3)]
        self.first = PlayStation.objects.create(club_number=1, serial_number='PS-1')
        self.second = PlayStation.objects.create(club_number=2, serial_number='PS-2')

    def attach(self, console, pads, **data):
        return self.client.patch(f'/api/playstations/{console.pk}/', {'gamepads': [pad.pk for pad in pads], **data}, format='json')

    def test_multiple_gamepads_attach_and_existing_assignments_can_be_saved(self):
        response = self.attach(self.first, self.pads[:2])
        self.assertEqual(response.status_code, 200, response.data)
        self.assertCountEqual(response.data['gamepads'], [pad.pk for pad in self.pads[:2]])
        self.assertEqual(self.attach(self.first, self.pads[:2], info='Не менять подключения').status_code, 200)
        for pad in self.pads[:2]:
            detail = self.client.get(f'/api/gamepads/{pad.pk}/').data
            self.assertEqual(detail['playstation'], self.first.pk)
        self.assertIsNone(self.client.get(f'/api/gamepads/{self.pads[2].pk}/').data['playstation'])

    def test_already_assigned_gamepad_is_not_stolen_and_can_be_released_then_moved(self):
        self.attach(self.first, self.pads[:2])
        response = self.attach(self.second, [self.pads[0]], info='Не должно сохраниться')
        self.assertEqual(response.status_code, 400, response.data)
        self.assertIn('gamepads', response.data)
        self.second.refresh_from_db()
        self.assertFalse(self.second.info)
        self.assertEqual(self.first.gamepads.count(), 2)
        self.assertEqual(self.attach(self.first, [self.pads[1]]).status_code, 200)
        self.assertEqual(self.attach(self.second, [self.pads[0]]).status_code, 200)

    def test_database_protects_exclusivity_and_deleting_console_keeps_devices(self):
        PlayStationGamepad.objects.create(playstation=self.first, gamepad=self.pads[0])
        with self.assertRaises(IntegrityError), transaction.atomic():
            PlayStationGamepad.objects.create(playstation=self.second, gamepad=self.pads[0])
        self.first.delete()
        self.assertEqual(Gamepad.objects.count(), 3)
        self.assertFalse(PlayStationGamepad.objects.exists())

    def test_creating_console_with_multiple_gamepads_and_invalid_lists(self):
        response = self.client.post('/api/playstations/', {'club_number': 3, 'serial_number': 'PS-3', 'gamepads': [pad.pk for pad in self.pads]}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(PlayStation.objects.get(pk=response.data['id']).gamepads.count(), 3)
        self.assertEqual(self.attach(self.first, [self.pads[0], self.pads[0]]).status_code, 400)
        self.assertEqual(self.client.patch(f'/api/playstations/{self.first.pk}/', {'gamepads': [9999]}, format='json').status_code, 400)

    def test_gamepads_have_crud_lookup_and_qr_downloads_with_existing_permissions(self):
        response = self.client.post('/api/gamepads/', {'model': 'DualSense', 'serial_number': 'NEW-PAD'})
        self.assertEqual(response.status_code, 201, response.data)
        pk = response.data['id']
        lookup = self.client.get('/api/gamepads/lookup/?serial_number=NEW-PAD')
        self.assertEqual(lookup.data['id'], pk)
        self.assertIn('/gamepads/lookup/', lookup.data['detail_url'])
        self.assertEqual(self.client.get(f'/api/gamepads/{pk}/qr-code/').status_code, 200)
        link = self.client.get(f'/api/gamepads/{pk}/qr-download/').data
        self.assertEqual(self.client.get(link['url']).status_code, 200)
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.get('/api/gamepads/').status_code, 200)
        self.assertEqual(self.client.patch(f'/api/gamepads/{pk}/', {'model': 'Нельзя'}).status_code, 403)
        self.assertEqual(self.attach(self.first, [self.pads[0]]).status_code, 403)
        self.client.force_authenticate(self.manager)
        self.attach(self.first, [self.pads[0], self.pads[1]])
        self.assertEqual(self.client.delete(f'/api/gamepads/{self.pads[0].pk}/').status_code, 204)
        self.assertEqual(self.first.gamepads.count(), 1)
