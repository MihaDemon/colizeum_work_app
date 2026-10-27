from django.contrib import admin
from django.utils import timezone
from .models import Activity, CleanerVisit, PhotoSettings, Shift, ShiftExpense, Task, TaskSubmission, TaskSubmissionPhoto, TelegramNotification
from .forms import WorkflowForm


class WorkflowAdmin(admin.ModelAdmin):
    form = WorkflowForm

    def get_readonly_fields(self, request, obj=None):
        return ('user_snapshots',) if hasattr(self.model, 'user_snapshots') else ()

    def has_add_permission(self, request):
        return request.user.is_superuser

    def has_change_permission(self, request, obj=None):
        return request.user.is_superuser

    def has_delete_permission(self, request, obj=None):
        return request.user.is_superuser


@admin.register(Shift)
class ShiftAdmin(WorkflowAdmin):
    list_display = ['id', 'admin', 'shift_type', 'opened_at', 'closed_at', 'report']
    list_filter = ['shift_type', 'admin']


@admin.register(Task)
class TaskAdmin(WorkflowAdmin):
    list_display = ['title', 'creator', 'assignee', 'status', 'created_at']
    list_filter = ['status', 'creator', 'assignee']


@admin.register(TelegramNotification)
class NotificationAdmin(WorkflowAdmin):
    list_display = ['id', 'kind', 'recipient', 'status', 'attempts', 'last_error', 'sent_at']
    list_filter = ['kind', 'status']
    actions = ['retry_failed']

    @admin.action(description='Повторить отправку выбранных уведомлений', permissions=['view'])
    def retry_failed(self, request, queryset):
        if request.user.is_superuser:
            queryset.filter(status='failed').update(status='pending', attempts=0, next_attempt_at=timezone.now())


admin.site.register(Activity, WorkflowAdmin)
admin.site.register(TaskSubmission, WorkflowAdmin)
admin.site.register(TaskSubmissionPhoto, WorkflowAdmin)
admin.site.register(PhotoSettings, WorkflowAdmin)
admin.site.register(ShiftExpense, WorkflowAdmin)


@admin.register(CleanerVisit)
class CleanerVisitAdmin(WorkflowAdmin):
    list_display = ['id', 'shift', 'admin', 'occurred_at']
    list_filter = ['occurred_at', 'admin']
