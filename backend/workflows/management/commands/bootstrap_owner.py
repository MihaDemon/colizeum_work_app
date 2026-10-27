import os
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = 'Create an initial superuser from OWNER_* variables; never overwrite an existing account.'

    def handle(self, *args, **options):
        username = os.getenv('OWNER_USERNAME', '').strip()
        if not username:
            self.stdout.write('OWNER_USERNAME is unset; skipping owner creation.')
            return
        User = get_user_model()
        if User.objects.filter(username=username).exists():
            self.stdout.write('Owner username already exists; leaving it unchanged.')
            return
        password = os.getenv('OWNER_PASSWORD', '')
        if not password:
            raise CommandError('Set OWNER_PASSWORD for initial owner creation.')
        user = User(username=username, email=os.getenv('OWNER_EMAIL') or None, telegram_id=os.getenv('OWNER_TELEGRAM_ID') or None,
                    is_staff=True, is_superuser=True)
        validate_password(password, user)
        user.set_password(password)
        user.save()
        self.stdout.write(self.style.SUCCESS('Initial owner created.'))
