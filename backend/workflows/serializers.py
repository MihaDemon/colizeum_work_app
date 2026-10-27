from decimal import Decimal
from rest_framework import serializers
from django.contrib.auth import get_user_model
from .photos import MAX_PHOTOS


class PhotoRequirementSerializer(serializers.Serializer):
    id = serializers.RegexField(r'^[a-zA-Z0-9_-]{1,64}$')
    label = serializers.CharField(max_length=100)
    required = serializers.BooleanField(default=True)


class PhotoRequirementsField(serializers.JSONField):
    def to_internal_value(self, data):
        data = super().to_internal_value(data)
        if not isinstance(data, list) or len(data) > MAX_PHOTOS:
            raise serializers.ValidationError('Можно добавить не более 10 полей для фотографий.')
        fields = PhotoRequirementSerializer(data=data, many=True)
        fields.is_valid(raise_exception=True)
        values = fields.validated_data
        if len({field['id'] for field in values}) != len(values) or len({field['label'].casefold() for field in values}) != len(values):
            raise serializers.ValidationError('Названия и идентификаторы полей для фото должны различаться.')
        return values


class PhotoSettingsSerializer(serializers.Serializer):
    report_fields = PhotoRequirementsField()
    version = serializers.IntegerField(min_value=1)


class PhotoField(serializers.ImageField):
    def to_internal_value(self, data):
        image = super().to_internal_value(data)
        if image.size > 5 * 1024 * 1024:
            raise serializers.ValidationError('Выберите изображение не более 5 МБ.')
        if image.image.format not in {'JPEG', 'PNG', 'WEBP'}:
            raise serializers.ValidationError('Используйте фото в формате JPG, PNG или WebP.')
        return image


class OpenShiftSerializer(serializers.Serializer):
    shift_type = serializers.ChoiceField(choices=['day', 'night'])


class PhotoUploadSerializer(serializers.Serializer):
    photos = serializers.ListField(child=PhotoField(), required=False, max_length=MAX_PHOTOS)
    photo_slots = serializers.JSONField(required=False)

    def validate(self, attrs):
        slots = attrs.get('photo_slots')
        if slots is not None and (
            not isinstance(slots, list) or len(slots) != len(attrs.get('photos', []))
            or any(not isinstance(slot, str) or len(slot) > 64 for slot in slots)
        ):
            raise serializers.ValidationError({'photo_slots': 'Укажите идентификатор поля для каждой фотографии.'})
        return attrs


class CloseShiftSerializer(PhotoUploadSerializer):
    cash = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal('0'))
    cards = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal('0'))
    sbp = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal('0'))
    desk_photo = PhotoField(required=False)
    receipt_photo = PhotoField(required=False)
    additional_photo = PhotoField(required=False)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if 'shift_type' in self.initial_data or 'shift' in self.initial_data:
            raise serializers.ValidationError('Тип смены задаётся при открытии и не меняется при закрытии.')
        return attrs


class ExpenseSerializer(serializers.Serializer):
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal('0.01'))
    description = serializers.CharField(max_length=5000)
    photo = PhotoField(required=False)


class CreateTaskSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=200)
    description = serializers.CharField(max_length=10000, required=False, allow_blank=True, default='')
    assignee = serializers.PrimaryKeyRelatedField(queryset=get_user_model().objects.filter(is_active=True))
    priority = serializers.ChoiceField(choices=['normal', 'high', 'low'], default='normal')
    requires_photo = serializers.BooleanField(default=False)
    photo_mode = serializers.ChoiceField(choices=['optional', 'single', 'multiple', 'named'], required=False)
    photo_requirements = PhotoRequirementsField(required=False, default=list)
    reference_photo = PhotoField(required=False)

    def validate(self, attrs):
        mode = attrs.setdefault('photo_mode', 'single' if attrs['requires_photo'] else 'optional')
        fields = attrs['photo_requirements']
        if mode == 'named' and not fields:
            raise serializers.ValidationError({'photo_requirements': 'Добавьте хотя бы одно именованное поле для фото.'})
        if mode != 'named' and fields:
            raise serializers.ValidationError({'photo_requirements': 'Именованные поля доступны только для режима фото по указанным полям.'})
        attrs['requires_photo'] = mode in ['single', 'multiple'] or (mode == 'named' and any(field['required'] for field in fields))
        return attrs


class SubmitTaskSerializer(PhotoUploadSerializer):
    photo = PhotoField(required=False)
    retained_photos = serializers.JSONField(required=False)
    note = serializers.CharField(max_length=10000, required=False, allow_blank=True, default='')

    def validate(self, attrs):
        attrs = super().validate(attrs)
        retained = attrs.get('retained_photos')
        if retained is not None and (not isinstance(retained, list) or len(retained) > MAX_PHOTOS or any(not isinstance(pk, str) or len(pk) > 64 for pk in retained) or len(set(retained)) != len(retained)):
            raise serializers.ValidationError({'retained_photos': 'Выберите допустимые фотографии из предыдущего выполнения.'})
        return attrs


class ReviewTaskSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)
    accept = serializers.BooleanField()
    reason = serializers.CharField(max_length=5000, required=False, allow_blank=True, default='')

    def validate(self, attrs):
        if not attrs['accept'] and not attrs['reason'].strip():
            raise serializers.ValidationError({'reason': 'Объясните, что нужно исправить.'})
        return attrs
