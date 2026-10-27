import re
from decimal import Decimal, InvalidOperation

from django.db import migrations
from django.utils.formats import number_format
from django.utils.translation import override


DEFAULT_LABELS = {
    'desk': ('Administrator desk', 'Стол администратора'),
    'receipt': ('Closing receipt', 'Чек закрытия смены'),
    'additional': ('Additional photo', 'Дополнительное фото'),
}
EVENT_TITLES = {
    'Shift opened': 'Смена открыта',
    'Shift closed': 'Смена закрыта',
    'Expense recorded': 'Расход сохранён',
    'Task assigned': 'Задача назначена',
    'Task on moderation': 'Задача на проверке',
    'Task accepted': 'Задача принята',
    'Task needs rework': 'Задача возвращена на доработку',
    'Report photo requirements updated': 'Требования к фото отчёта обновлены',
}
DELIVERY_ERRORS = {
    'Bot token or recipient Telegram ID is missing.': 'Не указан токен бота или Telegram ID получателя.',
    'Telegram did not accept the notification.': 'Telegram не принял уведомление.',
    'Telegram connection failed.': 'Не удалось подключиться к Telegram.',
    'Notification delivery failed.': 'Не удалось доставить уведомление.',
}


def translate_fields(fields):
    translated = []
    for field in fields:
        item = dict(field)
        old, new = DEFAULT_LABELS.get(item.get('id'), (None, None))
        if old and item.get('label') == old:
            item['label'] = new
        translated.append(item)
    return translated


def localize_system_text(apps, schema_editor):
    alias = schema_editor.connection.alias
    Settings = apps.get_model('workflows', 'PhotoSettings')
    Shift = apps.get_model('workflows', 'Shift')
    ReportPhoto = apps.get_model('reports', 'ReportPhoto')
    SubmissionPhoto = apps.get_model('workflows', 'TaskSubmissionPhoto')
    Activity = apps.get_model('workflows', 'Activity')
    Notification = apps.get_model('workflows', 'TelegramNotification')

    for settings in Settings.objects.using(alias).iterator():
        fields = translate_fields(settings.report_fields)
        if fields != settings.report_fields:
            settings.report_fields = fields
            settings.version += 1
            settings.save(using=alias, update_fields=['report_fields', 'version'])
    for shift in Shift.objects.using(alias).iterator():
        fields = translate_fields(shift.photo_requirements)
        if fields != shift.photo_requirements:
            if shift.report_id:
                for old, new in zip(shift.photo_requirements, fields):
                    if old['label'] != new['label']:
                        ReportPhoto.objects.using(alias).filter(report_id=shift.report_id, label=old['label']).update(label=new['label'])
            shift.photo_requirements = fields
            shift.save(using=alias, update_fields=['photo_requirements'])
    for photo in SubmissionPhoto.objects.using(alias).filter(slot='').iterator():
        label = photo.label
        if label == 'Completion photo':
            label = 'Фото выполнения'
        elif re.fullmatch(r'Photo [0-9]+', label):
            label = label.replace('Photo ', 'Фото ', 1)
        if label != photo.label:
            photo.label = label
            photo.save(using=alias, update_fields=['label'])
    with override('ru'):
        for event in Activity.objects.using(alias).iterator():
            old_title = event.title
            event.title = EVENT_TITLES.get(old_title, old_title)
            if old_title == 'Shift opened':
                event.description = {'Day': 'День', 'Night': 'Ночь'}.get(event.description, event.description)
            elif old_title == 'Shift closed' and event.description.startswith('Total: ') and event.description.endswith(' ₽'):
                try:
                    amount = Decimal(event.description[7:-2])
                    event.description = f'Итого: {number_format(amount, decimal_pos=2, force_grouping=True)} ₽'
                except InvalidOperation:
                    pass
            elif old_title == 'Expense recorded':
                amount, separator, note = event.description.partition(' ₽ · ')
                if separator:
                    try:
                        event.description = f'{number_format(Decimal(amount), decimal_pos=2, force_grouping=True)} ₽ · {note}'
                    except InvalidOperation:
                        pass
            elif old_title == 'Report photo requirements updated' and event.description == 'Applies to shifts opened from now on.':
                event.description = 'Применяется к сменам, открытым после изменения настроек.'
            event.save(using=alias, update_fields=['title', 'description'])
    for old, new in DELIVERY_ERRORS.items():
        Notification.objects.using(alias).filter(last_error=old).update(last_error=new)


class Migration(migrations.Migration):
    dependencies = [
        ('workflows', '0004_alter_activity_options_alter_commandreceipt_options_and_more'),
        ('reports', '0004_alter_reportphoto_label'),
    ]
    operations = [migrations.RunPython(localize_system_text, migrations.RunPython.noop)]
