from decimal import Decimal

from django import forms
from django.db import router

from reports.exceptions import InsufficientCash
from reports.models import CashRegister, Expenses, Report


class FinancialRecordForm(forms.ModelForm):
    def clean(self):
        data = super().clean()
        using = router.db_for_write(type(self.instance), instance=self.instance)
        previous = type(self.instance).objects.using(using).filter(pk=self.instance.pk).first()
        balance = CashRegister.objects.using(using).filter(pk=1).values_list('balance', flat=True).first() or Decimal('0.00')
        if isinstance(self.instance, Report):
            if 'cash' not in data:
                return data
            previous_effect = previous.cash if previous else 0
            effect = data['cash']
        elif isinstance(self.instance, Expenses):
            if 'amount' not in data:
                return data
            previous_effect = -previous.amount if previous and previous.from_register else 0
            effect = -data['amount'] if data.get('from_register', True) else 0
        else:
            return data
        if balance - previous_effect + effect < 0:
            raise InsufficientCash(balance)
        return data
