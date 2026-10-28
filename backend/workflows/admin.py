from django.contrib import admin
from django.utils import timezone
from .models import Activity, CleanerVisit, NotificationPreferences, PhotoSettings, SchedulePeriod, ScheduleRevision, ScheduleSettings, Shift, ShiftExpense, Task, TaskSubmission, TaskSubmissionPhoto, TelegramNotification
from .forms import WorkflowForm


class WorkflowAdmin(admin.ModelAdmin):
    form = WorkflowForm

    def get_readonly_fields(self, request, obj=None):
        return tuple(field.name for field in self.model._meta.fields if not field.editable and not field.primary_key)

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
admin.site.register(NotificationPreferences, WorkflowAdmin)
admin.site.register(ShiftExpense, WorkflowAdmin)


@admin.register(CleanerVisit)
class CleanerVisitAdmin(WorkflowAdmin):
    list_display = ['id', 'shift', 'admin', 'occurred_at']
    list_filter = ['occurred_at', 'admin']


admin.site.register(SchedulePeriod, WorkflowAdmin)
admin.site.register(ScheduleRevision, WorkflowAdmin)


@admin.register(ScheduleSettings)
class ScheduleSettingsAdmin(WorkflowAdmin):
    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        if db_field.name == 'default_admin':
            from .schedules import active_admins
            kwargs['queryset'] = active_admins()
        return super().formfield_for_foreignkey(db_field, request, **kwargs)
