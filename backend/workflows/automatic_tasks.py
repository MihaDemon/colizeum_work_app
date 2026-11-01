from copy import deepcopy

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from .commands import idempotent_command
from .models import AutomaticTaskTemplate, Task
from .permissions import role
from .presentation import file_url, participant_name
from .serializers import CreateTaskSerializer


class TemplateSerializer(CreateTaskSerializer):
    assignee = None
    shift_type = serializers.ChoiceField(choices=['both', 'day', 'night'], default='both')
    enabled = serializers.BooleanField(default=True)
    version = serializers.IntegerField(min_value=1, required=False)
    clear_reference_photo = serializers.BooleanField(default=False)


def management(user):
    if role(user) == 'admin':
        raise PermissionDenied('Настраивать автоматические задачи могут управляющие и суперпользователи.')


def template_data(template, user):
    return {'id': str(template.pk), 'title': template.title, 'description': template.description,
            'shiftType': template.shift_type, 'enabled': template.enabled, 'priority': template.priority,
            'photoMode': template.photo_mode, 'photoRequirements': template.photo_requirements,
            'referencePhoto': file_url('automatic-reference', template.pk) if template.reference_photo else None,
            'version': template.version, 'creatorName': participant_name(template, 'creator'),
            'canEdit': user.is_superuser or template.creator_id == user.pk}


@transaction.atomic
def save_template(user, data, pk=None):
    from .services import Conflict, event, lock_register
    management(user)
    lock_register(user)
    values = dict(data)
    version = values.pop('version', None)
    values.pop('requires_photo', None)
    if values.pop('clear_reference_photo', False):
        values['reference_photo'] = ''
    if pk is None:
        template = AutomaticTaskTemplate.objects.create(creator=user, **values)
    else:
        template = AutomaticTaskTemplate.objects.get(pk=pk)
        if not (user.is_superuser or template.creator_id == user.pk):
            raise PermissionDenied('Изменить автоматическую задачу может её постановщик или суперпользователь.')
        if version != template.version:
            raise Conflict('Автоматическая задача изменилась. Обновите список и повторите сохранение.')
        for field, value in values.items():
            setattr(template, field, value)
        template.version += 1
        template.save()
    event(user, 'Автоматическая задача настроена', template.title, kind='task')
    return template


@api_view(['GET', 'POST'])
@idempotent_command
def templates(request):
    management(request.user)
    if request.method == 'POST':
        serializer = TemplateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        template = save_template(request.user, serializer.validated_data)
        return Response(template_data(template, request.user), status=201)
    return Response([template_data(t, request.user) for t in AutomaticTaskTemplate.objects.select_related('creator__phone_number')])


@api_view(['POST'])
@idempotent_command
def template_detail(request, pk):
    management(request.user)
    from django.shortcuts import get_object_or_404
    get_object_or_404(AutomaticTaskTemplate, pk=pk)
    serializer = TemplateSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    return Response(template_data(save_template(request.user, serializer.validated_data, pk), request.user))


def create_shift_tasks(shift):
    from .notifications import queue_task_assigned
    from .services import event
    templates = AutomaticTaskTemplate.objects.filter(enabled=True).filter(Q(shift_type='both') | Q(shift_type=shift.shift_type)).select_related('creator')
    owner = None
    for template in templates:
        creator = template.creator
        if not creator or not creator.is_active or role(creator) == 'admin':
            if owner is None:
                owner = get_user_model().objects.filter(is_active=True, is_superuser=True).order_by('pk').first()
            creator = owner
        fields = deepcopy(template.photo_requirements)
        task = Task.objects.create(
            creator=creator, assignee=shift.admin, shift=shift, required_for_shift=shift, automatic_template=template,
            title=template.title, description=template.description, priority=template.priority,
            photo_mode=template.photo_mode, photo_requirements=fields, reference_photo=template.reference_photo.name,
            requires_photo=template.photo_mode in ('single', 'multiple') or (template.photo_mode == 'named' and any(f['required'] for f in fields)),
        )
        event(creator, 'Автоматическая задача назначена', task.title, kind='task', task=task)
        queue_task_assigned(task)
