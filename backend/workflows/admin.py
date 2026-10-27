from django.contrib import admin
from django.utils import timezone
from .models import Activity, PhotoSettings, Shift, ShiftExpense, Task, TaskSubmission, TaskSubmissionPhoto, TelegramNotification


class ReadOnlyAdmin(admin.ModelAdmin):
    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(Shift)
class ShiftAdmin(ReadOnlyAdmin):
    list_display = ['id', 'admin', 'shift_type', 'opened_at', 'closed_at', 'report']
    list_filter = ['shift_type', 'admin']


@admin.register(Task)
class TaskAdmin(ReadOnlyAdmin):
    list_display = ['title', 'creator', 'assignee', 'status', 'created_at']
    list_filter = ['status', 'creator', 'assignee']


@admin.register(TelegramNotification)
class NotificationAdmin(ReadOnlyAdmin):
    list_display = ['id', 'recipient', 'status', 'attempts', 'last_error', 'sent_at']
    list_filter = ['status']
    actions = ['retry_failed']

    @admin.action(description='Повторить отправку выбранных уведомлений', permissions=['view'])
    def retry_failed(self, request, queryset):
        if request.user.is_superuser:
            queryset.filter(status='failed').update(status='pending', attempts=0, next_attempt_at=timezone.now())


admin.site.register(Activity, ReadOnlyAdmin)
admin.site.register(TaskSubmission, ReadOnlyAdmin)
admin.site.register(TaskSubmissionPhoto, ReadOnlyAdmin)
admin.site.register(PhotoSettings, ReadOnlyAdmin)
admin.site.register(ShiftExpense, ReadOnlyAdmin)
