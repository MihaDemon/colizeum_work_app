from datetime import date, timedelta
from zoneinfo import ZoneInfo

from django.utils import timezone
from rest_framework.exceptions import ValidationError


MOSCOW = ZoneInfo('Europe/Moscow')
HANDOVER_WINDOW = timedelta(hours=24)


def opening_schedule(now=None):
    from .models import Shift

    now = now or timezone.now()
    previous = Shift.objects.order_by('-opened_at', '-pk').first()
    recent_day = (
        previous and previous.shift_type == 'day' and previous.closed_at
        and timedelta(0) <= now - previous.closed_at <= HANDOVER_WINDOW
    )
    return {
        'today': timezone.localdate(now, MOSCOW).isoformat(),
        'nightDate': previous.schedule_date.isoformat() if recent_day else None,
    }


def resolve_schedule_date(shift_type, selected=None, now=None):
    schedule = opening_schedule(now)
    automatic = schedule['today'] if shift_type == 'day' else schedule['nightDate']
    if automatic:
        if selected is not None and selected.isoformat() != automatic:
            raise ValidationError({'schedule_date': 'Дата смены изменилась. Обновите экран и повторите открытие.'})
        return date.fromisoformat(automatic)
    if selected is None:
        raise ValidationError({'schedule_date': 'Нет недавней дневной смены. Укажите дату ночной смены по графику.'})
    if selected.isoformat() > schedule['today']:
        raise ValidationError({'schedule_date': 'Дата смены по графику не может быть в будущем.'})
    return selected
