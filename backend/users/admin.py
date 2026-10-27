from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from users.models import AdminUser
from users.forms import AdminUserForm

User = get_user_model()

admin.site.unregister(Group)


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = (
        'username',
        'phone_number',
        'telegram_id',
        'is_active',
        'is_staff',
    )
    fieldsets = (
        ('Personal Info', {
            'fields': (
                'username',
                'phone_number',
                'telegram_id',
                'email',
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
                'phone_number',
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


@admin.register(AdminUser)
class AdminUserAdmin(admin.ModelAdmin):
    form = AdminUserForm
    list_display = (
        'phone_number',
        'first_name', 'last_name', 'role',
    )
    search_fields = ('phone_number', 'first_name', 'last_name')
    list_filter = ('role',)

    def get_fields(self, request, obj=None):
        fields = ('first_name', 'last_name', 'phone_number', 'role')
        return fields + ('telegram_id',) if obj else fields

    def get_readonly_fields(self, request, obj=None):
        # The bot fills Telegram identity after the employee shares their contact.
        return ('phone_number', 'telegram_id') if obj else ()

    def has_add_permission(self, request):
        return request.user.is_superuser

    def has_change_permission(self, request, obj=None):
        return request.user.is_superuser

    def has_delete_permission(self, request, obj=None):
        return request.user.is_superuser

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        linked = User.objects.filter(phone_number=obj)
        linked.update(first_name=obj.first_name, last_name=obj.last_name)
        if change and 'role' in form.changed_data:
            linked.filter(is_superuser=False).update(is_staff=obj.role == 'manager')
