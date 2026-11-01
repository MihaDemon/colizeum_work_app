from datetime import timedelta
from zoneinfo import ZoneInfo

import django.utils.timezone
from django.db import migrations, models


def backfill_schedule_dates(apps, schema_editor):
    Shift = apps.get_model('workflows', 'Shift')
    Report = apps.get_model('reports', 'Report')
    Revision = apps.get_model('workflows', 'ScheduleRevision')
    alias = schema_editor.connection.alias
    moscow = ZoneInfo('Europe/Moscow')
    previous = None
    for shift in Shift.objects.using(alias).select_related('report').order_by('opened_at', 'pk').iterator():
        opened = shift.opened_at.astimezone(moscow)
        schedule_date = opened.date()
        if shift.shift_type == 'night':
            if (previous and previous.shift_type == 'day' and previous.closed_at
                    and timedelta(0) <= shift.opened_at - previous.closed_at <= timedelta(hours=24)):
                schedule_date = previous.schedule_date
            elif shift.report_id:
                # Without a reliable handover, preserve the existing explicit date.
                schedule_date = shift.report.date
        if (shift.report_id and shift.closed_at
                and shift.report.date != shift.closed_at.astimezone(moscow).date()):
            schedule_date = shift.report.date
        updates = {'schedule_date': schedule_date}
        if shift.schedule_date != schedule_date:
            revision = Revision.objects.using(alias).filter(
                period__start__lte=schedule_date, period__end__gte=schedule_date,
                created_at__lte=shift.opened_at,
            ).order_by('-number').first()
            updates['schedule_revision_id'] = revision.pk if revision else None
            updates['proposed_admin'] = revision.plan.get(f'{schedule_date}/{shift.shift_type}') or {} if revision else {}
        shift.schedule_date = schedule_date
        Shift.objects.using(alias).filter(pk=shift.pk).update(**updates)
        if shift.report_id and shift.closed_at:
            # Only repair dates matching the old close-date rule. Preserve corrections.
            Report.objects.using(alias).filter(
                pk=shift.report_id, date=shift.closed_at.astimezone(moscow).date(),
            ).update(date=schedule_date)
        previous = shift


class Migration(migrations.Migration):
    dependencies = [('workflows', '0010_task_deleted_at')]

    operations = [
        migrations.RunPython(backfill_schedule_dates, migrations.RunPython.noop),
        migrations.AlterField(
            model_name='shift', name='schedule_date',
            field=models.DateField(default=django.utils.timezone.localdate, null=True, blank=True, verbose_name='Дата по графику'),
        ),
    ]
