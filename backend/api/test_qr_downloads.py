import time
from urllib.parse import urlsplit
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core import signing
from django.test import override_settings
from rest_framework.test import APITestCase

from api.downloads import QR_DOWNLOAD_MAX_AGE, QR_DOWNLOAD_SALT
from computers.models import Headset, Keyboard, Monitor, Mouse, PC, PlayStation, Station


@override_settings(WEBAPP_URL='https://work.example.com')
class QRDownloadTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username='administrator')
        self.station = Station.objects.create(club_number=12)
        self.client.force_authenticate(self.user)

    def link(self, resource='stations', device=None):
        device = device or self.station
        response = self.client.get(f'/api/{resource}/{device.pk}/qr-download/')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response['Cache-Control'], 'no-store')
        self.assertTrue(response.data['url'].startswith('https://work.example.com/api/device-qr/'))
        return urlsplit(response.data['url']).path

    def test_authenticated_administrators_can_download_each_device_type(self):
        devices = [('stations', self.station)]
        for resource, model in [('mice', Mouse), ('keyboards', Keyboard), ('headsets', Headset), ('monitors', Monitor)]:
            devices.append((resource, model.objects.create(model=resource, serial_number=resource)))
        devices.append(('pcs', PC.objects.create(serial_number='pc', cpu='cpu', gpu='gpu', ram='ram', storage='storage')))
        devices.append(('playstations', PlayStation.objects.create(club_number=1, serial_number='console')))
        for resource, device in devices:
            with self.subTest(resource=resource):
                self.client.force_authenticate(self.user)
                path = self.link(resource, device)
                self.client.force_authenticate(None)
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.content.startswith(b'\x89PNG\r\n\x1a\n'))
                self.assertEqual(response['Content-Type'], 'image/png')
                self.assertEqual(response['Content-Disposition'], f'attachment; filename="{device._meta.model_name}-{device.pk}-qr.png"')
                self.assertEqual(response['Access-Control-Allow-Origin'], 'https://web.telegram.org')
                self.assertEqual(response['Cache-Control'], 'private, no-store')

    def test_minting_and_preview_require_authentication(self):
        self.client.force_authenticate(None)
        for action in ['qr-download', 'qr-code']:
            self.assertEqual(self.client.get(f'/api/stations/{self.station.pk}/{action}/').status_code, 401)

    def test_download_accepts_head_without_an_api_token(self):
        path = self.link()
        self.client.force_authenticate(None)
        response = self.client.head(path)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response['Content-Disposition'].startswith('attachment;'))
        self.assertEqual(response.content, b'')

    def test_tampered_expired_and_unrelated_signatures_are_rejected(self):
        path = self.link()
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(path[:-2] + 'x/').status_code, 404)
        with patch('django.core.signing.time.time', return_value=time.time() + QR_DOWNLOAD_MAX_AGE + 1):
            self.assertEqual(self.client.get(path).status_code, 404)
        data = {'kind': 'station', 'pk': self.station.pk, 'user': self.user.pk}
        ticket = signing.dumps(data, salt='unrelated-download')
        self.assertEqual(self.client.get(f'/api/device-qr/{ticket}/').status_code, 404)
        data['kind'] = 'user'
        ticket = signing.dumps(data, salt=QR_DOWNLOAD_SALT)
        self.assertEqual(self.client.get(f'/api/device-qr/{ticket}/').status_code, 404)

    def test_disabling_the_requesting_account_revokes_download_links(self):
        path = self.link()
        self.user.is_active = False
        self.user.save(update_fields=['is_active'])
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(path).status_code, 404)

    def test_deleted_devices_cannot_be_downloaded(self):
        path = self.link()
        self.station.delete()
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(path).status_code, 404)
