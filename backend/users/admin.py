from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from users.models import AdminUser

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
    list_display = (
        'phone_number',
        'first_name',
        'last_name'
    )
    search_fields = ('phone_number', 'first_name', 'last_name')
