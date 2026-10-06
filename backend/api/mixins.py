from rest_framework import serializers

from api.qr import get_device_detail_url, get_device_qr_url


class QRCodeSerializerMixin(serializers.ModelSerializer):
    detail_url = serializers.SerializerMethodField()
    qr_code_url = serializers.SerializerMethodField()

    def get_detail_url(self, obj):
        return get_device_detail_url(obj, self.context.get('request'))

    def get_qr_code_url(self, obj):
        return get_device_qr_url(obj, self.context.get('request'))


class DeviceSerializerMixin(QRCodeSerializerMixin):
    class Meta:
        fields = (
            'id',
            'model',
            'serial_number',
            'warranty_until',
            'info',
            'detail_url',
            'qr_code_url',
        )
