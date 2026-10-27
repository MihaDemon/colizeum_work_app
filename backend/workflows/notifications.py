"""Durable at-least-once Telegram delivery. No network calls inside request transactions."""
import json
import uuid
from datetime import timedelta
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from .models import TelegramNotification


def telegram_send(recipient, task):
    if not settings.TELEGRAM_BOT_TOKEN or not recipient.telegram_id or not recipient.is_active:
        raise DeliveryError('Не указан токен бота или Telegram ID получателя.')
    payload = {'chat_id': recipient.telegram_id,
               'text': f'Задача выполнена: {task.title}\nРезультат ожидает вашей проверки.'}
    if settings.WEBAPP_URL:
        separator = '&' if '?' in settings.WEBAPP_URL else '?'
        payload['reply_markup'] = {'inline_keyboard': [[{'text': 'Проверить задачу', 'web_app': {'url': f'{settings.WEBAPP_URL}{separator}task={task.pk}'}}]]}
    request = Request(f'https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/sendMessage',
                      data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'}, method='POST')
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
    job = TelegramNotification.objects.select_related('recipient', 'submission__task').get(pk=job.pk)
    try:
        send(job.recipient, job.submission.task)
    except Exception as exc:
        # Never persist HTTP exception URLs (which include the bot token).
        message = str(exc) if isinstance(exc, DeliveryError) else 'Не удалось доставить уведомление.'
        TelegramNotification.objects.filter(pk=job.pk, claim_token=claim, status='sending').update(
            status='failed' if job.attempts >= 10 else 'pending', last_error=message[:200],
            next_attempt_at=timezone.now() + timedelta(seconds=min(3600, 10 * 2 ** min(job.attempts, 9))))
    else:
        TelegramNotification.objects.filter(pk=job.pk, claim_token=claim, status='sending').update(status='sent', last_error='', sent_at=timezone.now())
    return True
