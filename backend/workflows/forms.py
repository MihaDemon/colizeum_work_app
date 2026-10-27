from django import forms
from rest_framework.exceptions import ValidationError

from .models import Task
from .serializers import PhotoRequirementsField


class WorkflowForm(forms.ModelForm):
    def clean(self):
        cleaned = super().clean()
        for field in ('photo_requirements', 'report_fields'):
            if field not in cleaned:
                continue
            value = cleaned[field] if cleaned[field] is not None else []
            try:
                cleaned[field] = PhotoRequirementsField().to_internal_value(value)
            except ValidationError:
                self.add_error(field, 'Укажите список из не более 10 полей. Для каждого нужны уникальные id и label, а также признак required.')
        if isinstance(self.instance, Task) and 'photo_requirements' in cleaned:
            fields, mode = cleaned['photo_requirements'], cleaned.get('photo_mode')
            if mode == 'named' and not fields:
                self.add_error('photo_requirements', 'Добавьте хотя бы одно именованное поле для фото.')
            elif mode != 'named' and fields:
                self.add_error('photo_requirements', 'Именованные поля доступны только в режиме именованных фотографий.')
        return cleaned
