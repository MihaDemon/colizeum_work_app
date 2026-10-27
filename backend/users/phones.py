import re

from django.core.exceptions import ValidationError


def normalize_staff_phone(value):
    digits = re.sub(r'[+\s().-]', '', value)
    if len(digits) == 11 and digits[0] in '78':
        digits = digits[1:]
    if not re.fullmatch(r'[0-9]{10}', digits):
        raise ValidationError('Укажите 10 цифр телефона либо номер с кодом +7 или 8.')
    return digits


def matching_staff_numbers(phone):
    """Match existing formatted phone keys without changing their user links."""
    from .models import AdminUser

    matches = []
    for stored in AdminUser.objects.values_list('phone_number', flat=True):
        try:
            if normalize_staff_phone(stored) == phone:
                matches.append(stored)
        except ValidationError:
            continue
    return matches
