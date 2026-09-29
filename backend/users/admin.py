import smtplib

from django.contrib import admin
from django.contrib import messages
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.core.mail import send_mail
from django.core.exceptions import PermissionDenied
from django.http import Http404, HttpResponseNotAllowed, HttpResponseRedirect
from django.urls import path, reverse

User = get_user_model()

admin.site.unregister(Group)


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    change_form_template = 'admin/users/user/change_form.html'

    list_display = (
        'username', 'email', 'telegram_id', 'is_staff'
    )
    fieldsets = (
        ('Personal Info', {
            'fields': (
                'username',
                'email',
                'telegram_id',
                'password'
            ),
        }),
        ('Permissions', {
            'fields': (
                'is_active',
                'is_staff',
                'is_superuser'
            ),
        }),
        ('Important Dates', {
            'fields': (
                'date_joined',
                'last_login'
            ),
        }),
    )
    add_fieldsets = (
        ('Personal Info', {
            'fields': (
                'username',
                'email',
                'telegram_id',
                'password1',
                'password2'
            ),
        }),
        ('Permissions', {
            'fields': (
                'is_active',
                'is_staff',
                'is_superuser'
            ),
        }),
    )
    readonly_fields = ('date_joined', 'last_login')

    def get_urls(self):
        return [
            path(
                '<path:object_id>/send-test-email/',
                self.admin_site.admin_view(self.send_test_email_view),
                name='users_user_send_test_email',
            ),
        ] + super().get_urls()

    def send_test_email_view(self, request, object_id):
        if request.method != 'POST':
            return HttpResponseNotAllowed(['POST'])

        obj = self.get_object(request, object_id)
        if obj is None:
            raise Http404('User not found')
        if not self.has_change_permission(request, obj):
            raise PermissionDenied

        if not obj.email:
            self.message_user(
                request, 'This user has no email address.', level=messages.ERROR
            )
        else:
            try:
                sent = send_mail(
                    'Colizeum Work App SMTP test',
                    'If you received this email, sending from Django admin works.',
                    None,
                    [obj.email],
                )
            except (OSError, smtplib.SMTPException) as exc:
                self.message_user(
                    request,
                    f'Test email to {obj.email} failed: {exc}',
                    level=messages.ERROR,
                )
            else:
                if sent:
                    self.message_user(
                        request, f'Test email sent to {obj.email}.',
                        level=messages.SUCCESS,
                    )
                else:
                    self.message_user(
                        request,
                        f'Test email to {obj.email} was not sent.',
                        level=messages.ERROR,
                    )

        return HttpResponseRedirect(
            reverse('admin:users_user_change', args=[obj.pk])
        )
