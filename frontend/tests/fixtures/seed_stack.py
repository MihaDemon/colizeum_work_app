"""Run via manage.py shell in an EMPTY, isolated smoke-test Compose stack only."""
from django.conf import settings
from django.contrib.auth import get_user_model
from reports.models import CashRegister
from users.models import AdminUser
from computers.models import Station

assert settings.WEBAPP_URL == 'https://work.invalid', 'This seed is only for an isolated test stack.'
User = get_user_model()
assert not User.objects.exists(), 'The test stack must be empty.'
for phone, first, last, role, ident, username in [
    ('9990000001', 'Stack', 'Administrator', 'admin', '91001', 'stack_admin'),
    ('9990000002', 'Stack', 'Manager', 'manager', '91002', 'stack_manager'),
]:
    contact = AdminUser.objects.create(phone_number=phone, first_name=first, last_name=last, role=role, telegram_id=ident)
    User.objects.create_user(username=username, telegram_id=ident, phone_number=contact, is_staff=role == 'manager')
User.objects.create_superuser(username='stack_owner', telegram_id='91003', password='isolated-stack-test-password')
CashRegister.objects.create(balance=1000)
Station.objects.create(club_number=12)
print('Isolated smoke-test staff created.')
