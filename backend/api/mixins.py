from rest_framework import serializers


class DeviceSerializerMixin(serializers.ModelSerializer):
    class Meta:
        fields = (
            'model',
            'serial_number',
            'warranty_until',
            'info'
        )
