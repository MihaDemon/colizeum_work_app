from copy import deepcopy

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from .commands import idempotent_command
from .models import AutomaticTaskTemplate, Task
from .permissions import person, role
from .presentation import file_url, participant_name
from .serializers import CreateTaskSerializer


class TemplateSerializer(CreateTaskSerializer):
    assignee = None
    shift_type = serializers.ChoiceField(choices=['both', 'day', 'night'], default='both')
    enabled = serializers.BooleanField(default=True)
    version = serializers.IntegerField(min_value=1, required=False)
    clear_reference_photo = serializers.BooleanField(default=False)
    reviewer_ids = serializers.JSONField(required=False)

    def validate_reviewer_ids(self, value):
        if not isinstance(value, list) or not 1 <= len(value) <= 100 or any(type(pk) is not int or pk < 1 for pk in value):
            raise serializers.ValidationError('Выберите от одного до ста ответственных сотрудников.')
        return value


class TemplateToggleSerializer(serializers.Serializer):
    enabled = serializers.BooleanField()
    version = serializers.IntegerField(min_value=1)


class TemplateDeleteSerializer(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)


def management(user):
    if role(user) == 'admin':
        raise PermissionDenied('Настраивать автоматические задачи могут управляющие и суперпользователи.')


def template_data(template, user):
    return {'id': str(template.pk), 'title': template.title, 'description': template.description,
            'shiftType': template.shift_type, 'enabled': template.enabled, 'priority': template.priority,
            'photoMode': template.photo_mode, 'photoRequirements': template.photo_requirements,
            'referencePhoto': file_url('automatic-reference', template.pk) if template.reference_photo else None,
            'version': template.version, 'creatorName': participant_name(template, 'creator'), 'creatorId': str(template.creator_id) if template.creator_id else None,
            'canEdit': user.is_superuser or template.creator_id == user.pk,
            'reviewerIds': [str(p.pk) for p in template.reviewers.all()],
            'reviewers': [person(p) for p in template.reviewers.all()]}


@transaction.atomic
def save_template(user, data, pk=None):
    from .services import Conflict, event, lock_register
    management(user)
    lock_register(user)
    values = dict(data)
    reviewer_ids = values.pop('reviewer_ids', None)
    reviewers = None
    if reviewer_ids is not None:
        if not user.is_superuser:
            raise PermissionDenied('Назначать ответственных за автоматическую задачу может только суперпользователь.')
        reviewers = list(get_user_model().objects.filter(pk__in=set(reviewer_ids), is_active=True).filter(Q(is_staff=True) | Q(is_superuser=True)))
        if len(reviewers) != len(set(reviewer_ids)):
            raise serializers.ValidationError({'reviewer_ids': 'Выберите активных управляющих или суперпользователей.'})
    version = values.pop('version', None)
    values.pop('requires_photo', None)
    if values.pop('clear_reference_photo', False):
        values['reference_photo'] = ''
    if pk is None:
        template = AutomaticTaskTemplate.objects.create(creator=user, **values)
    else:
        template = get_object_or_404(AutomaticTaskTemplate, pk=pk, deleted_at__isnull=True)
        if not (user.is_superuser or template.creator_id == user.pk):
            raise PermissionDenied('Изменить автоматическую задачу может её постановщик или суперпользователь.')
        if version != template.version:
            raise Conflict('Автоматическая задача изменилась. Обновите список и повторите сохранение.')
        for field, value in values.items():
            setattr(template, field, value)
        template.version += 1
        template.save()
    if reviewers is not None:
        template.reviewers.set(reviewers)
    event(user, 'Автоматическая задача настроена', template.title, kind='task')
    return template


@transaction.atomic
def delete_template(user, pk, version):
    from .services import Conflict, event, lock_register
    management(user)
    lock_register(user)
    template = get_object_or_404(AutomaticTaskTemplate, pk=pk, deleted_at__isnull=True)
    if not (user.is_superuser or template.creator_id == user.pk):
        raise PermissionDenied('Удалить автоматическую задачу может её постановщик или суперпользователь.')
    if version != template.version:
        raise Conflict('Автоматическая задача изменилась. Обновите список и повторите удаление.')
    template.deleted_at = timezone.now()
    template.enabled = False
    template.version += 1
    template.save(update_fields=['deleted_at', 'enabled', 'version'])
    event(user, 'Автоматическая задача удалена', template.title, kind='task')


@api_view(['GET', 'POST'])
@idempotent_command
def templates(request):
    management(request.user)
    if request.method == 'POST':
        serializer = TemplateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        template = save_template(request.user, serializer.validated_data)
        return Response(template_data(template, request.user), status=201)
    return Response([template_data(t, request.user) for t in AutomaticTaskTemplate.objects.filter(deleted_at__isnull=True).select_related('creator__phone_number').prefetch_related('reviewers__phone_number')])


@api_view(['GET'])
def reviewer_choices(request):
    if not request.user.is_superuser:
        raise PermissionDenied('Список ответственных доступен только суперпользователю.')
    return Response([person(p) for p in get_user_model().objects.filter(is_active=True).filter(Q(is_staff=True) | Q(is_superuser=True)).select_related('phone_number').order_by('pk')])


@api_view(['POST', 'PATCH', 'DELETE'])
@idempotent_command
def template_detail(request, pk):
    management(request.user)
    if request.method == 'DELETE':
        serializer = TemplateDeleteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        delete_template(request.user, pk, serializer.validated_data['version'])
        return Response({'id': str(pk), 'deleted': True})
    get_object_or_404(AutomaticTaskTemplate, pk=pk, deleted_at__isnull=True)
    serializer_class = TemplateToggleSerializer if request.method == 'PATCH' else TemplateSerializer
    serializer = serializer_class(data=request.data)
    serializer.is_valid(raise_exception=True)
    return Response(template_data(save_template(request.user, serializer.validated_data, pk), request.user))


def create_shift_tasks(shift):
    from .notifications import queue_task_assigned
    from .services import event
    templates = AutomaticTaskTemplate.objects.filter(enabled=True, deleted_at__isnull=True).filter(Q(shift_type='both') | Q(shift_type=shift.shift_type)).select_related('creator').prefetch_related('reviewers__phone_number')
    owner = None
    for template in templates:
        creator = template.creator
        if not creator or not creator.is_active or role(creator) == 'admin':
            if owner is None:
                owner = get_user_model().objects.filter(is_active=True, is_superuser=True).order_by('pk').first()
            creator = owner
        fields = deepcopy(template.photo_requirements)
        configured = list(template.reviewers.all())
        reviewers = [p for p in configured if p.is_active and role(p) != 'admin']
        if not reviewers and not configured and creator:
            reviewers = [creator]
        if not reviewers:
            reviewers = list(get_user_model().objects.filter(is_active=True, is_superuser=True).select_related('phone_number'))
        task = Task.objects.create(
            creator=creator, assignee=shift.admin, shift=shift, required_for_shift=shift, automatic_template=template,
            title=template.title, description=template.description, priority=template.priority,
            photo_mode=template.photo_mode, photo_requirements=fields, reference_photo=template.reference_photo.name,
            requires_photo=template.photo_mode in ('single', 'multiple') or (template.photo_mode == 'named' and any(f['required'] for f in fields)),
            reviewer_snapshots=[person(p) for p in reviewers],
        )
        task.reviewers.set(reviewers)
        event(creator, 'Автоматическая задача назначена', task.title, kind='task', task=task)
        queue_task_assigned(task)
