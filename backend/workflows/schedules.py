"""Half-month plans are immutable revisions; actual work always comes from Shift."""
from calendar import monthrange
from copy import deepcopy
from datetime import date, datetime, time, timedelta

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from .models import SchedulePeriod, ScheduleRevision, ScheduleSettings, Shift
from .notifications import MOSCOW, queue_management
from .permissions import person
from .presentation import participant_name
from users.history import participant_id


def today():
    return timezone.now().astimezone(MOSCOW).date()


def bounds(day):
    return day.replace(day=1 if day.day <= 15 else 16), day.replace(day=15 if day.day <= 15 else monthrange(day.year, day.month)[1])


def deadline(period):
    # The period ends at midnight after `end`, followed by a full correction day.
    return datetime.combine(period.end + timedelta(days=2), time.min, MOSCOW)


def keys(period):
    return [f'{(period.start + timedelta(days=offset)).isoformat()}/{kind}'
            for offset in range((period.end - period.start).days + 1) for kind in ('day', 'night')]


def ensure_period(day):
    start, end = bounds(day)
    period, created = SchedulePeriod.objects.get_or_create(start=start, defaults={'end': end})
    if created:
        ScheduleRevision.objects.create(period=period, number=1, plan=dict.fromkeys(keys(period)), source='initial')
    return period


def active_admins():
    return get_user_model().objects.filter(is_active=True, is_staff=False, is_superuser=False).select_related('phone_number')


def editable(period):
    current = today()
    _, end = bounds(current)
    future_start, _ = bounds(end + timedelta(days=1))
    return period.start <= future_start and timezone.now() < deadline(period)


def manager(user):
    if not (user.is_staff or user.is_superuser):
        raise PermissionDenied('Редактировать график могут только управляющие и суперпользователи.')


def locked(user):
    from .services import lock_register
    lock_register(user)


def head(period):
    return period.revisions.get(number=period.version)


def check_version(period, version):
    from .services import Conflict
    if period.version != version:
        raise Conflict('График изменился. Обновите его перед сохранением; ваш черновик сохранён на экране.')
    if not editable(period):
        raise Conflict('Время редактирования этого графика закончилось.')


def settings_data():
    config, _ = ScheduleSettings.objects.get_or_create(pk=1)
    return {'defaultAdminId': str(config.default_admin_id) if config.default_admin_id else None, 'version': config.version}


def summary(period):
    return {'id': str(period.pk), 'start': str(period.start), 'end': str(period.end), 'version': period.version,
            'editable': editable(period), 'sendAt': deadline(period).isoformat(),
            'summaryCreatedAt': period.summary_created_at.isoformat() if period.summary_created_at else None,
            'image': f'/api/schedules/{period.pk}/image/' if period.summary_image else None}


def actual_shifts(period):
    start = datetime.combine(period.start, time.min, MOSCOW)
    end = datetime.combine(period.end + timedelta(days=1), time.min, MOSCOW)
    return Shift.objects.filter(
        Q(schedule_date__range=(period.start, period.end))
        | Q(schedule_date__isnull=True, opened_at__gte=start, opened_at__lt=end)
    ).select_related('admin__phone_number', 'schedule_revision').order_by('opened_at', 'pk')


def period_data(period, user=None, revision=None):
    selected = revision or head(period)
    actual = {}
    for shift in actual_shifts(period):
        day = shift.schedule_date or shift.opened_at.astimezone(MOSCOW).date()
        actual.setdefault(f'{day}/{shift.shift_type}', []).append({
            'id': str(shift.pk), 'adminId': participant_id(shift, 'admin'), 'adminName': participant_name(shift, 'admin'),
            'openedAt': shift.opened_at.isoformat(), 'closedAt': shift.closed_at.isoformat() if shift.closed_at else None,
            'proposed': shift.proposed_admin or None, 'revision': shift.schedule_revision.number if shift.schedule_revision_id else None,
        })
    available = {str(pk) for pk in active_admins().values_list('pk', flat=True)}
    return {**summary(period), 'plan': selected.plan, 'viewVersion': selected.number, 'actual': actual,
            'canEdit': bool(user and (user.is_staff or user.is_superuser) and editable(period)),
            'unavailable': sorted({p['id'] for p in selected.plan.values() if p and p['id'] not in available}),
            'revisions': [{'number': r.number, 'source': r.source, 'createdAt': r.created_at.isoformat(),
                           'author': participant_name(r, 'author') if r.author_id or r.user_snapshots else 'Система',
                           'restoredFrom': r.restored_from.number if r.restored_from_id else None}
                          for r in period.revisions.select_related('author__phone_number', 'restored_from')]}


@transaction.atomic
def overview(user):
    locked(user)
    current = ensure_period(today())
    future = ensure_period(current.end + timedelta(days=1))
    return {'current': summary(current), 'future': summary(future),
            'archive': [summary(p) for p in SchedulePeriod.objects.filter(end__lt=current.start)],
            'admins': [person(u) for u in active_admins()], 'settings': settings_data()}


@transaction.atomic
def configure(user, data):
    locked(user)
    if not user.is_superuser:
        raise PermissionDenied('Назначить администратора по умолчанию может только суперпользователь.')
    config, _ = ScheduleSettings.objects.get_or_create(pk=1)
    from .services import Conflict
    if data['version'] != config.version:
        raise Conflict('Настройки графика изменились. Обновите страницу.')
    pk = data.get('default_admin')
    if pk is not None and not active_admins().filter(pk=pk).exists():
        raise ValidationError('Выберите действующего администратора.')
    config.default_admin_id = pk
    config.version += 1
    config.save(update_fields=['default_admin', 'version'])
    return settings_data()


@transaction.atomic
def generate(user, period, data):
    locked(user)
    manager(user)
    period.refresh_from_db()
    check_version(period, data['version'])
    current = ensure_period(today())
    if period.start != current.end + timedelta(days=1):
        raise ValidationError('Автозаполнение доступно только для следующего графика.')
    ids = [str(pk) for pk in data['admins']]
    if len(set(ids)) != len(ids):
        raise ValidationError('Администраторы не должны повторяться в выбранном списке.')
    available = {str(u.pk): person(u) for u in active_admins()}
    if any(pk not in available for pk in ids):
        raise ValidationError('В списке есть недоступный администратор.')
    config = settings_data()
    default = config['defaultAdminId']
    if len(ids) < 4 and default not in available:
        raise ValidationError('Для незаполненных позиций суперпользователь должен выбрать администратора по умолчанию.')
    # Keep each person's day/night position across periods when the team is unchanged.
    previous = SchedulePeriod.objects.filter(start__lt=period.start).order_by('-start').first()
    old_order = head(previous).generation.get('admins', []) if previous else []
    if set(old_order) == set(ids):
        ids = old_order
    positions = ids + [default] * (4 - len(ids))
    plan = {}
    for key in keys(period):
        day_text, kind = key.split('/')
        phase = (date.fromisoformat(day_text) - date(2026, 1, 1)).days % 4
        position = (0 if phase < 2 else 2) + (0 if kind == 'day' else 1)
        plan[key] = available[positions[position]]
    return {'plan': plan, 'admins': ids, 'fallbackUsed': len(ids) < 4,
            'warning': 'Недостающие позиции назначены администратору по умолчанию. Он может занимать несколько позиций; проверьте нагрузку перед сохранением.' if len(ids) < 4 else ''}


def publish_revision(period, user, plan, source, generation=None, restored_from=None):
    period.version += 1
    revision = ScheduleRevision.objects.create(period=period, number=period.version, author=user,
        plan=plan, source=source, generation=head_for_previous(period).generation if generation is None else generation, restored_from=restored_from)
    period.save(update_fields=['version'])
    from .services import event
    event(user, 'График смен сохранён', f'{period}; версия {revision.number}', kind='schedule')
    return period_data(period, user)


def head_for_previous(period):
    return period.revisions.get(number=period.version - 1)


@transaction.atomic
def save_plan(user, period, data):
    locked(user)
    manager(user)
    period.refresh_from_db()
    check_version(period, data['version'])
    slots = data['slots']
    expected = set(keys(period))
    received = [f'{row["date"]}/{row["type"]}' for row in slots]
    if len(received) != len(expected) or set(received) != expected:
        raise ValidationError('Сохраните все дневные и ночные ячейки выбранного периода без повторов.')
    available = {str(u.pk): person(u) for u in active_admins()}
    original = head(period)
    if data['source'] == 'automatic':
        _, current_end = bounds(today())
        if period.start != current_end + timedelta(days=1):
            raise ValidationError('Автоматический график можно сохранить только для следующего периода.')
        ids = [str(pk) for pk in data.get('admins', [])]
        if len(set(ids)) != len(ids) or any(pk not in available for pk in ids):
            raise ValidationError('Проверьте список администраторов автозаполнения.')
    plan = {}
    for row, key in zip(slots, received):
        pk = str(row['admin_id']) if row['admin_id'] is not None else None
        if pk is None:
            plan[key] = None
        elif pk in available:
            plan[key] = available[pk]
        elif original.plan.get(key) and original.plan[key]['id'] == pk:
            plan[key] = original.plan[key]
        else:
            raise ValidationError('Назначить можно только действующего администратора.')
    generation = {'admins': [str(pk) for pk in data.get('admins', [])]} if data['source'] == 'automatic' else original.generation
    return publish_revision(period, user, plan, data['source'], generation)


@transaction.atomic
def restore(user, period, data):
    locked(user)
    manager(user)
    period.refresh_from_db()
    check_version(period, data['version'])
    try:
        revision = period.revisions.get(number=data['revision'])
    except ScheduleRevision.DoesNotExist:
        raise ValidationError('Версия этого графика не найдена.')
    return publish_revision(period, user, deepcopy(revision.plan), 'restore', revision.generation, revision)


def bind_shift(shift):
    # Called inside open_shift's register lock and transaction, even for an unplanned shift.
    shift.schedule_date = shift.opened_at.astimezone(MOSCOW).date()
    period = ensure_period(shift.schedule_date)
    shift.schedule_revision = head(period)
    shift.proposed_admin = shift.schedule_revision.plan.get(f'{shift.schedule_date}/{shift.shift_type}') or {}
    shift.save(update_fields=['schedule_date', 'schedule_revision', 'proposed_admin'])


@transaction.atomic
def publish_due_schedules():
    locked(None)
    current = ensure_period(today())
    ensure_period(current.end + timedelta(days=1))
    for period in SchedulePeriod.objects.filter(summary_created_at__isnull=True, end__lt=today()).order_by('start'):
        if timezone.now() < deadline(period):
            continue
        from django.core.files.base import ContentFile
        from .schedule_images import render_schedule
        snapshot = period_data(period)
        image = render_schedule(snapshot)
        period.summary_image.save(f'period-{period.pk}-v{period.version}.png', ContentFile(image), save=False)
        period.summary_created_at = timezone.now()
        period.save(update_fields=['summary_image', 'summary_created_at'])
        queue_management('schedule', f'Итоговый график {period}. Версия {period.version}. План и фактические смены.', schedule=period)
