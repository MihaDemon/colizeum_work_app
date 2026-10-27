from decimal import Decimal
from rest_framework import serializers
from django.contrib.auth import get_user_model


class PhotoField(serializers.ImageField):
    def to_internal_value(self, data):
        image = super().to_internal_value(data)
        if image.size > 5 * 1024 * 1024:
            raise serializers.ValidationError('Choose an image under 5 MB.')
        if image.image.format not in {'JPEG', 'PNG', 'WEBP'}:
            raise serializers.ValidationError('Use a JPG, PNG, or WebP photo.')
        return image


class OpenShiftSerializer(serializers.Serializer):
    shift_type = serializers.ChoiceField(choices=['day', 'night'])


class CloseShiftSerializer(serializers.Serializer):
    cash = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal('0'))
    cards = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal('0'))
    sbp = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal('0'))
    desk_photo = PhotoField()
    receipt_photo = PhotoField()
    additional_photo = PhotoField(required=False)

    def validate(self, attrs):
        if 'shift_type' in self.initial_data or 'shift' in self.initial_data:
            raise serializers.ValidationError('Shift type is fixed when the shift opens.')
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
    reference_photo = PhotoField(required=False)


class SubmitTaskSerializer(serializers.Serializer):
    photo = PhotoField(required=False)
    note = serializers.CharField(max_length=10000, required=False, allow_blank=True, default='')


class ReviewTaskSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)
    accept = serializers.BooleanField()
    reason = serializers.CharField(max_length=5000, required=False, allow_blank=True, default='')

    def validate(self, attrs):
        if not attrs['accept'] and not attrs['reason'].strip():
            raise serializers.ValidationError({'reason': 'Explain what needs to be corrected.'})
        return attrs
