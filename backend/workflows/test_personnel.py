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
from .models import Task

User = get_user_model()


@override_settings(TELEGRAM_BOT_TOKEN='test-bot-token', BOT_SERVICE_TOKEN='test-service')
class PersonnelTests(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_user(username='owner', is_superuser=True, is_staff=True)
        self.manager = User.objects.create_user(username='manager', is_staff=True)
        self.admin = User.objects.create_user(username='admin')
        self.client.force_authenticate(self.owner)

    def signed(self, ident=42):
        fields = {'auth_date': str(int(time.time())), 'user': json.dumps({'id': ident})}
        secret = hmac.new(b'WebAppData', b'test-bot-token', hashlib.sha256).digest()
        fields['hash'] = hmac.new(secret, '\n'.join(f'{key}={value}' for key, value in sorted(fields.items())).encode(), hashlib.sha256).hexdigest()
        return urlencode(fields)

    def payload(self, **overrides):
        return dict(first_name='Иван', last_name='Петров', phone_number='+7 (999) 123-45-67', role='admin', is_active=True, **overrides)

    def add(self):
        response = self.client.post('/api/personnel/', self.payload(), format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return AdminUser.objects.get(pk='9991234567')

    def test_only_superuser_can_read_or_write_and_cannot_edit_superuser(self):
        card = AdminUser.objects.create(phone_number='9991234567')
        self.owner.phone_number = card
        self.owner.save()
        response = self.client.get('/api/personnel/')
        self.assertNotIn(card.pk, [item['id'] for item in response.data['results']])
        self.assertEqual(self.client.patch(f'/api/personnel/{card.pk}/', {'is_active': False}, format='json').status_code, 403)
        for actor in (self.manager, self.admin):
            self.client.force_authenticate(actor)
            for method, path, data in [('get', '/api/personnel/', {}), ('post', '/api/personnel/', self.payload()), ('patch', f'/api/personnel/{card.pk}/', {'is_active': False})]:
                self.assertEqual(getattr(self.client, method)(path, data, format='json').status_code, 403)
        card.refresh_from_db()
        self.assertTrue(card.is_active)

    def test_create_invitation_and_validate_duplicates_names_and_roles(self):
        card = self.add()
        self.assertEqual((card.first_name, card.role), ('Иван', 'admin'))
        self.assertFalse(User.objects.filter(phone_number=card).exists())
        self.assertEqual(self.client.post('/api/personnel/', self.payload(), format='json').status_code, 400)
        for values in ({'first_name': ''}, {'role': 'superuser'}, {'is_superuser': True}, {'phone_number': '123'}):
            payload = self.payload()
            payload.update(values)
            with self.subTest(values=values):
                self.assertEqual(self.client.post('/api/personnel/', payload, format='json').status_code, 400)
        response = self.client.patch(f'/api/personnel/{card.pk}/', {'role': 'manager'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['role'], 'manager')

    def test_disable_registered_staff_revokes_token_and_blocks_telegram_until_reactivated(self):
        card = self.add()
        card.telegram_id = '42'
        card.save()
        linked = User.objects.create_user(username='linked', phone_number=card, telegram_id='42')
        token = Token.objects.create(user=linked)
        response = self.client.patch(f'/api/personnel/{card.pk}/', {'is_active': False}, format='json')
        self.assertEqual(response.status_code, 200)
        linked.refresh_from_db()
        self.assertFalse(linked.is_active)
        self.assertFalse(Token.objects.filter(user=linked).exists())
        self.client.force_authenticate(None)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {token.key}')
        self.assertEqual(self.client.get('/api/workspace/').status_code, 401)
        self.client.credentials()
        self.assertEqual(self.client.post('/api/telegram/telegram/', {'initData': self.signed()}, format='json').status_code, 403)
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.client.patch(f'/api/personnel/{card.pk}/', {'is_active': True}, format='json').status_code, 200)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.post('/api/telegram/telegram/', {'initData': self.signed()}, format='json').status_code, 200)

    def test_inactive_invitation_blocks_contact_binding_status_and_registration(self):
        card = self.add()
        self.client.patch(f'/api/personnel/{card.pk}/', {'is_active': False}, format='json')
        self.client.force_authenticate(None)
        payload = {'telegram_id': '42', 'phone_number': '9991234567'}
        self.assertEqual(self.client.post('/api/bot/contact/', payload, HTTP_X_BOT_SERVICE_TOKEN='test-service').status_code, 403)
        card.telegram_id = '42'
        card.save(update_fields=['telegram_id'])
        self.assertEqual(self.client.post('/api/telegram/contact-status/', {'initData': self.signed()}, format='json').status_code, 403)
        self.assertEqual(self.client.post('/api/telegram/telegram/', {'initData': self.signed(), 'username': 'invited', 'phone_number': card.pk}, format='json').status_code, 403)
        self.assertFalse(User.objects.filter(phone_number=card).exists())

    def test_edit_registered_phone_keeps_login_task_and_telegram_link(self):
        card = self.add()
        card.telegram_id = '42'
        card.save()
        linked = User.objects.create_user(username='linked', phone_number=card, telegram_id='42')
        task = Task.objects.create(creator=self.owner, assignee=linked, title='Проверка')
        response = self.client.patch(f'/api/personnel/{card.pk}/', {'first_name': 'Пётр', 'last_name': 'Иванов', 'phone_number': '9991234500', 'role': 'manager'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['id'], '9991234500')
        self.assertTrue(response.data['registered'])
        self.assertFalse(AdminUser.objects.filter(pk=card.pk).exists())
        linked.refresh_from_db()
        self.assertEqual((linked.phone_number_id, linked.first_name, linked.last_name, linked.is_staff), ('9991234500', 'Пётр', 'Иванов', True))
        self.assertEqual(linked.telegram_id, linked.phone_number.telegram_id)
        task.refresh_from_db()
        self.assertEqual(task.assignee_id, linked.pk)

    def test_unregistered_phone_edit_resets_contact_verification(self):
        card = self.add()
        card.telegram_id = '42'
        card.save()
        response = self.client.patch(f'/api/personnel/{card.pk}/', {'phone_number': '9991234500'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(AdminUser.objects.get(pk='9991234500').telegram_id)

    def test_accounts_without_phone_are_listed_editable_and_can_be_linked(self):
        item = next(item for item in self.client.get('/api/personnel/').data['results'] if item['id'] == f'user-{self.admin.pk}')
        self.assertEqual(item['phone_number'], '')
        response = self.client.patch(f'/api/personnel/{item["id"]}/', {'is_active': False, 'role': 'manager'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.admin.refresh_from_db()
        self.assertFalse(self.admin.is_active)
        self.assertTrue(self.admin.is_staff)
        response = self.client.patch(f'/api/personnel/{item["id"]}/', {'is_active': True, 'phone_number': '+7 999 123-45-67', 'first_name': 'Анна', 'last_name': 'Белова'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['id'], '9991234567')
        self.assertTrue(response.data['is_active'])
