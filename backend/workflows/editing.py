"""Corrections to recorded work, serialized with all other cash operations."""
import hashlib
import json
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import transaction
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied, ValidationError

from reports.models import Expenses, ExpensePhoto, Report, ReportPhoto
from .models import Shift
from .photos import uploaded_photos, MAX_PHOTOS
from .serializers import ExpenseSerializer, PhotoUploadSerializer
from .services import Conflict, event, lock_register


def record_version(record):
    fields = ('admin_id', 'shift_type', 'schedule_date', 'opened_at', 'closed_at', 'forced_close_reason') if isinstance(record, Shift) else (
        ('admin_id', 'shift', 'date', 'cash', 'cards', 'spb', 'info') if isinstance(record, Report)
        else ('admin_id', 'amount', 'info', 'from_register'))
    money_fields = {'cash', 'cards', 'spb', 'amount'}
    values = [format(Decimal(getattr(record, field)), '.2f') if field in money_fields else getattr(record, field) for field in fields]
    report = record.report if isinstance(record, Shift) else record
    if isinstance(record, Shift):
        values.extend([format(Decimal(value), '.2f') for value in (report.cash, report.cards, report.spb)])
        values.append(report.info)
        values.extend([report.admin_id, report.shift, report.date])
    values.append(sorted((p.pk, p.image.name, getattr(p, 'label', '')) for p in report.photos.all()))
    return hashlib.sha256(json.dumps(values, default=str).encode()).hexdigest()


class EditExpenseSerializer(ExpenseSerializer):
    version = serializers.CharField()
    remove_photo = serializers.BooleanField(default=False)

    def validate(self, attrs):
        if attrs.get('photo') and attrs['remove_photo']:
            raise serializers.ValidationError('Выберите замену фото или удаление.')
        return attrs


class EditShiftSerializer(PhotoUploadSerializer):
    version = serializers.CharField()
    admin_id = serializers.IntegerField(min_value=1, allow_null=True)
    shift_type = serializers.ChoiceField(choices=['day', 'night'])
    schedule_date = serializers.DateField()
    opened_at = serializers.DateTimeField(required=False)
    closed_at = serializers.DateTimeField(required=False)
    cash = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0)
    cards = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0)
    sbp = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=0)
    info = serializers.CharField(max_length=10000, allow_blank=True, default='')
    forced_close_reason = serializers.CharField(max_length=2000, allow_blank=True, required=False)
    retained_photos = serializers.JSONField(required=False)
    photo_labels = serializers.JSONField(required=False)
    retained_photo_labels = serializers.JSONField(required=False, default=dict)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        retained = attrs.get('retained_photos')
        if retained is not None and (not isinstance(retained, list) or len(retained) > MAX_PHOTOS
                or any(not isinstance(pk, str) for pk in retained) or len(set(retained)) != len(retained)):
            raise serializers.ValidationError({'retained_photos': 'Проверьте список сохраняемых фотографий.'})
        labels = attrs.get('photo_labels', [])
        if not isinstance(labels, list) or len(labels) != len(attrs.get('photos', [])) or any(
                not isinstance(label, str) or not label.strip() or len(label) > 100 for label in labels):
            raise serializers.ValidationError({'photo_labels': 'Укажите название для каждой новой фотографии.'})
        retained_labels = attrs['retained_photo_labels']
        if not isinstance(retained_labels, dict) or len(retained_labels) > MAX_PHOTOS or any(
                not isinstance(label, str) or not label.strip() or len(label) > 100 for label in retained_labels.values()):
            raise serializers.ValidationError({'retained_photo_labels': 'Проверьте названия сохраняемых фотографий.'})
        return attrs


def check_editor(user, record, version):
    if not (user.is_staff or user.is_superuser or record.admin_id == user.pk):
        raise PermissionDenied('Редактировать можно только свои записи.')
    if record_version(record) != version:
        raise Conflict('Запись уже изменена. Откройте её заново; ваши изменения ещё не сохранены.')


@transaction.atomic
def edit_expense(user, pk, data):
    lock_register(user)
    expense = get_object_or_404(Expenses.objects.select_for_update(), pk=pk)
    check_editor(user, expense, data['version'])
    before = f'{expense.amount} ₽ · {expense.info}'
    expense.amount, expense.info = data['amount'], data['description']
    expense.save(update_fields=['amount', 'info'])
    if data.get('photo') or data['remove_photo']:
        expense.photos.all().delete()
    if data.get('photo'):
        ExpensePhoto.objects.create(expense=expense, image=data['photo'])
    event(user, 'Расход изменён', f'Расход №{expense.pk}: {before} → {expense.amount} ₽ · {expense.info}', kind='expense')
    return expense


@transaction.atomic
def edit_shift(user, pk, data):
    lock_register(user)
    legacy = str(pk).startswith('legacy-')
    if legacy:
        record = report = get_object_or_404(Report.objects.select_for_update(), pk=str(pk)[7:])
        if hasattr(report, 'work_shift'):
            raise Conflict('Откройте связанную смену, чтобы исправить этот отчёт.')
    else:
        record = get_object_or_404(Shift.objects.select_for_update(), pk=pk)
        if record.closed_at is None or not record.report_id:
            raise Conflict('Редактирование доступно только для закрытой смены.')
        report = record.report
    check_editor(user, record, data['version'])
    if data['admin_id'] != record.admin_id:
        if not (user.is_staff or user.is_superuser):
            raise PermissionDenied('Переназначать смену могут только управляющие и суперпользователи.')
        if not get_user_model().objects.filter(pk=data['admin_id'], is_active=True, is_staff=False, is_superuser=False).exists():
            raise ValidationError({'admin_id': 'Выберите действующего администратора.'})
        record.user_snapshots.pop('admin', None)
        report.user_snapshots.pop('admin', None)
    if not legacy:
        opened, closed = data.get('opened_at'), data.get('closed_at')
        if opened is None or closed is None or closed < opened or closed > timezone.now():
            raise ValidationError('Укажите время открытия и закрытия: закрытие не раньше открытия и не в будущем.')
        record.admin_id = data['admin_id']
        record.shift_type, record.schedule_date = data['shift_type'], data['schedule_date']
        record.opened_at, record.closed_at = opened, closed
        if 'forced_close_reason' in data:
            record.forced_close_reason = data['forced_close_reason']
        record.save(update_fields=['admin', 'shift_type', 'schedule_date', 'opened_at', 'closed_at', 'forced_close_reason', 'user_snapshots'])
    if data['schedule_date'] > timezone.localdate():
        raise ValidationError({'schedule_date': 'Дата по графику не может быть в будущем.'})
    available = {str(photo.pk): photo for photo in report.photos.all()}
    retained = data.get('retained_photos', list(available))
    if any(pk not in available for pk in retained):
        raise ValidationError({'retained_photos': 'Сохранить можно только фотографии этого отчёта.'})
    if any(pk not in retained for pk in data['retained_photo_labels']):
        raise ValidationError({'retained_photo_labels': 'Переименовать можно только сохраняемые фотографии отчёта.'})
    photos = uploaded_photos(data)
    if len(retained) + len(photos) > MAX_PHOTOS:
        raise ValidationError({'photos': 'Можно прикрепить не более 10 фотографий.'})
    before = f'{report.cash}/{report.cards}/{report.spb}'
    report.admin_id, report.shift, report.date = data['admin_id'], data['shift_type'], data['schedule_date']
    report.cash, report.cards, report.spb, report.info = data['cash'], data['cards'], data['sbp'], data['info']
    report.save()
    report.photos.exclude(pk__in=retained).delete()
    for photo_pk, label in data['retained_photo_labels'].items():
        report.photos.filter(pk=photo_pk).update(label=label.strip())
    for item, label in zip(photos, data.get('photo_labels', [])):
        ReportPhoto.objects.create(report=report, image=item['image'], label=label.strip())
    event(user, 'Закрытая смена изменена', f'Смена №{pk}; наличные/карта/СБП: {before} → {report.cash}/{report.cards}/{report.spb}')
    return record
