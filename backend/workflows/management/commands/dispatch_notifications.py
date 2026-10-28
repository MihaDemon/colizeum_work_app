import time
import logging
from django.core.management.base import BaseCommand
from django.utils import timezone
from workflows.models import TelegramNotification
from workflows.notifications import deliver_one


class Command(BaseCommand):
    help = 'Отправить уведомления Telegram из очереди; --loop запускает постоянную обработку.'

    def add_arguments(self, parser):
        parser.add_argument('--loop', action='store_true')
        parser.add_argument('--retry-failed', action='store_true')

    def handle(self, *args, **options):
        next_schedule_check = 0
        if options['retry_failed']:
            TelegramNotification.objects.filter(status='failed').update(status='pending', attempts=0, next_attempt_at=timezone.now())
        while True:
            if time.monotonic() >= next_schedule_check:
                from workflows.schedules import publish_due_schedules
                try:
                    publish_due_schedules()
                except Exception:
                    logging.getLogger(__name__).exception('Не удалось подготовить итоговый график; повтор через минуту.')
                next_schedule_check = time.monotonic() + 60
            if deliver_one():
                continue
            if not options['loop']:
                break
            time.sleep(3)
