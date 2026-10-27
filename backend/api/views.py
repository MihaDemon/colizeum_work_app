import json
from collections.abc import Mapping
from urllib.parse import parse_qsl

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import transaction, IntegrityError
from django.core.exceptions import ValidationError as DjangoValidationError
from django.shortcuts import get_object_or_404
from django.utils import timezone

from rest_framework import viewsets
from rest_framework.authtoken.models import Token
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError, PermissionDenied
from rest_framework.permissions import AllowAny, IsAdminUser, IsAuthenticated, SAFE_METHODS
from rest_framework.response import Response

from api.utils import validate_telegram_data
from api.qr import qr_png_response
from api.downloads import qr_download_link
from api.serializers import (
    CashRegisterSerializer, ExpensePhotoSerializer, ExpensesSerializer, HeadsetSerializer,
    KeyboardSerializer, MonitorSerializer, MouseSerializer, PCSerializer,
    PlayStationSerializer, ReportPhotoSerializer, ReportSerializer,
    StationSerializer, UserSerializer, StaffPhoneField,
)
from computers.models import Headset, Keyboard, Monitor, Mouse, PC, PlayStation, Station
from reports.models import CashRegister, ExpensePhoto, Expenses, Report, ReportPhoto
from reports.exceptions import InsufficientCash
from users.models import AdminUser
from users.phones import normalize_staff_phone

User = get_user_model()


class AuthViewSet(viewsets.ViewSet):
    @staticmethod
    def telegram_id(request):
        if not isinstance(request.data, Mapping):
            raise ValidationError({'error': 'Ожидается объект с данными.'})
        init_data = request.data.get('initData')
        bot_token = settings.TELEGRAM_BOT_TOKEN

        if not init_data:
            raise ValidationError({'error': 'Данные Telegram не предоставлены'})

        if not validate_telegram_data(init_data, bot_token):
            raise PermissionDenied({'error': 'Неверные данные Telegram'})

        try:
            user_data = json.loads(dict(parse_qsl(init_data)).get('user', '{}'))
            ident = user_data.get('id')
            if isinstance(ident, bool) or not isinstance(ident, int) or ident <= 0:
                raise ValueError
            return str(ident)
        except (ValueError, TypeError, AttributeError):
            raise ValidationError({'error': 'Нет Telegram ID в данных'})

    @action(detail=False, methods=['post'], url_path='contact-status', permission_classes=[AllowAny], authentication_classes=[])
    def contact_status(self, request):
        ident = self.telegram_id(request)
        contact = AdminUser.objects.filter(telegram_id=ident).first()
        try:
            phone = normalize_staff_phone(contact.pk) if contact else None
        except DjangoValidationError:
            phone = None
        response = Response({'verified': True, 'phone_number': phone} if phone else {'verified': False})
        response['Cache-Control'] = 'no-store'
        return response

    @action(detail=False, methods=['post'], url_path='telegram', permission_classes=[AllowAny], authentication_classes=[])
    def telegram(self, request):
        telegram_id = self.telegram_id(request)
        user = User.objects.filter(telegram_id=telegram_id).first()
        if user:
            if not user.is_active:
                raise PermissionDenied('Учётная запись отключена.')
            user.last_login = timezone.now()
            user.save(update_fields=['last_login'])
            token, _ = Token.objects.get_or_create(user=user)
            return Response({'token': token.key, 'is_new_user': False})
        phone, username = request.data.get('phone_number'), request.data.get('username')
        if not phone or not username:
            return Response({'require_registration': True}, status=404)
        from rest_framework import serializers
        class RegistrationSerializer(serializers.ModelSerializer):
            phone_number = StaffPhoneField(max_length=32)

            class Meta:
                model = User
                fields = ['username', 'phone_number']
        registration = RegistrationSerializer(data={'username': username, 'phone_number': phone})
        registration.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                contact = AdminUser.objects.select_for_update().filter(telegram_id=telegram_id).first()
                if not contact or normalize_staff_phone(contact.pk) != registration.validated_data['phone_number']:
                    raise PermissionDenied('Подтвердите свой номер через Telegram в приложении. Суперпользователь должен добавить вас в список сотрудников.')
                if User.objects.filter(phone_number=contact).exists():
                    raise ValidationError({'phone_number': 'Этот телефон уже зарегистрирован.'})
                user = User.objects.create_user(username=registration.validated_data['username'], phone_number=contact,
                    first_name=contact.first_name, last_name=contact.last_name,
                    telegram_id=telegram_id, is_staff=contact.role == 'manager', last_login=timezone.now())
                token = Token.objects.create(user=user)
        except IntegrityError:
            raise ValidationError({'error': 'Аккаунт уже зарегистрирован. Выполните вход ещё раз.'})
        except DjangoValidationError:
            raise ValidationError({'phone_number': 'Проверьте номер в записи сотрудника у суперпользователя.'})
        return Response({'token': token.key, 'is_new_user': True}, status=201)

    @action(detail=False, methods=['get'], permission_classes=[IsAuthenticated])
    def me(self, request):
        return Response(UserSerializer(request.user).data)


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
        device = self.get_object()
        return qr_png_response(device, request)

    @action(detail=True, methods=['get'], url_path='qr-download')
    def qr_download(self, request, pk=None):
        device = self.get_object()
        response = Response(qr_download_link(device, request.user, request))
        response['Cache-Control'] = 'no-store'
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

    def get_queryset(self):
        queryset = super().get_queryset()
        if not self.request.user.is_staff and not self.request.user.is_superuser:
            queryset = queryset.filter(admin=self.request.user)
        return queryset

    def perform_create(self, serializer):
        # Mini App clients must use the shift workflow to prevent bypassing shift ownership.
        if not settings.ENABLE_LEGACY_FINANCIAL_WRITES:
            raise PermissionDenied('Используйте раздел смен или расходов.')
        serializer.save(admin=self.request.user)

    def check_mutable(self, instance):
        if not settings.ENABLE_LEGACY_FINANCIAL_WRITES:
            raise PermissionDenied('Используйте раздел смен. Финансовые исправления доступны в панели управления.')
        from workflows.models import Shift, ShiftExpense
        linked = Shift.objects.filter(report_id=instance.pk).exists() if isinstance(instance, Report) else ShiftExpense.objects.filter(expense_id=instance.pk).exists()
        if linked:
            raise PermissionDenied('Записи смен нельзя изменять. Для исправлений с сохранением истории используйте панель управления.')

    def perform_update(self, serializer):
        self.check_mutable(serializer.instance)
        serializer.save()

    def perform_destroy(self, instance):
        self.check_mutable(instance)
        with transaction.atomic(using=instance._state.db):
            instance.delete()

    def handle_exception(self, exc):
        if isinstance(exc, InsufficientCash):
            exc = ValidationError({'non_field_errors': exc.messages})
        return super().handle_exception(exc)


class ReportViewSet(FinancialRecordViewSet):
    queryset = Report.objects.select_related('admin').prefetch_related('photos').order_by('-date', '-pk')
    serializer_class = ReportSerializer


class ExpensesViewSet(FinancialRecordViewSet):
    queryset = Expenses.objects.select_related('admin').prefetch_related('photos').order_by('-date', '-pk')
    serializer_class = ExpensesSerializer


class CashRegisterViewSet(viewsets.GenericViewSet):
    """The register is a singleton; its balance is maintained by record saves."""
    permission_classes = (IsAuthenticated,)
    serializer_class = CashRegisterSerializer

    def list(self, request):
        register = CashRegister.objects.filter(pk=1).first() or CashRegister()
        return Response(self.get_serializer(register).data)


class FinancialPhotoViewSet(viewsets.ModelViewSet):
    def get_queryset(self):
        queryset = super().get_queryset()
        if not self.request.user.is_staff and not self.request.user.is_superuser:
            queryset = queryset.filter(**{f'{self.parent_field}__admin': self.request.user})
        return queryset

    def check_parent(self, parent):
        if parent.admin_id != self.request.user.pk and not (self.request.user.is_staff or self.request.user.is_superuser):
            raise PermissionDenied('Эта запись принадлежит другому сотруднику.')
        FinancialRecordViewSet.check_mutable(self, parent)

    def perform_create(self, serializer):
        self.check_parent(serializer.validated_data[self.parent_field])
        serializer.save()

    def perform_update(self, serializer):
        self.check_parent(getattr(serializer.instance, self.parent_field))
        self.check_parent(serializer.validated_data.get(self.parent_field, getattr(serializer.instance, self.parent_field)))
        serializer.save()

    def perform_destroy(self, instance):
        self.check_parent(getattr(instance, self.parent_field))
        instance.delete()


class ReportPhotoViewSet(FinancialPhotoViewSet):
    parent_field = 'report'
    queryset = ReportPhoto.objects.select_related('report').order_by('pk')
    serializer_class = ReportPhotoSerializer
    permission_classes = (IsAuthenticated,)

    def perform_destroy(self, instance):
        with transaction.atomic():
            self.check_parent(instance.report)
            report = Report.objects.select_for_update().get(pk=instance.report_id)
            if report.photos.count() <= 1:
                raise ValidationError({'image': 'Нельзя удалить последнюю фотографию отчёта.'})
            instance.delete()


class ExpensePhotoViewSet(FinancialPhotoViewSet):
    parent_field = 'expense'
    queryset = ExpensePhoto.objects.select_related('expense').order_by('pk')
    serializer_class = ExpensePhotoSerializer
    permission_classes = (IsAuthenticated,)
