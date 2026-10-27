from api.fields import EvidenceImageField
import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q, Value


class Shift(models.Model):
    admin = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    shift_type = models.CharField(max_length=5, choices=[('day', 'Day'), ('night', 'Night')])
    opened_at = models.DateTimeField(auto_now_add=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    report = models.OneToOneField('reports.Report', on_delete=models.PROTECT, null=True, blank=True, related_name='work_shift')

    class Meta:
        ordering = ['-opened_at']
        constraints = [
            models.UniqueConstraint(Value(1), condition=Q(closed_at__isnull=True), name='one_open_club_shift'),
            models.CheckConstraint(condition=Q(shift_type__in=['day', 'night']), name='valid_shift_type'),
            models.CheckConstraint(condition=Q(closed_at__isnull=True, report__isnull=True) | Q(closed_at__isnull=False, report__isnull=False), name='closed_shift_has_report'),
        ]


class Task(models.Model):
    class Status(models.TextChoices):
        ACTIVE = 'active', 'To do'
        MODERATION = 'moderation', 'On moderation'
        ACCEPTED = 'accepted', 'Accepted'
        REJECTED = 'rejected', 'Needs rework'

    creator = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='assigned_tasks')
    assignee = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='received_tasks')
    shift = models.ForeignKey(Shift, on_delete=models.PROTECT, null=True, blank=True)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    priority = models.CharField(max_length=6, choices=[('normal', 'Normal'), ('high', 'High'), ('low', 'Low')], default='normal')
    requires_photo = models.BooleanField(default=False)
    reference_photo = EvidenceImageField(upload_to='tasks/reference/%Y/%m/', blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.ACTIVE)
    submission_version = models.PositiveIntegerField(default=0)
    rejection_reason = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    accepted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        constraints = [models.CheckConstraint(condition=~Q(creator=models.F('assignee')), name='no_self_assigned_task')]


class TaskSubmission(models.Model):
    task = models.ForeignKey(Task, on_delete=models.PROTECT, related_name='submissions')
    version = models.PositiveIntegerField()
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='+')
    photo = EvidenceImageField(upload_to='tasks/completion/%Y/%m/', blank=True)
    note = models.TextField(blank=True)
    submitted_at = models.DateTimeField(auto_now_add=True)
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name='+')
    reviewed_at = models.DateTimeField(null=True, blank=True)
    decision = models.CharField(max_length=8, choices=[('accepted', 'Accepted'), ('rejected', 'Rejected')], blank=True)
    reason = models.TextField(blank=True)

    class Meta:
        ordering = ['-version']
        constraints = [models.UniqueConstraint(fields=['task', 'version'], name='unique_task_submission_version')]


class ShiftExpense(models.Model):
    shift = models.ForeignKey(Shift, on_delete=models.PROTECT, related_name='expenses')
    expense = models.OneToOneField('reports.Expenses', on_delete=models.PROTECT, related_name='work_shift_expense')


class Activity(models.Model):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    task = models.ForeignKey(Task, on_delete=models.PROTECT, null=True, blank=True)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    kind = models.CharField(max_length=10)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']


class TelegramNotification(models.Model):
    submission = models.OneToOneField(TaskSubmission, on_delete=models.PROTECT)
    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    status = models.CharField(max_length=10, default='pending', choices=[('pending', 'Pending'), ('sending', 'Sending'), ('sent', 'Sent'), ('failed', 'Failed')])
    attempts = models.PositiveIntegerField(default=0)
    next_attempt_at = models.DateTimeField()
    claim_token = models.UUIDField(default=uuid.uuid4)
    last_error = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=['status', 'next_attempt_at'])]


class CommandReceipt(models.Model):
    """A client's retry key makes money-changing POSTs safe after a lost response."""
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    key = models.UUIDField()
    fingerprint = models.CharField(max_length=64)
    response = models.JSONField()
    status_code = models.PositiveSmallIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['user', 'key'], name='unique_employee_command')]
