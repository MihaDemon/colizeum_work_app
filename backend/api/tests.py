import hashlib
import hmac
import json
import time
from urllib.parse import urlencode

from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from users.models import AdminUser


@override_settings(TELEGRAM_BOT_TOKEN='test-bot-token')
class TelegramFrontendIntegrationTests(APITestCase):
    def signed_data(self, telegram_id):
        fields = {'auth_date': str(int(time.time())), 'user': json.dumps({'id': telegram_id})}
        secret = hmac.new(b'WebAppData', b'test-bot-token', hashlib.sha256).digest()
        data = '\n'.join(f'{key}={value}' for key, value in sorted(fields.items()))
        fields['hash'] = hmac.new(secret, data.encode(), hashlib.sha256).hexdigest()
        return urlencode(fields)

    def test_anonymous_login_reaches_telegram_validation(self):
        response = self.client.post('/api/telegram/telegram/', {'initData': 'invalid'})
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data['error'], 'Неверные данные Telegram')

    def test_unknown_telegram_user_requires_registration(self):
        response = self.client.post('/api/telegram/telegram/', {'initData': self.signed_data(42)})
        self.assertEqual(response.status_code, 404)
        self.assertIn('require_registration', response.data)

    def test_registration_then_profile(self):
        AdminUser.objects.create(phone_number='9991234567', first_name='Алексей', last_name='Смирнов', telegram_id='42')
        response = self.client.post('/api/telegram/telegram/', {
            'initData': self.signed_data(42), 'username': 'shift_admin', 'phone_number': '9991234567',
        })
        self.assertEqual(response.status_code, 201)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {response.data['token']}")
        profile = self.client.get('/api/telegram/me/')
        self.assertEqual(profile.status_code, 200)
        self.assertEqual(profile.data['first_name'], 'Алексей')
        self.assertEqual(profile.data['phone_number'], '9991234567')
        self.assertFalse(profile.data['is_staff'])

    def test_existing_user_can_log_in_without_an_existing_token(self):
        get_user_model().objects.create(username='known', telegram_id='42')
        response = self.client.post('/api/telegram/telegram/', {'initData': self.signed_data(42)})
        self.assertEqual(response.status_code, 200)
        self.assertIn('token', response.data)

    def test_profile_requires_authentication_and_exposes_staff_role(self):
        self.assertEqual(self.client.get('/api/telegram/me/').status_code, 401)
        user = get_user_model().objects.create(username='manager', telegram_id='43', is_staff=True)
        token = Token.objects.create(user=user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {token.key}')
        response = self.client.get('/api/telegram/me/')
        self.assertTrue(response.data['is_staff'])
        self.assertEqual(response.data['first_name'], '')
