from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.core.exceptions import ValidationError as DjangoValidationError

from rest_framework import serializers

from api.mixins import DeviceSerializerMixin, QRCodeSerializerMixin
from computers.models import (
    Mouse, Keyboard, Monitor, Headset, Gamepad, PC, Station, PlayStation, PlayStationGamepad
)
from reports.models import CashRegister, ExpensePhoto, Expenses, Report, ReportPhoto
from users.phones import normalize_staff_phone

User = get_user_model()


class StaffPhoneField(serializers.CharField):
    def to_internal_value(self, data):
        value = super().to_internal_value(data)
        try:
            return normalize_staff_phone(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages)


class UserSerializer(serializers.ModelSerializer):
    role = serializers.SerializerMethodField()

    def get_role(self, user):
        from workflows.permissions import role
        return role(user)

    first_name = serializers.CharField(source='phone_number.first_name', read_only=True, default='')
    last_name = serializers.CharField(source='phone_number.last_name', read_only=True, default='')
    phone_number = serializers.CharField(source='phone_number_id', read_only=True, allow_null=True)

    class Meta:
        model = User
        fields = (
            'username',
            'id', 'phone_number', 'first_name', 'last_name',
            'last_login',
            'is_active',
            'is_staff', 'is_superuser', 'role',
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


class GamepadSerializer(DeviceSerializerMixin):
    playstation = serializers.PrimaryKeyRelatedField(source='playstation_link.playstation', read_only=True, allow_null=True)

    class Meta(DeviceSerializerMixin.Meta):
        model = Gamepad
        fields = (*DeviceSerializerMixin.Meta.fields, 'playstation')


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
    gamepads = serializers.PrimaryKeyRelatedField(queryset=Gamepad.objects.all(), many=True, required=False)

    def validate_gamepads(self, values):
        if len({device.pk for device in values}) != len(values):
            raise serializers.ValidationError('Один геймпад нельзя указать дважды.')
        links = PlayStationGamepad.objects.filter(gamepad__in=values)
        if self.instance:
            links = links.exclude(playstation=self.instance)
        if links.exists():
            raise serializers.ValidationError('Геймпад уже подключён к другой PlayStation. Сначала отключите его там.')
        return values

    def create(self, validated_data):
        try:
            with transaction.atomic():
                return super().create(validated_data)
        except IntegrityError:
            raise serializers.ValidationError({'gamepads': 'Подключения изменились. Обновите устройства и повторите сохранение.'})

    def update(self, instance, validated_data):
        try:
            with transaction.atomic():
                return super().update(instance, validated_data)
        except IntegrityError:
            raise serializers.ValidationError({'gamepads': 'Подключения изменились. Обновите устройства и повторите сохранение.'})

    class Meta:
        model = PlayStation
        fields = (
            'id',
            'gamepads',
            'club_number',
            'serial_number',
            'warranty_until',
            'info',
            'detail_url',
            'qr_code_url',
        )


class ReportPhotoSerializer(serializers.ModelSerializer):
    def to_representation(self, instance):
        data = super().to_representation(instance)
        data['image'] = f'/api/files/report/{instance.pk}/'
        return data

    class Meta:
        model = ReportPhoto
        fields = ('id', 'report', 'image')

    def validate_report(self, value):
        if self.instance and self.instance.report_id != value.pk:
            raise serializers.ValidationError('Фотографию нельзя перенести в другой отчёт.')
        return value


class ExpensePhotoSerializer(serializers.ModelSerializer):
    def to_representation(self, instance):
        data = super().to_representation(instance)
        data['image'] = f'/api/files/expense/{instance.pk}/'
        return data

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
            'info', 'photos', 'uploaded_photos',
        )
        read_only_fields = ('id', 'admin', 'photos')

    def validate(self, attrs):
        has_existing_photos = self.instance and self.instance.photos.exists()
        if not has_existing_photos and not attrs.get('uploaded_photos'):
            raise serializers.ValidationError({
                'uploaded_photos': 'Для отчёта необходима хотя бы одна фотография.',
            })
        return attrs


class ExpensesSerializer(FinancialRecordSerializer):
    photos = ExpensePhotoSerializer(many=True, read_only=True)
    # HTML/multipart omissions otherwise default a BooleanField to False in DRF.
    from_register = serializers.BooleanField(default=True)
    photo_model = ExpensePhoto
    photo_parent_field = 'expense'

    class Meta:
        model = Expenses
        fields = ('id', 'date', 'admin', 'amount', 'from_register', 'info', 'photos', 'uploaded_photos')
        read_only_fields = ('id', 'date', 'admin', 'photos')


class CashRegisterSerializer(serializers.ModelSerializer):
    class Meta:
        model = CashRegister
        fields = ('id', 'balance')
        read_only_fields = fields
