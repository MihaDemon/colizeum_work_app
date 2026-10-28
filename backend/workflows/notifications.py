"""Durable at-least-once Telegram delivery. No network calls inside request transactions."""
import json
import uuid
from datetime import timedelta
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from zoneinfo import ZoneInfo

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from .models import TelegramNotification
from .notification_settings import telegram_enabled

MOSCOW = ZoneInfo('Europe/Moscow')


def mini_app_url(**target):
    parts = urlsplit(settings.WEBAPP_URL)
    params = [(key, value) for key, value in parse_qsl(parts.query) if key not in ('task', 'shift', 'expense', 'cleaner', 'schedule')]
    return urlunsplit(parts._replace(query=urlencode(params + list(target.items()))))


def queue_management(kind, message, *, shift=None, expense=None, schedule=None):
    from django.contrib.auth import get_user_model
    recipients = get_user_model().objects.filter(is_active=True).filter(Q(is_staff=True) | Q(is_superuser=True)).exclude(telegram_id__isnull=True).exclude(telegram_id='')
    TelegramNotification.objects.bulk_create([
        TelegramNotification(kind=kind, message=message, shift=shift, expense=expense, schedule=schedule,
                             recipient=recipient, next_attempt_at=timezone.now(),
                             status='pending' if telegram_enabled(recipient, kind) else 'skipped')
        for recipient in recipients
    ])


def queue_task_assigned(task):
    recipient = task.assignee
    if not recipient or not recipient.is_active or recipient.is_superuser or not recipient.telegram_id:
        return
    from .permissions import person
    message = f'Вам назначена новая задача: {task.title}\nПостановщик: {person(task.creator)["name"]}'
    if task.description:
        message += f'\n{task.description[:2000]}'
    TelegramNotification.objects.get_or_create(
        kind='task_assigned', task=task, recipient=recipient,
        defaults={'message': message, 'next_attempt_at': timezone.now(),
                  'status': 'pending' if telegram_enabled(recipient, 'task_assigned') else 'skipped'},
    )


def telegram_send(recipient, task):
    if recipient is None:
        raise DeliveryError('Получатель удалён.')
    if not settings.TELEGRAM_BOT_TOKEN or not recipient.telegram_id or not recipient.is_active:
        raise DeliveryError('Не указан токен бота или Telegram ID получателя.')
    if isinstance(task, TelegramNotification):
        text = task.message
        if task.kind == 'task_assigned':
            label, target = 'Открыть задачу', {'task': task.task_id}
        elif task.kind == 'schedule':
            label, target = 'Открыть график', {'schedule': task.schedule_id}
        elif task.kind == 'expense':
            label, target = 'Открыть расход', {'expense': task.expense_id}
        elif task.kind == 'cleaner':
            visit = getattr(task.shift, 'cleaner_visit', None)
            label, target = 'История уборщицы', {'cleaner': (visit.occurred_at if visit else task.created_at).astimezone(MOSCOW).strftime('%Y-%m')}
        else:
            label, target = 'Открыть смену', {'shift': task.shift_id}
    else:
        text = f'Задача выполнена: {task.title}\nРезультат ожидает вашей проверки.'
        label, target = 'Проверить задачу', {'task': task.pk}
    payload = {'chat_id': recipient.telegram_id, 'text': text}
    if settings.WEBAPP_URL:
        payload['reply_markup'] = {'inline_keyboard': [[{'text': label, 'web_app': {'url': mini_app_url(**target)}}]]}
    method = 'sendMessage'
    body, content_type = json.dumps(payload).encode(), 'application/json'
    if isinstance(task, TelegramNotification) and task.kind == 'schedule':
        method = 'sendPhoto'
        payload['caption'] = payload.pop('text')[:1024]
        boundary = uuid.uuid4().hex
        chunks = []
        for key, value in payload.items():
            value = json.dumps(value, ensure_ascii=False) if isinstance(value, dict) else str(value)
            chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode())
        with task.schedule.summary_image.open('rb') as picture:
            chunks.extend([f'--{boundary}\r\nContent-Disposition: form-data; name="photo"; filename="schedule.png"\r\nContent-Type: image/png\r\n\r\n'.encode(), picture.read(), b'\r\n', f'--{boundary}--\r\n'.encode()])
        body, content_type = b''.join(chunks), f'multipart/form-data; boundary={boundary}'
    request = Request(f'https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/{method}',
                      data=body, headers={'Content-Type': content_type}, method='POST')
    try:
        with urlopen(request, timeout=15) as response:
            result = json.load(response)
        if not result.get('ok'):
            raise DeliveryError('Telegram не принял уведомление.')
    except HTTPError as exc:
        raise DeliveryError(f'Ошибка Telegram: HTTP {exc.code}.') from None
    except (URLError, TimeoutError, ValueError, OSError):
        raise DeliveryError('Не удалось подключиться к Telegram.') from None


class DeliveryError(Exception):
    pass


def deliver_one(send=telegram_send):
    now = timezone.now()
    # A short transaction claims a job. Expired leases recover interrupted workers.
    with transaction.atomic():
        job = TelegramNotification.objects.select_for_update().filter(
            Q(status='pending', next_attempt_at__lte=now) | Q(status='sending', next_attempt_at__lte=now)
        ).order_by('next_attempt_at', 'pk').first()
        if not job:
            return False
        claim = uuid.uuid4()
        job.status, job.claim_token = 'sending', claim
        job.attempts += 1
        job.next_attempt_at = now + timedelta(minutes=2)
        job.save(update_fields=['status', 'claim_token', 'attempts', 'next_attempt_at'])
    job = TelegramNotification.objects.select_related('recipient', 'submission__task', 'task', 'shift__cleaner_visit', 'schedule').filter(pk=job.pk).first()
    if job is None or job.status != 'sending' or job.claim_token != claim:
        return True
    if job.recipient_id is None:
        TelegramNotification.objects.filter(pk=job.pk, claim_token=claim).update(status='failed', last_error='Получатель удалён.')
        return True
    if not job.recipient.is_active or not job.recipient.telegram_id:
        TelegramNotification.objects.filter(pk=job.pk, claim_token=claim).update(status='failed', last_error='Учётная запись отключена или Telegram не связан.')
        return True
    if not telegram_enabled(job.recipient, job.kind):
        TelegramNotification.objects.filter(pk=job.pk, claim_token=claim).update(status='skipped', last_error='Уведомление отключено получателем.')
        return True
    if job.kind == 'task_assigned' and (job.task.assignee_id != job.recipient_id or job.recipient.is_superuser):
        TelegramNotification.objects.filter(pk=job.pk, claim_token=claim).update(status='failed', last_error='Получатель больше не исполнитель задачи.')
        return True
    if job.kind != 'task_assigned' and not (job.recipient.is_staff or job.recipient.is_superuser):
        TelegramNotification.objects.filter(pk=job.pk, claim_token=claim).update(status='failed', last_error='Получатель больше не управляющий или суперпользователь.')
        return True
    try:
        send(job.recipient, job.submission.task if job.kind == 'task' else job)
    except Exception as exc:
        # Never persist HTTP exception URLs (which include the bot token).
        message = str(exc) if isinstance(exc, DeliveryError) else 'Не удалось доставить уведомление.'
        TelegramNotification.objects.filter(pk=job.pk, claim_token=claim, status='sending').update(
            status='failed' if job.attempts >= 10 else 'pending', last_error=message[:200],
            next_attempt_at=timezone.now() + timedelta(seconds=min(3600, 10 * 2 ** min(job.attempts, 9))))
    else:
        TelegramNotification.objects.filter(pk=job.pk, claim_token=claim, status='sending').update(status='sent', last_error='', sent_at=timezone.now())
    return True
