from api.fields import EvidenceImageField
import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q, Value
from .photos import default_report_fields


class PhotoSettings(models.Model):
    report_fields = models.JSONField(default=default_report_fields, verbose_name='Поля фотографий отчёта')
    version = models.PositiveIntegerField(default=1, verbose_name='Версия')

    class Meta:
        verbose_name = 'Настройки фотографий'
        verbose_name_plural = 'Настройки фотографий'


class Shift(models.Model):
    photo_requirements = models.JSONField(default=default_report_fields, verbose_name='Требования к фотографиям')
    admin = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, verbose_name='Администратор')
    shift_type = models.CharField(max_length=5, choices=[('day', 'День'), ('night', 'Ночь')], verbose_name='Тип смены')
    opened_at = models.DateTimeField(auto_now_add=True, verbose_name='Открыта')
    closed_at = models.DateTimeField(null=True, blank=True, verbose_name='Закрыта')
    report = models.OneToOneField('reports.Report', on_delete=models.PROTECT, null=True, blank=True, related_name='work_shift', verbose_name='Отчёт')

    class Meta:
        verbose_name = 'Смена'
        verbose_name_plural = 'Смены'
        ordering = ['-opened_at']
        constraints = [
            models.UniqueConstraint(Value(1), condition=Q(closed_at__isnull=True), name='one_open_club_shift'),
            models.CheckConstraint(condition=Q(shift_type__in=['day', 'night']), name='valid_shift_type'),
            models.CheckConstraint(condition=Q(closed_at__isnull=True, report__isnull=True) | Q(closed_at__isnull=False, report__isnull=False), name='closed_shift_has_report'),
        ]


class Task(models.Model):
    class Status(models.TextChoices):
        ACTIVE = 'active', 'К выполнению'
        MODERATION = 'moderation', 'На проверке'
        ACCEPTED = 'accepted', 'Принято'
        REJECTED = 'rejected', 'На доработке'

    creator = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='assigned_tasks', verbose_name='Постановщик')
    assignee = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='received_tasks', verbose_name='Исполнитель')
    shift = models.ForeignKey(Shift, on_delete=models.PROTECT, null=True, blank=True, verbose_name='Смена')
    title = models.CharField(max_length=200, verbose_name='Название')
    description = models.TextField(blank=True, verbose_name='Описание')
    priority = models.CharField(max_length=6, choices=[('normal', 'Обычный'), ('high', 'Высокий'), ('low', 'Низкий')], default='normal', verbose_name='Приоритет')
    requires_photo = models.BooleanField(default=False, verbose_name='Обязательны фотографии')
    photo_mode = models.CharField(max_length=8, choices=[('optional', 'Необязательное фото'), ('single', 'Одно фото'), ('multiple', 'Несколько фото'), ('named', 'Именованные фотографии')], default='optional', verbose_name='Режим фотографий')
    photo_requirements = models.JSONField(default=list, verbose_name='Требования к фотографиям')
    reference_photo = EvidenceImageField(upload_to='tasks/reference/%Y/%m/', blank=True, verbose_name='Фото-пример')
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.ACTIVE, verbose_name='Статус')
    submission_version = models.PositiveIntegerField(default=0, verbose_name='Версия выполнения')
    rejection_reason = models.TextField(blank=True, verbose_name='Причина доработки')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Создано')
    submitted_at = models.DateTimeField(null=True, blank=True, verbose_name='Отправлено на проверку')
    accepted_at = models.DateTimeField(null=True, blank=True, verbose_name='Принято')

    class Meta:
        verbose_name = 'Задача'
        verbose_name_plural = 'Задачи'
        ordering = ['-created_at']
        constraints = [models.CheckConstraint(condition=~Q(creator=models.F('assignee')), name='no_self_assigned_task')]


class TaskSubmission(models.Model):
    task = models.ForeignKey(Task, on_delete=models.PROTECT, related_name='submissions', verbose_name='Задача')
    version = models.PositiveIntegerField(verbose_name='Версия')
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='+', verbose_name='Исполнитель')
    photo = EvidenceImageField(upload_to='tasks/completion/%Y/%m/', blank=True, verbose_name='Фотография')
    note = models.TextField(blank=True, verbose_name='Комментарий')
    submitted_at = models.DateTimeField(auto_now_add=True, verbose_name='Отправлено на проверку')
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, null=True, blank=True, related_name='+', verbose_name='Проверил')
    reviewed_at = models.DateTimeField(null=True, blank=True, verbose_name='Дата проверки')
    decision = models.CharField(max_length=8, choices=[('accepted', 'Принято'), ('rejected', 'Отклонено')], blank=True, verbose_name='Решение')
    reason = models.TextField(blank=True, verbose_name='Причина')

    class Meta:
        verbose_name = 'Выполнение задачи'
        verbose_name_plural = 'Выполнения задач'
        ordering = ['-version']
        constraints = [models.UniqueConstraint(fields=['task', 'version'], name='unique_task_submission_version')]


class TaskSubmissionPhoto(models.Model):
    submission = models.ForeignKey(TaskSubmission, on_delete=models.PROTECT, related_name='photos', verbose_name='Выполнение задачи')
    image = EvidenceImageField(upload_to='tasks/completion/%Y/%m/', verbose_name='Фотография')
    slot = models.CharField(max_length=64, blank=True, verbose_name='Идентификатор поля')
    label = models.CharField(max_length=100, blank=True, verbose_name='Название фотографии')

    class Meta:
        verbose_name = 'Фото выполнения'
        verbose_name_plural = 'Фото выполнения'
        ordering = ['pk']


class ShiftExpense(models.Model):
    shift = models.ForeignKey(Shift, on_delete=models.PROTECT, related_name='expenses', verbose_name='Смена')
    expense = models.OneToOneField('reports.Expenses', on_delete=models.PROTECT, related_name='work_shift_expense', verbose_name='Расход')

    class Meta:
        verbose_name = 'Расход смены'
        verbose_name_plural = 'Расходы смен'


class Activity(models.Model):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, verbose_name='Сотрудник')
    task = models.ForeignKey(Task, on_delete=models.PROTECT, null=True, blank=True, verbose_name='Задача')
    title = models.CharField(max_length=200, verbose_name='Название')
    description = models.TextField(blank=True, verbose_name='Описание')
    kind = models.CharField(max_length=10, verbose_name='Тип события')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Создано')

    class Meta:
        verbose_name = 'Событие'
        verbose_name_plural = 'События'
        ordering = ['-created_at']


class TelegramNotification(models.Model):
    submission = models.OneToOneField(TaskSubmission, on_delete=models.PROTECT, verbose_name='Выполнение задачи')
    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, verbose_name='Получатель')
    status = models.CharField(max_length=10, default='pending', choices=[('pending', 'Ожидает отправки'), ('sending', 'Отправляется'), ('sent', 'Отправлено'), ('failed', 'Ошибка отправки')], verbose_name='Статус')
    attempts = models.PositiveIntegerField(default=0, verbose_name='Попытки отправки')
    next_attempt_at = models.DateTimeField(verbose_name='Следующая попытка')
    claim_token = models.UUIDField(default=uuid.uuid4, verbose_name='Идентификатор обработки')
    last_error = models.CharField(max_length=200, blank=True, verbose_name='Последняя ошибка')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Создано')
    sent_at = models.DateTimeField(null=True, blank=True, verbose_name='Отправлено')

    class Meta:
        verbose_name = 'Уведомление Telegram'
        verbose_name_plural = 'Уведомления Telegram'
        indexes = [models.Index(fields=['status', 'next_attempt_at'])]


class CommandReceipt(models.Model):
    """A client's retry key makes money-changing POSTs safe after a lost response."""
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, verbose_name='Пользователь')
    key = models.UUIDField(verbose_name='Ключ запроса')
    fingerprint = models.CharField(max_length=64, verbose_name='Отпечаток запроса')
    response = models.JSONField(verbose_name='Ответ')
    status_code = models.PositiveSmallIntegerField(verbose_name='Код ответа')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Создано')

    class Meta:
        verbose_name = 'Команда'
        verbose_name_plural = 'Команды'
        constraints = [models.UniqueConstraint(fields=['user', 'key'], name='unique_employee_command')]
