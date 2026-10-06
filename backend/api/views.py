import json
from io import BytesIO
from urllib.parse import parse_qsl

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone

from rest_framework import viewsets, status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAdminUser, IsAuthenticated, SAFE_METHODS
from rest_framework.response import Response

from api.utils import validate_telegram_data
from api.qr import get_device_detail_url
from api.serializers import (
    ExpensePhotoSerializer, ExpensesSerializer, HeadsetSerializer,
    KeyboardSerializer, MonitorSerializer, MouseSerializer, PCSerializer,
    PlayStationSerializer, ReportPhotoSerializer, ReportSerializer,
    StationSerializer,
)
from computers.models import Headset, Keyboard, Monitor, Mouse, PC, PlayStation, Station
from reports.models import ExpensePhoto, Expenses, Report, ReportPhoto
from users.models import AdminUser

User = get_user_model()


class AuthViewSet(viewsets.ViewSet):
    @action(detail=False, methods=['post'], url_path='telegram')
    def telegram(self, request):
        """
        Handle Telegram authentication.
        """
        init_data = request.data.get('initData')
        bot_token = settings.TELEGRAM_BOT_TOKEN

        if not init_data:
            return Response(
                {'error': 'Данные Telegram не предоставлены'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if not validate_telegram_data(init_data, bot_token):
            return Response(
                {'error': 'Неверные данные Telegram'},
                status=status.HTTP_403_FORBIDDEN
            )

        parsed_data = dict(parse_qsl(init_data))
        user_data = json.loads(parsed_data.get('user', '{}'))
        telegram_id = str(user_data.get('id'))

        if not telegram_id:
            return Response(
                {'error': 'Нет Telegram ID в данных'},
                status=status.HTTP_400_BAD_REQUEST
            )

        user = User.objects.filter(telegram_id=telegram_id).first()

        if user:
            user.last_login = timezone.now()

            user.save(update_fields=['last_login'])

            token, _ = Token.objects.get_or_create(user=user)

            return Response(
                {'token': token.key, 'is_new_user': False},
                status=status.HTTP_200_OK
            )

        phone_number = request.data.get('phone_number')
        username = request.data.get('username')

        if not phone_number or not username:
            return Response(
                {'require_registration': 'True'},
                status=status.HTTP_404_NOT_FOUND
            )

        try:
            admin_user = AdminUser.objects.get(phone_number=phone_number)

        except AdminUser.DoesNotExist:
            return Response(
                {'error': 'Данного телефона нет в базе администраторов'},
                status=status.HTTP_404_NOT_FOUND
            )

        if User.objects.filter(phone_number=admin_user).exists():
            return Response(
                {'error': 'Этот номер телефона уже зарегистрирован'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if User.objects.filter(username=username).exists():
            return Response(
                {'error': 'Этот логин уже занят'},
                status=status.HTTP_400_BAD_REQUEST
            )

        user = User.objects.create(
            username=username,
            phone_number=admin_user,
            telegram_id=telegram_id,
            last_login=timezone.now()
        )

        user.set_unusable_password()
        user.save()

        token, _ = Token.objects.get_or_create(user=user)

        return Response(
            {'token': token.key, 'is_new_user': True},
            status=status.HTTP_201_CREATED
        )


class DeviceViewSet(viewsets.ModelViewSet):
    permission_classes = (IsAuthenticated,)
    identifier_field = 'serial_number'

    def get_permissions(self):
        permissions = super().get_permissions()
        if self.request.method not in SAFE_METHODS:
            permissions.append(IsAdminUser())
        return permissions

    @action(detail=False, methods=['get'])
    def lookup(self, request):
        """Return device details by the unique identifier embedded in its QR."""
        field = self.identifier_field
        identifier = request.query_params.get(field)
        if identifier is None or identifier == '':
            raise ValidationError({field: 'Укажите идентификатор устройства.'})
        if field == 'club_number':
            try:
                identifier = int(identifier)
            except ValueError:
                raise ValidationError({field: 'Номер должен быть целым числом.'})
            if not 0 <= identifier <= 32767:
                raise ValidationError({field: 'Номер должен быть от 0 до 32767.'})
        device = get_object_or_404(
            self.filter_queryset(self.get_queryset()), **{field: identifier},
        )
        self.check_object_permissions(request, device)
        return Response(self.get_serializer(device).data)

    @action(detail=True, methods=['get'], url_path='qr-code')
    def qr_code(self, request, pk=None):
        """Generate a printable PNG encoding the identifier-based detail URL."""
        import segno

        device = self.get_object()
        buffer = BytesIO()
        segno.make_qr(get_device_detail_url(device, request)).save(
            buffer, kind='png', scale=8, border=4, dark='black', light='white',
        )
        response = HttpResponse(buffer.getvalue(), content_type='image/png')
        response['Content-Disposition'] = (
            f'inline; filename="{device._meta.model_name}-{device.pk}-qr.png"'
        )
        response['Cache-Control'] = 'private, no-store'
        return response


class MouseViewSet(DeviceViewSet):
    queryset = Mouse.objects.all()
    serializer_class = MouseSerializer


class KeyboardViewSet(DeviceViewSet):
    queryset = Keyboard.objects.all()
    serializer_class = KeyboardSerializer


class HeadsetViewSet(DeviceViewSet):
    queryset = Headset.objects.all()
    serializer_class = HeadsetSerializer


class MonitorViewSet(DeviceViewSet):
    queryset = Monitor.objects.all()
    serializer_class = MonitorSerializer


class PCViewSet(DeviceViewSet):
    queryset = PC.objects.all()
    serializer_class = PCSerializer


class PlayStationViewSet(DeviceViewSet):
    queryset = PlayStation.objects.all()
    serializer_class = PlayStationSerializer


class StationViewSet(DeviceViewSet):
    queryset = Station.objects.select_related('mouse', 'keyboard', 'headset', 'monitor', 'pc')
    serializer_class = StationSerializer
    identifier_field = 'club_number'


class FinancialRecordViewSet(viewsets.ModelViewSet):
    permission_classes = (IsAuthenticated,)

    def perform_create(self, serializer):
        serializer.save(admin=self.request.user)


class ReportViewSet(FinancialRecordViewSet):
    queryset = Report.objects.select_related('admin').prefetch_related('photos').order_by('-date', '-pk')
    serializer_class = ReportSerializer


class ExpensesViewSet(FinancialRecordViewSet):
    queryset = Expenses.objects.select_related('admin').prefetch_related('photos').order_by('-date', '-pk')
    serializer_class = ExpensesSerializer


class ReportPhotoViewSet(viewsets.ModelViewSet):
    queryset = ReportPhoto.objects.select_related('report').order_by('pk')
    serializer_class = ReportPhotoSerializer
    permission_classes = (IsAuthenticated,)

    def perform_destroy(self, instance):
        with transaction.atomic():
            report = Report.objects.select_for_update().get(pk=instance.report_id)
            if report.photos.count() <= 1:
                raise ValidationError({'image': 'Нельзя удалить последнюю фотографию отчёта.'})
            instance.delete()


class ExpensePhotoViewSet(viewsets.ModelViewSet):
    queryset = ExpensePhoto.objects.select_related('expense').order_by('pk')
    serializer_class = ExpensePhotoSerializer
    permission_classes = (IsAuthenticated,)
