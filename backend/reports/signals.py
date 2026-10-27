from django.db import transaction
from django.db.models.signals import pre_delete
from django.dispatch import receiver

from .models import CashRegister, Expenses, Report


@receiver(pre_delete, sender=Report)
def reverse_report_cash(sender, instance, using, **kwargs):
    with transaction.atomic(using=using):
        CashRegister.get_default(using=using)

        register = CashRegister.objects.using(using).select_for_update().get(pk=1)

        report = sender.objects.using(using).filter(pk=instance.pk).first()

        if report:
            register.apply_change(-report.cash, using=using)


@receiver(pre_delete, sender=Expenses)
def restore_expense_cash(sender, instance, using, **kwargs):
    with transaction.atomic(using=using):
        CashRegister.get_default(using=using)

        register = CashRegister.objects.using(using).select_for_update().get(pk=1)

        expense = sender.objects.using(using).filter(
            pk=instance.pk,
            from_register=True,
        ).first()

        if expense:
            register.apply_change(expense.amount, using=using)
