from api.fields import EvidenceImageField
import uuid

from django.conf import settings
from django.utils import timezone
from django.db import models
from django.db.models import Q, Value
from .photos import default_report_fields
from users.history import UserHistory


class PhotoSettings(models.Model):
    report_fields = models.JSONField(default=default_report_fields, blank=True, verbose_name='Поля фотографий отчёта')
    version = models.PositiveIntegerField(default=1, verbose_name='Версия')

    class Meta:
        verbose_name = 'Настройки фотографий'
        verbose_name_plural = 'Настройки фотографий'


class Shift(UserHistory):
    schedule_revision = models.ForeignKey('ScheduleRevision', on_delete=models.PROTECT, null=True, blank=True, verbose_name='План при открытии')
    schedule_date = models.DateField(null=True, blank=True, verbose_name='Дата в графике')
    proposed_admin = models.JSONField(default=dict, editable=False, verbose_name='Назначенный сотрудник при открытии')
    photo_requirements = models.JSONField(default=default_report_fields, blank=True, verbose_name='Требования к фотографиям')
    admin = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, verbose_name='Администратор')
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


class Task(UserHistory):
    class Status(models.TextChoices):
        ACTIVE = 'active', 'К выполнению'
        MODERATION = 'moderation', 'На проверке'
        ACCEPTED = 'accepted', 'Принято'
        REJECTED = 'rejected', 'На доработке'

    creator = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='assigned_tasks', verbose_name='Постановщик')
    assignee = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='received_tasks', verbose_name='Исполнитель')
    shift = models.ForeignKey(Shift, on_delete=models.PROTECT, null=True, blank=True, verbose_name='Смена')
    title = models.CharField(max_length=200, verbose_name='Название')
    description = models.TextField(blank=True, verbose_name='Описание')
    priority = models.CharField(max_length=6, choices=[('normal', 'Обычный'), ('high', 'Высокий'), ('low', 'Низкий')], default='normal', verbose_name='Приоритет')
    requires_photo = models.BooleanField(default=False, verbose_name='Обязательны фотографии')
    photo_mode = models.CharField(max_length=8, choices=[('optional', 'Необязательное фото'), ('single', 'Одно фото'), ('multiple', 'Несколько фото'), ('named', 'Именованные фотографии')], default='optional', verbose_name='Режим фотографий')
    photo_requirements = models.JSONField(default=list, blank=True, verbose_name='Требования к фотографиям')
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


class TaskSubmission(UserHistory):
    task = models.ForeignKey(Task, on_delete=models.PROTECT, related_name='submissions', verbose_name='Задача')
    version = models.PositiveIntegerField(verbose_name='Версия')
    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+', verbose_name='Исполнитель')
    photo = EvidenceImageField(upload_to='tasks/completion/%Y/%m/', blank=True, verbose_name='Фотография')
    note = models.TextField(blank=True, verbose_name='Комментарий')
    submitted_at = models.DateTimeField(auto_now_add=True, verbose_name='Отправлено на проверку')
    reviewed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+', verbose_name='Проверил')
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


class Activity(UserHistory):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, verbose_name='Сотрудник')
    task = models.ForeignKey(Task, on_delete=models.PROTECT, null=True, blank=True, verbose_name='Задача')
    title = models.CharField(max_length=200, verbose_name='Название')
    description = models.TextField(blank=True, verbose_name='Описание')
    kind = models.CharField(max_length=10, verbose_name='Тип события')
    created_at = models.DateTimeField(auto_now_add=True, verbose_name='Создано')

    class Meta:
        verbose_name = 'Событие'
        verbose_name_plural = 'События'
        ordering = ['-created_at']


class CleanerVisit(UserHistory):
    shift = models.OneToOneField(Shift, on_delete=models.PROTECT, related_name='cleaner_visit', verbose_name='Смена')
    admin = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, verbose_name='Администратор')
    occurred_at = models.DateTimeField(default=timezone.now, verbose_name='Время прихода')

    class Meta:
        verbose_name = 'Приход уборщицы'
        verbose_name_plural = 'Приходы уборщицы'
        ordering = ['-occurred_at', '-pk']


class TelegramNotification(UserHistory):
    schedule = models.ForeignKey('SchedulePeriod', on_delete=models.PROTECT, null=True, blank=True, verbose_name='График')
    kind = models.CharField(max_length=12, default='task', choices=[('task', 'Задача'), ('shift_open', 'Открытие смены'), ('shift_close', 'Закрытие смены'), ('expense', 'Расход'), ('cleaner', 'Уборщица'), ('schedule', 'Итоговый график')], verbose_name='Событие')
    message = models.TextField(blank=True, verbose_name='Текст уведомления')
    submission = models.OneToOneField(TaskSubmission, on_delete=models.PROTECT, null=True, blank=True, verbose_name='Выполнение задачи')
    shift = models.ForeignKey(Shift, on_delete=models.PROTECT, null=True, blank=True, verbose_name='Смена')
    expense = models.ForeignKey('reports.Expenses', on_delete=models.PROTECT, null=True, blank=True, verbose_name='Расход')
    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, verbose_name='Получатель')
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
        constraints = [
            models.CheckConstraint(condition=(
                Q(kind='task', submission__isnull=False, shift__isnull=True, expense__isnull=True, schedule__isnull=True)
                | Q(kind__in=['shift_open', 'shift_close', 'cleaner'], submission__isnull=True, shift__isnull=False, expense__isnull=True, schedule__isnull=True)
                | Q(kind='expense', submission__isnull=True, shift__isnull=True, expense__isnull=False, schedule__isnull=True)
                | Q(kind='schedule', submission__isnull=True, shift__isnull=True, expense__isnull=True, schedule__isnull=False)
            ), name='notification_has_matching_target'),
            models.UniqueConstraint(fields=['kind', 'shift', 'recipient'], condition=Q(shift__isnull=False), name='unique_shift_event_recipient'),
            models.UniqueConstraint(fields=['schedule', 'recipient'], condition=Q(kind='schedule'), name='unique_schedule_recipient'),
            models.UniqueConstraint(fields=['expense', 'recipient'], condition=Q(kind='expense'), name='unique_expense_recipient'),
        ]


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


class ScheduleSettings(models.Model):
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    default_admin = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, verbose_name='Администратор по умолчанию')
    version = models.PositiveIntegerField(default=1, verbose_name='Версия')

    class Meta:
        verbose_name = 'Настройки графика'
        verbose_name_plural = 'Настройки графика'
        constraints = [models.CheckConstraint(condition=Q(pk=1), name='one_schedule_settings')]


class SchedulePeriod(models.Model):
    start = models.DateField(unique=True, verbose_name='Начало периода')
    end = models.DateField(verbose_name='Конец периода')
    version = models.PositiveIntegerField(default=1, verbose_name='Текущая версия')
    summary_image = EvidenceImageField(upload_to='schedules/%Y/%m/', blank=True, verbose_name='Итоговый график')
    summary_created_at = models.DateTimeField(null=True, blank=True, verbose_name='Итог подготовлен')

    class Meta:
        verbose_name = 'График смен'
        verbose_name_plural = 'Графики смен'
        ordering = ['-start']
        constraints = [models.CheckConstraint(condition=Q(end__gte=models.F('start')), name='schedule_valid_dates')]

    def __str__(self):
        return f'{self.start:%d.%m.%Y} — {self.end:%d.%m.%Y}'


class ScheduleRevision(UserHistory):
    period = models.ForeignKey(SchedulePeriod, on_delete=models.PROTECT, related_name='revisions', verbose_name='График')
    number = models.PositiveIntegerField(verbose_name='Версия')
    plan = models.JSONField(default=dict, editable=False, verbose_name='Назначения')
    generation = models.JSONField(default=dict, editable=False, verbose_name='Параметры автозаполнения')
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, verbose_name='Автор изменений')
    created_at = models.DateTimeField(default=timezone.now, verbose_name='Дата изменения')
    source = models.CharField(max_length=12, default='manual', choices=[('initial', 'Создание'), ('manual', 'Вручную'), ('automatic', 'Автоматически'), ('restore', 'Восстановление')], verbose_name='Способ изменения')
    restored_from = models.ForeignKey('self', on_delete=models.PROTECT, null=True, blank=True, verbose_name='Восстановлена версия')

    class Meta:
        verbose_name = 'Версия графика'
        verbose_name_plural = 'Версии графика'
        ordering = ['-number']
        constraints = [models.UniqueConstraint(fields=['period', 'number'], name='unique_schedule_revision')]
