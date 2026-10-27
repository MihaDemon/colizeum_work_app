import hashlib
import hmac
import json
import time
from urllib.parse import urlencode

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.test import override_settings
from django.urls import reverse
from rest_framework.test import APITestCase

from users.forms import AdminUserForm
from users.models import AdminUser

User = get_user_model()


@override_settings(TELEGRAM_BOT_TOKEN='test-bot-token', BOT_SERVICE_TOKEN='test-service')
class StaffRegistrationTests(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_superuser(username='owner')

    def signed(self, telegram_id):
        fields = {'auth_date': str(int(time.time())), 'user': json.dumps({'id': telegram_id})}
        secret = hmac.new(b'WebAppData', b'test-bot-token', hashlib.sha256).digest()
        check = '\n'.join(f'{key}={value}' for key, value in sorted(fields.items()))
        fields['hash'] = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
        return urlencode(fields)

    def share_contact(self, telegram_id, phone):
        return self.client.post('/api/bot/contact/', {
            'telegram_id': str(telegram_id), 'phone_number': phone,
        }, HTTP_X_BOT_SERVICE_TOKEN='test-service')

    def test_superuser_creates_staff_then_employee_creates_linked_user_for_each_role(self):
        for index, role in enumerate(['admin', 'manager']):
            with self.subTest(role=role):
                phone = f'999123456{index}'
                ident = 501 + index
                self.client.force_login(self.owner)
                form = self.client.get(reverse('admin:users_adminuser_add')).context['adminform'].form
                self.assertEqual(set(form.fields), {'first_name', 'last_name', 'phone_number', 'role'})
                response = self.client.post(reverse('admin:users_adminuser_add'), {
                    'first_name': 'Алексей', 'last_name': 'Смирнов',
                    'phone_number': f'+7 ({phone[:3]}) {phone[3:6]}-{phone[6:8]}-{phone[8:]}',
                    'role': role, '_save': 'Save', 'telegram_id': 'attacker-controlled',
                })
                self.assertEqual(response.status_code, 302)
                contact = AdminUser.objects.get(pk=phone)
                self.assertIsNone(contact.telegram_id)
                self.assertFalse(User.objects.filter(phone_number=contact).exists())
                self.client.logout()
                signed = self.signed(ident)
                self.assertEqual(self.client.post('/api/telegram/telegram/', {'initData': signed}).status_code, 404)
                self.assertEqual(self.share_contact(ident, '+7' + phone).status_code, 200)
                self.assertFalse(User.objects.filter(phone_number=contact).exists())
                response = self.client.post('/api/telegram/contact-status/', {'initData': signed})
                self.assertEqual(response.data, {'verified': True, 'phone_number': phone})
                response = self.client.post('/api/telegram/telegram/', {
                    'initData': signed, 'username': f'employee_{role}', 'phone_number': phone,
                    'first_name': 'Forged', 'is_superuser': True, 'is_staff': True, 'role': 'superuser',
                })
                self.assertEqual(response.status_code, 201, response.data)
                account = User.objects.get(phone_number=contact)
                self.assertEqual((account.first_name, account.last_name), ('Алексей', 'Смирнов'))
                self.assertEqual(account.telegram_id, str(ident))
                self.assertEqual(account.is_staff, role == 'manager')
                self.assertFalse(account.is_superuser)
                self.assertFalse(account.has_usable_password())
                again = self.client.post('/api/telegram/telegram/', {'initData': signed})
                self.assertEqual(again.status_code, 200)
                self.assertEqual(again.data['token'], response.data['token'])

    def test_staff_form_requires_names_and_a_valid_phone(self):
        for phone in ['123', 'abc9991234567', '+19991234567']:
            with self.subTest(phone=phone):
                form = AdminUserForm(data={'first_name': '', 'last_name': '', 'phone_number': phone, 'role': 'admin'})
                self.assertFalse(form.is_valid())
                self.assertTrue({'first_name', 'last_name', 'phone_number'}.issubset(form.errors))

    def test_form_rejects_duplicate_numbers_in_different_formats(self):
        AdminUser.objects.create(phone_number='+79991234567', first_name='Existing', last_name='Employee')
        form = AdminUserForm(data={'first_name': 'New', 'last_name': 'Employee', 'phone_number': '8 (999) 123-45-67', 'role': 'admin'})
        self.assertFalse(form.is_valid())
        self.assertIn('phone_number', form.errors)

    def test_legacy_formatted_staff_phone_keeps_its_original_account_link(self):
        contact = AdminUser.objects.create(phone_number='+79991234567', first_name='Алексей', last_name='Смирнов')
        self.assertEqual(self.share_contact(502, '89991234567').status_code, 200)
        signed = self.signed(502)
        self.assertEqual(self.client.post('/api/telegram/contact-status/', {'initData': signed}).data['phone_number'], '9991234567')
        response = self.client.post('/api/telegram/telegram/', {'initData': signed, 'username': 'legacy', 'phone_number': '9991234567'})
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(User.objects.get(username='legacy').phone_number_id, contact.pk)
        self.assertEqual(AdminUser.objects.get().pk, '+79991234567')

    def test_duplicate_legacy_phones_do_not_bind_an_arbitrary_employee(self):
        AdminUser.objects.create(phone_number='9991234567')
        AdminUser.objects.create(phone_number='+79991234567')
        self.assertEqual(self.share_contact(502, '+79991234567').status_code, 400)
        self.assertFalse(AdminUser.objects.exclude(telegram_id=None).exists())

    def test_contact_without_a_precreated_staff_record_cannot_register(self):
        self.assertEqual(self.share_contact(502, '+79991234567').status_code, 404)
        response = self.client.post('/api/telegram/telegram/', {'initData': self.signed(502), 'username': 'unknown', 'phone_number': '9991234567'})
        self.assertEqual(response.status_code, 403)
        self.assertFalse(User.objects.filter(username='unknown').exists())

    def test_staff_record_creation_is_reserved_for_superusers(self):
        manager = User.objects.create_user(username='manager', is_staff=True)
        manager.user_permissions.add(Permission.objects.get(codename='add_adminuser'))
        self.client.force_login(manager)
        response = self.client.post(reverse('admin:users_adminuser_add'), {
            'first_name': 'New', 'last_name': 'Employee', 'phone_number': '9991234567', 'role': 'admin',
        })
        self.assertEqual(response.status_code, 403)
        self.assertFalse(AdminUser.objects.exists())

    def test_superuser_updates_names_and_role_through_the_staff_record(self):
        contact = AdminUser.objects.create(phone_number='9991234567', first_name='Old', last_name='Name')
        account = User.objects.create_user(username='employee', phone_number=contact)
        self.client.force_login(self.owner)
        url = reverse('admin:users_adminuser_change', args=[contact.pk])
        for role in ['manager', 'admin']:
            response = self.client.post(url, {'first_name': 'Алексей', 'last_name': 'Смирнов', 'role': role, '_save': 'Save'})
            self.assertEqual(response.status_code, 302)
            account.refresh_from_db()
            self.assertEqual((account.first_name, account.last_name), ('Алексей', 'Смирнов'))
            self.assertEqual(account.is_staff, role == 'manager')
            self.assertEqual(account.phone_number_id, contact.pk)
            self.assertFalse(account.is_superuser)
