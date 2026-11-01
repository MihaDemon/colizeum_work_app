"""A delivery keeps an immutable image of the selected plan and actual shifts."""
from django.core.files.base import ContentFile
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models import ScheduleDelivery, ScheduleSettings
from .notifications import queue_management


def prepare_delivery(period, revision, content, source, author=None, snapshot=None):
    from .schedules import period_data
    from .schedule_images import render_schedule

    delivery = ScheduleDelivery.objects.create(
        period=period, revision=revision, content=content, source=source, author=author,
    )
    image = render_schedule(snapshot or period_data(period, revision=revision), content)
    delivery.image.save(f'period-{period.pk}-v{revision.number}-{delivery.pk}.png', ContentFile(image))
    message = f'График {period}. Версия {revision.number}. {delivery.get_content_display()}.'
    if source == 'manual':
        from .models import TelegramNotification
        jobs = [TelegramNotification.objects.create(
            kind='schedule', message=message, schedule=period, schedule_delivery=delivery,
            recipient=author, next_attempt_at=timezone.now(),
        )]
    else:
        jobs = queue_management('schedule', message, schedule=period, schedule_delivery=delivery)
    return delivery, jobs


@transaction.atomic
def send_schedule(user, period, data):
    from .schedules import locked
    locked(user)
    if not user.is_active or not user.telegram_id:
        raise ValidationError('Для отправки графика себе привяжите Telegram к своей учётной записи.')
    revision = period.revisions.filter(number=data['revision']).first()
    if revision is None:
        raise ValidationError({'revision': 'Версия этого графика не найдена. Обновите график.'})
    config, _ = ScheduleSettings.objects.get_or_create(pk=1)
    delivery, jobs = prepare_delivery(period, revision, config.manual_content, 'manual', user)
    from .models import Activity
    Activity.objects.create(actor=user, title='График поставлен в очередь отправки', kind='schedule',
                            description=f'{period}; версия {revision.number}; {delivery.get_content_display()}')
    return {'id': str(delivery.pk), 'content': delivery.content, 'revision': revision.number,
            'queued': sum(job.status == 'pending' for job in jobs),
            'skipped': sum(job.status == 'skipped' for job in jobs), 'createdAt': timezone.now().isoformat()}
