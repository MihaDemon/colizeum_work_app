from rest_framework.exceptions import ValidationError

MAX_PHOTOS = 10


def default_report_fields():
    return [
        {'id': 'desk', 'label': 'Administrator desk', 'required': True},
        {'id': 'receipt', 'label': 'Closing receipt', 'required': True},
        {'id': 'additional', 'label': 'Additional photo', 'required': False},
    ]


def uploaded_photos(data, legacy=None):
    images = data.get('photos', [])
    slots = data.get('photo_slots', [''] * len(images))
    result = [{'image': image, 'slot': slot, 'label': ''} for image, slot in zip(images, slots)]
    for field, slot, label in legacy or []:
        if data.get(field):
            result.append({'image': data[field], 'slot': slot, 'label': label})
    if len(result) > MAX_PHOTOS:
        raise ValidationError({'photos': 'Attach at most 10 photos.'})
    if sum(item['image'].size for item in result) > 15 * 1024 * 1024:
        raise ValidationError({'photos': 'Keep the combined photo size under 15 MB.'})
    return result


def validate_photos(items, mode, fields):
    if len(items) > MAX_PHOTOS:
        raise ValidationError({'photos': 'Attach at most 10 photos.'})
    if mode in ['optional', 'single'] and len(items) > 1:
        raise ValidationError({'photos': 'This task accepts one photo.'})
    if mode in ['single', 'multiple'] and not items:
        raise ValidationError({'photos': 'A completion photo is required.'})
    if mode == 'named':
        slots = [item['slot'] for item in items]
        by_id = {field['id']: field for field in fields}
        if len(slots) != len(set(slots)) or any(slot not in by_id for slot in slots):
            raise ValidationError({'photos': 'Use each configured photo field at most once.'})
        missing = [field['label'] for field in fields if field['required'] and field['id'] not in slots]
        if missing:
            raise ValidationError({'photos': 'Required photos: ' + ', '.join(missing)})
        for item in items:
            item['label'] = by_id[item['slot']]['label']
    else:
        for index, item in enumerate(items):
            item['slot'] = ''
            item['label'] = 'Completion photo' if len(items) == 1 else f'Photo {index + 1}'
    return items
