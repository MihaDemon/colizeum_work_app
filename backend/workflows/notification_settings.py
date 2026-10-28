from django.db import transaction
from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from .models import NotificationPreferences, TelegramNotification


NOTIFICATION_KINDS = ('task_assigned', 'task', 'shift_open', 'shift_close', 'expense', 'cleaner', 'schedule')


def preferences(user):
    stored = NotificationPreferences.objects.filter(user=user).values_list('telegram', flat=True).first() or {}
    return {kind: stored.get(kind, True) for kind in NOTIFICATION_KINDS}


def telegram_enabled(user, kind):
    # Administrators always receive assignments; management controls only their own delivery.
    return not (user.is_staff or user.is_superuser) or preferences(user).get(kind, True)


class PreferenceSerializer(serializers.Serializer):
    task_assigned = serializers.BooleanField(required=False)
    task = serializers.BooleanField(required=False)
    shift_open = serializers.BooleanField(required=False)
    shift_close = serializers.BooleanField(required=False)
    expense = serializers.BooleanField(required=False)
    cleaner = serializers.BooleanField(required=False)
    schedule = serializers.BooleanField(required=False)

    def to_internal_value(self, data):
        if not isinstance(data, dict) or set(data) - set(NOTIFICATION_KINDS):
            raise serializers.ValidationError({'non_field_errors': ['Укажите только поддерживаемые типы уведомлений.']})
        if any(type(value) is not bool for value in data.values()):
            raise serializers.ValidationError({'non_field_errors': ['Для каждого типа уведомлений укажите включено или выключено.']})
        return super().to_internal_value(data)


@api_view(['GET', 'PATCH'])
def notification_settings(request):
    if not (request.user.is_staff or request.user.is_superuser):
        raise PermissionDenied('Настройки уведомлений доступны только управляющим и суперпользователям.')
    if request.method == 'PATCH':
        serializer = PreferenceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            NotificationPreferences.objects.get_or_create(user=request.user)
            record = NotificationPreferences.objects.select_for_update().get(user=request.user)
            record.telegram = {**record.telegram, **serializer.validated_data}
            record.save(update_fields=['telegram'])
            disabled = [kind for kind, enabled in serializer.validated_data.items() if not enabled]
            TelegramNotification.objects.filter(recipient=request.user, kind__in=disabled, status__in=['pending', 'sending']).update(status='skipped', last_error='Уведомление отключено получателем.')
    return Response(preferences(request.user))
