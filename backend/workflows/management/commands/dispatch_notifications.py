import time
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
        if options['retry_failed']:
            TelegramNotification.objects.filter(status='failed').update(status='pending', attempts=0, next_attempt_at=timezone.now())
        while True:
            if deliver_one():
                continue
            if not options['loop']:
                break
            time.sleep(3)
