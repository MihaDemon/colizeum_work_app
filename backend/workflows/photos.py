from rest_framework.exceptions import ValidationError

MAX_PHOTOS = 10


def default_report_fields():
    return [
        {'id': 'desk', 'label': 'Стол администратора', 'required': True},
        {'id': 'receipt', 'label': 'Чек закрытия смены', 'required': True},
        {'id': 'additional', 'label': 'Дополнительное фото', 'required': False},
    ]


def uploaded_photos(data, legacy=None):
    images = data.get('photos', [])
    slots = data.get('photo_slots', [''] * len(images))
    result = [{'image': image, 'slot': slot, 'label': ''} for image, slot in zip(images, slots)]
    for field, slot, label in legacy or []:
        if data.get(field):
            result.append({'image': data[field], 'slot': slot, 'label': label})
    if len(result) > MAX_PHOTOS:
        raise ValidationError({'photos': 'Можно прикрепить не более 10 фотографий.'})
    if sum(item['image'].size for item in result) > 15 * 1024 * 1024:
        raise ValidationError({'photos': 'Общий размер новых фотографий должен быть не более 15 МБ.'})
    return result


def validate_photos(items, mode, fields):
    if len(items) > MAX_PHOTOS:
        raise ValidationError({'photos': 'Можно прикрепить не более 10 фотографий.'})
    if mode in ['optional', 'single'] and len(items) > 1:
        raise ValidationError({'photos': 'Для этой задачи можно прикрепить одно фото.'})
    if mode in ['single', 'multiple'] and not items:
        raise ValidationError({'photos': 'Необходимо фото выполнения.'})
    if mode == 'named':
        slots = [item['slot'] for item in items]
        by_id = {field['id']: field for field in fields}
        if len(slots) != len(set(slots)) or any(slot not in by_id for slot in slots):
            raise ValidationError({'photos': 'Используйте каждое настроенное поле для фото только один раз.'})
        missing = [field['label'] for field in fields if field['required'] and field['id'] not in slots]
        if missing:
            raise ValidationError({'photos': 'Обязательные фотографии: ' + ', '.join(missing)})
        for item in items:
            item['label'] = by_id[item['slot']]['label']
    else:
        for index, item in enumerate(items):
            item['slot'] = ''
            item['label'] = 'Фото выполнения' if len(items) == 1 else f'Фото {index + 1}'
    return items
