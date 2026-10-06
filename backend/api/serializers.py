from django.contrib.auth import get_user_model

from rest_framework import serializers

from api.mixins import DeviceSerializerMixin
from computers.models import (
    Mouse, Keyboard, Monitor, Headset, PC, Station, PlayStation
)

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = (
            'username',
            'phone_number__first_name',
            'phone_number__last_name',
            'last_login',
            'is_active',
            'is_staff',
        )
        read_only_fields = fields


class MouseSerializer(DeviceSerializerMixin):
    class Meta(DeviceSerializerMixin.Meta):
        model = Mouse


class KeyboardSerializer(DeviceSerializerMixin):
    class Meta(DeviceSerializerMixin.Meta):
        model = Keyboard


class HeadsetSerializer(DeviceSerializerMixin):
    class Meta(DeviceSerializerMixin.Meta):
        model = Headset


class MonitorSerializer(DeviceSerializerMixin):
    class Meta(DeviceSerializerMixin.Meta):
        model = Monitor


class PCSerializer(serializers.ModelSerializer):
    class Meta:
        model = PC
        fields = (
            'serial_number',
            'cpu',
            'gpu',
            'ram',
            'storage',
            'warranty_until',
            'info'
        )


class StationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Station
        fields = (
            'club_name',
            'mouse',
            'keyboard',
            'headset',
            'monitor',
            'pc',
            'info'
        )


class PlayStationSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlayStation
        fields = (
            'club_number',
            'serial_number',
            'warranty_until',
            'info'
        )
