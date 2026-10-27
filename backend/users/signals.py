from functools import reduce
from operator import or_

from django.contrib.auth import get_user_model
from django.db.models import Q
from django.db.models.signals import pre_delete
from django.dispatch import receiver

from reports.models import CashRegister, Expenses, Report
from workflows.models import Activity, Shift, Task, TaskSubmission, TelegramNotification
from workflows.permissions import person


@receiver(pre_delete, sender=get_user_model())
def preserve_employee_history(sender, instance, using, **kwargs):
    # User deletion and workflow writes share the same lock order. Update JSON
    # directly: calling Report/Expenses.save() would change the cash balance.
    CashRegister.get_default(using=using)
    CashRegister.objects.using(using).select_for_update().get(pk=1)
    snapshot = dict(person(instance), id=f'deleted-{instance.pk}', deleted=True)
    snapshot['name'] += ' (удалён)'
    for model, fields in (
        (Shift, ('admin',)), (Task, ('creator', 'assignee')),
        (TaskSubmission, ('submitted_by', 'reviewed_by')),
        (Activity, ('actor',)), (TelegramNotification, ('recipient',)),
        (Report, ('admin',)), (Expenses, ('admin',)),
    ):
        query = reduce(or_, (Q(**{field: instance.pk}) for field in fields))
        records = model.objects.using(using).select_for_update().filter(query).order_by('pk')
        for record in records:
            snapshots = dict(record.user_snapshots)
            for field in fields:
                if getattr(record, f'{field}_id') == instance.pk:
                    snapshots[field] = snapshot
            updates = {'user_snapshots': snapshots}
            if model is TelegramNotification and record.status in ('pending', 'sending'):
                updates.update(status='failed', last_error='Получатель удалён.')
            model.objects.using(using).filter(pk=record.pk).update(**updates)
