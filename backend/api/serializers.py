from django.contrib.auth import get_user_model
from django.db import transaction

from rest_framework import serializers

from api.mixins import DeviceSerializerMixin, QRCodeSerializerMixin
from computers.models import (
    Mouse, Keyboard, Monitor, Headset, PC, Station, PlayStation
)
from reports.models import ExpensePhoto, Expenses, Report, ReportPhoto

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


class PCSerializer(QRCodeSerializerMixin):
    class Meta:
        model = PC
        fields = (
            'id',
            'serial_number',
            'cpu',
            'gpu',
            'ram',
            'storage',
            'warranty_until',
            'info',
            'detail_url',
            'qr_code_url',
        )


class StationSerializer(QRCodeSerializerMixin):
    class Meta:
        model = Station
        fields = (
            'id',
            'club_number',
            'mouse',
            'keyboard',
            'headset',
            'monitor',
            'pc',
            'info',
            'detail_url',
            'qr_code_url',
        )


class PlayStationSerializer(QRCodeSerializerMixin):
    class Meta:
        model = PlayStation
        fields = (
            'id',
            'club_number',
            'serial_number',
            'warranty_until',
            'info',
            'detail_url',
            'qr_code_url',
        )


class ReportPhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = ReportPhoto
        fields = ('id', 'report', 'image')

    def validate_report(self, value):
        if self.instance and self.instance.report_id != value.pk:
            raise serializers.ValidationError('Фотографию нельзя перенести в другой отчёт.')
        return value


class ExpensePhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExpensePhoto
        fields = ('id', 'expense', 'image')


class FinancialRecordSerializer(serializers.ModelSerializer):
    uploaded_photos = serializers.ListField(
        child=serializers.ImageField(), write_only=True, required=False,
        allow_empty=True,
    )
    photo_model = None
    photo_parent_field = None

    def save_photos(self, instance, images):
        for image in images:
            self.photo_model.objects.create(
                **{self.photo_parent_field: instance}, image=image,
            )

    @transaction.atomic
    def create(self, validated_data):
        images = validated_data.pop('uploaded_photos', [])
        instance = super().create(validated_data)
        self.save_photos(instance, images)
        return instance

    @transaction.atomic
    def update(self, instance, validated_data):
        images = validated_data.pop('uploaded_photos', [])
        instance = super().update(instance, validated_data)
        self.save_photos(instance, images)
        return instance


class ReportSerializer(FinancialRecordSerializer):
    photos = ReportPhotoSerializer(many=True, read_only=True)
    photo_model = ReportPhoto
    photo_parent_field = 'report'

    class Meta:
        model = Report
        fields = (
            'id', 'shift', 'date', 'admin', 'cards', 'spb', 'cash',
            'remaining_cash', 'encashment', 'info', 'photos', 'uploaded_photos',
        )
        read_only_fields = ('id', 'date', 'admin', 'photos')

    def validate(self, attrs):
        has_existing_photos = self.instance and self.instance.photos.exists()
        if not has_existing_photos and not attrs.get('uploaded_photos'):
            raise serializers.ValidationError({
                'uploaded_photos': 'Для отчёта необходима хотя бы одна фотография.',
            })
        return attrs


class ExpensesSerializer(FinancialRecordSerializer):
    photos = ExpensePhotoSerializer(many=True, read_only=True)
    photo_model = ExpensePhoto
    photo_parent_field = 'expense'

    class Meta:
        model = Expenses
        fields = ('id', 'date', 'admin', 'amount', 'info', 'photos', 'uploaded_photos')
        read_only_fields = ('id', 'date', 'admin', 'photos')
