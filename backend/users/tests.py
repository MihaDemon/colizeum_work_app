import smtplib
from unittest.mock import ANY, patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse


class UserAdminTestEmailTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        admin_user = user_model.objects.create_superuser(
            username='admin', email='admin@example.com',
            telegram_id='admin-telegram', password='admin-password'
        )
        self.user = user_model.objects.create_user(
            username='recipient', email='old@example.com',
            telegram_id='recipient-telegram', password='user-password'
        )
        self.client.force_login(admin_user)
        self.url = reverse('admin:users_user_change', args=[self.user.pk])
        self.send_url = reverse(
            'admin:users_user_send_test_email', args=[self.user.pk]
        )

    def change_data(self, **overrides):
        data = {
            'username': self.user.username,
            'email': self.user.email,
            'telegram_id': self.user.telegram_id,
            'password': self.user.password,
            'is_active': 'on',
        }
        data.update(overrides)
        return data

    def test_button_sends_to_saved_email_without_saving_form(self):
        response = self.client.get(self.url)
        self.assertContains(response, 'Send test email')

        with patch('users.admin.send_mail', return_value=1) as send:
            response = self.client.post(self.send_url, follow=True)

        self.assertEqual(response.status_code, 200)
        self.user.refresh_from_db()
        self.assertEqual(self.user.email, 'old@example.com')
        send.assert_called_once_with(
            'Colizeum Work App SMTP test', ANY, None, ['old@example.com']
        )
        self.assertContains(response, 'Test email sent to old@example.com.')

    def test_normal_save_does_not_send_email(self):
        with patch('users.admin.send_mail') as send:
            response = self.client.post(self.url, self.change_data())

        self.assertEqual(response.status_code, 302)
        send.assert_not_called()

    def test_smtp_failure_is_reported_in_admin(self):
        with patch(
            'users.admin.send_mail',
            side_effect=smtplib.SMTPServerDisconnected('timed out'),
        ):
            response = self.client.post(self.send_url, follow=True)

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Test email to old@example.com failed: timed out')

    def test_get_cannot_send_email(self):
        with patch('users.admin.send_mail') as send:
            response = self.client.get(self.send_url)

        self.assertEqual(response.status_code, 405)
        send.assert_not_called()

    def test_staff_without_change_permission_cannot_send_email(self):
        staff = get_user_model().objects.create_user(
            username='staff', email='staff@example.com',
            telegram_id='staff-telegram', password='staff-password',
            is_staff=True,
        )
        self.client.force_login(staff)

        with patch('users.admin.send_mail') as send:
            response = self.client.post(self.send_url)

        self.assertEqual(response.status_code, 403)
        send.assert_not_called()
