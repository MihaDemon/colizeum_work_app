"""Staff invitations and logins share a single identity throughout edits."""
from collections.abc import Mapping

from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.response import Response

from api.serializers import StaffPhoneField
from users.constraints import MAX_FIRST_NAME_LENGTH, MAX_LAST_NAME_LENGTH
from users.models import AdminUser
from users.phones import matching_staff_numbers
from .services import lock_register


class StaffSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=MAX_FIRST_NAME_LENGTH)
    last_name = serializers.CharField(max_length=MAX_LAST_NAME_LENGTH)
    phone_number = StaffPhoneField(max_length=32)
    role = serializers.ChoiceField(choices=['admin', 'manager'])
    is_active = serializers.BooleanField(default=True)

    def to_internal_value(self, data):
        if isinstance(data, Mapping) and set(data) - set(self.fields):
            raise ValidationError({'non_field_errors': 'Можно изменять только имя, фамилию, телефон, роль и активность сотрудника.'})
        return super().to_internal_value(data)


def require_superuser(user):
    if not user.is_superuser:
        raise PermissionDenied('Управлять персоналом может только суперпользователь.')


def cards():
    # A superuser account may have an allowlist card, but is never editable here.
    return AdminUser.objects.select_related('user').filter(Q(user__is_superuser=False) | Q(user__isnull=True))


def staff_data(card):
    linked = getattr(card, 'user', None)
    return {
        'id': card.pk, 'first_name': card.first_name, 'last_name': card.last_name,
        'phone_number': card.pk, 'role': card.role,
        'is_active': card.is_active and (linked.is_active if linked else True),
        'registered': linked is not None,
    }


def unlisted_data(user):
    return {'id': f'user-{user.pk}', 'first_name': user.first_name, 'last_name': user.last_name,
            'phone_number': '', 'role': 'manager' if user.is_staff else 'admin',
            'is_active': user.is_active, 'registered': True}


@api_view(['GET', 'POST'])
def personnel(request):
    require_superuser(request.user)
    if request.method == 'GET':
        unlisted = get_user_model().objects.filter(phone_number=None, is_superuser=False)
        return Response({'results': [staff_data(card) for card in cards()] + [unlisted_data(user) for user in unlisted]})
    serializer = StaffSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    try:
        with transaction.atomic():
            lock_register(request.user)
            if matching_staff_numbers(data['phone_number']):
                raise ValidationError({'phone_number': 'Сотрудник с таким номером уже добавлен.'})
            card = AdminUser.objects.create(**data)
    except IntegrityError:
        raise ValidationError({'phone_number': 'Сотрудник с таким номером уже добавлен.'})
    return Response(staff_data(card), status=201)


def edit_unlisted(request, ident):
    """Django-created accounts can be edited before a phone card is attached."""
    try:
        user_id = int(ident.removeprefix('user-'))
    except ValueError:
        from django.http import Http404
        raise Http404
    serializer = StaffSerializer(data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    try:
        with transaction.atomic():
            lock_register(request.user)
            user = get_object_or_404(get_user_model().objects.select_for_update(), pk=user_id, phone_number=None, is_superuser=False)
            phone = data.pop('phone_number', None)
            card = None
            if phone:
                if matching_staff_numbers(phone):
                    raise ValidationError({'phone_number': 'Сотрудник с таким номером уже добавлен.'})
                card = AdminUser.objects.create(phone_number=phone, telegram_id=user.telegram_id,
                    first_name=data.get('first_name', user.first_name), last_name=data.get('last_name', user.last_name),
                    role=data.get('role', 'manager' if user.is_staff else 'admin'), is_active=data.get('is_active', user.is_active))
                user.phone_number = card
            for key, value in data.items():
                setattr(user, 'is_staff' if key == 'role' else key, value == 'manager' if key == 'role' else value)
            user.save()
            if not user.is_active:
                Token.objects.filter(user=user).delete()
    except IntegrityError:
        raise ValidationError({'phone_number': 'Телефон или Telegram уже связан с другим сотрудником.'})
    return Response(staff_data(card) if card else unlisted_data(user))


@api_view(['PATCH'])
def staff_detail(request, phone):
    require_superuser(request.user)
    if phone.startswith('user-'):
        return edit_unlisted(request, phone)
    serializer = StaffSerializer(data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    try:
        with transaction.atomic():
            lock_register(request.user)
            # Lock the card before the login, the same order as contact binding.
            card = get_object_or_404(AdminUser.objects.select_for_update(), pk=phone)
            linked = get_user_model().objects.select_for_update().filter(phone_number=card).first()
            if linked and linked.is_superuser:
                raise PermissionDenied('Суперпользователя нельзя изменить в разделе персонала.')
            new_phone = data.pop('phone_number', card.pk)
            if new_phone != card.pk:
                if any(number != card.pk for number in matching_staff_numbers(new_phone)):
                    raise ValidationError({'phone_number': 'Сотрудник с таким номером уже добавлен.'})
                old_card = card
                verified_telegram = card.telegram_id if linked else None
                old_card.telegram_id = None
                old_card.save(update_fields=['telegram_id'])
                # The phone is the card's primary key: create a replacement, move
                # the FK, then remove the old card without cascading the login.
                card = AdminUser.objects.create(phone_number=new_phone, first_name=old_card.first_name,
                    last_name=old_card.last_name, role=old_card.role, is_active=old_card.is_active,
                    telegram_id=verified_telegram)
                if linked:
                    linked.phone_number = card
                    linked.save(update_fields=['phone_number'])
                old_card.delete()
            for key, value in data.items():
                setattr(card, key, value)
            card.save()
            if linked:
                linked.first_name, linked.last_name = card.first_name, card.last_name
                linked.is_staff, linked.is_active = card.role == 'manager', card.is_active
                linked.save(update_fields=['first_name', 'last_name', 'is_staff', 'is_active'])
                if not linked.is_active:
                    Token.objects.filter(user=linked).delete()
            # Reverse OneToOne caches can otherwise retain the old card lookup.
            card._state.fields_cache.pop('user', None)
    except IntegrityError:
        raise ValidationError({'phone_number': 'Сотрудник с таким номером уже добавлен.'})
    return Response(staff_data(card))
