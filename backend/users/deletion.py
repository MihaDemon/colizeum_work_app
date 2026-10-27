from django.db import transaction

from reports.models import CashRegister
from users.models import AdminUser


def delete_employees(queryset):
    """Delete logins and their staff cards so they cannot register again."""
    using = queryset.db
    with transaction.atomic(using=using):
        CashRegister.get_default(using=using)
        CashRegister.objects.using(using).select_for_update().get(pk=1)
        phones = list(queryset.exclude(phone_number=None).values_list('phone_number_id', flat=True))
        # Contact verification locks the staff card before the login too.
        list(AdminUser.objects.using(using).select_for_update().filter(pk__in=phones).order_by('pk'))
        users = list(queryset.select_for_update().order_by('pk').values_list('pk', 'phone_number_id'))
        # Staff cards cascade to their linked User. Its pre_delete signal keeps
        # historical names before SET_NULL detaches the account references.
        AdminUser.objects.using(using).filter(pk__in=phones).delete()
        queryset.model.objects.using(using).filter(pk__in=[pk for pk, _ in users]).delete()


def delete_staff_cards(queryset):
    using = queryset.db
    with transaction.atomic(using=using):
        CashRegister.get_default(using=using)
        CashRegister.objects.using(using).select_for_update().get(pk=1)
        cards = list(queryset.select_for_update().order_by('pk').values_list('pk', flat=True))
        queryset.model.objects.using(using).filter(pk__in=cards).delete()
