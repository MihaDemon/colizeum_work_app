import hmac
import re

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import connection, transaction
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from rest_framework import serializers, viewsets
from rest_framework.decorators import action, api_view, permission_classes, authentication_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from reports.exceptions import InsufficientCash
from reports.models import ExpensePhoto, ReportPhoto
from users.models import AdminUser
from . import services
from .commands import idempotent_command
from .models import Shift, Task, TaskSubmission
from .permissions import visible_tasks
from .presentation import task_data, workspace_data
from .serializers import CloseShiftSerializer, CreateTaskSerializer, ExpenseSerializer, OpenShiftSerializer, ReviewTaskSerializer, SubmitTaskSerializer


def validated(serializer_class, request):
    serializer = serializer_class(data=request.data)
    serializer.is_valid(raise_exception=True)
    return serializer.validated_data


@api_view(['GET'])
def workspace(request):
    return Response(workspace_data(request.user))


@api_view(['GET'])
@authentication_classes([])
@permission_classes([AllowAny])
def health(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT 1')
            cursor.fetchone()
    except Exception:
        return Response({'status': 'unavailable'}, status=503)
    return Response({'status': 'ok'})


class ShiftViewSet(viewsets.GenericViewSet):
    serializer_class = OpenShiftSerializer

    def get_serializer_class(self):
        return CloseShiftSerializer if self.action == 'close' else OpenShiftSerializer

    queryset = Shift.objects.all()

    @action(detail=False, methods=['post'])
    @idempotent_command
    def open(self, request):
        shift = services.open_shift(request.user, validated(OpenShiftSerializer, request))
        return Response({'id': str(shift.pk)}, status=201)

    @action(detail=True, methods=['post'])
    @idempotent_command
    def close(self, request, pk=None):
        shift = services.close_shift(request.user, pk, validated(CloseShiftSerializer, request))
        return Response({'id': str(shift.pk)})


class TaskViewSet(viewsets.GenericViewSet):
    serializer_class = CreateTaskSerializer

    def get_serializer_class(self):
        return {'submit': SubmitTaskSerializer, 'review': ReviewTaskSerializer}.get(self.action, CreateTaskSerializer)

    def get_queryset(self):
        return visible_tasks(self.request.user, Task.objects.prefetch_related('submissions'))

    def list(self, request):
        return Response([task_data(t) for t in self.get_queryset()])

    def retrieve(self, request, pk=None):
        return Response(task_data(self.get_object()))

    @idempotent_command
    def create(self, request):
        task = services.create_task(request.user, validated(CreateTaskSerializer, request))
        return Response(task_data(task), status=201)

    @action(detail=True, methods=['post'])
    @idempotent_command
    def submit(self, request, pk=None):
        self.get_object()
        task = services.submit_task(request.user, pk, validated(SubmitTaskSerializer, request))
        return Response(task_data(task))

    @action(detail=True, methods=['post'])
    @idempotent_command
    def review(self, request, pk=None):
        self.get_object()
        task = services.review_task(request.user, pk, validated(ReviewTaskSerializer, request))
        return Response(task_data(task))


@api_view(['POST'])
@idempotent_command
def expense(request):
    try:
        record = services.add_expense(request.user, validated(ExpenseSerializer, request))
    except InsufficientCash as exc:
        raise ValidationError({'amount': exc.messages})
    return Response({'id': str(record.pk)}, status=201)


@api_view(['GET'])
def private_file(request, kind, pk):
    if kind in ['reference', 'submission']:
        if kind == 'reference':
            task = get_object_or_404(visible_tasks(request.user, Task.objects.all()), pk=pk)
            image = task.reference_photo
        else:
            submission = get_object_or_404(TaskSubmission.objects.filter(task__in=visible_tasks(request.user, Task.objects.all())), pk=pk)
            image = submission.photo
    elif kind in ['report', 'expense']:
        model, parent = (ReportPhoto, 'report') if kind == 'report' else (ExpensePhoto, 'expense')
        photos = model.objects.all()
        if not request.user.is_staff and not request.user.is_superuser:
            photos = photos.filter(**{f'{parent}__admin': request.user})
        image = get_object_or_404(photos, pk=pk).image
    else:
        from django.http import Http404
        raise Http404
    if not image:
        from django.http import Http404
        raise Http404
    try:
        response = FileResponse(image.open('rb'))
    except FileNotFoundError:
        from django.http import Http404
        raise Http404
    response['Cache-Control'] = 'private, no-store'
    response['X-Content-Type-Options'] = 'nosniff'
    return response


class ContactSerializer(serializers.Serializer):
    telegram_id = serializers.RegexField(r'^[1-9][0-9]{0,19}$')
    phone_number = serializers.CharField(max_length=30)


@api_view(['POST'])
@authentication_classes([])
@permission_classes([AllowAny])
def bind_contact(request):
    # Only the bot service may attest that Telegram supplied the user's own contact.
    supplied = request.headers.get('X-Bot-Service-Token', '')
    if not settings.BOT_SERVICE_TOKEN or not hmac.compare_digest(supplied, settings.BOT_SERVICE_TOKEN):
        raise PermissionDenied('Invalid bot credentials.')
    data = validated(ContactSerializer, request)
    phone = re.sub(r'\D', '', data['phone_number'])
    if len(phone) == 11 and phone[0] in '78':
        phone = phone[1:]
    if len(phone) != 10:
        raise ValidationError({'phone_number': 'Use a Russian phone number.'})
    with transaction.atomic():
        contact = get_object_or_404(AdminUser.objects.select_for_update(), pk=phone)
        if contact.telegram_id and contact.telegram_id != data['telegram_id']:
            raise PermissionDenied('This phone is already linked to another Telegram account.')
        other = AdminUser.objects.filter(telegram_id=data['telegram_id']).exclude(pk=phone).exists()
        linked = get_user_model().objects.select_for_update().filter(phone_number=contact).first()
        foreign_user = get_user_model().objects.filter(telegram_id=data['telegram_id']).exclude(phone_number=contact).exists()
        if other or foreign_user or (linked and linked.telegram_id and linked.telegram_id != data['telegram_id']):
            raise PermissionDenied('This Telegram account or phone is already linked.')
        contact.telegram_id = data['telegram_id']
        contact.save(update_fields=['telegram_id'])
        if linked:
            if not linked.is_active:
                raise PermissionDenied('This account is disabled.')
            linked.telegram_id = data['telegram_id']
            linked.save(update_fields=['telegram_id'])
    return Response({'verified': True})
