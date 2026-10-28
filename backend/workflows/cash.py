"""Superuser corrections to the register, serialized with all shift cash changes."""
from decimal import Decimal

from django.db import transaction
from django.utils.formats import number_format
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import BasePermission
from rest_framework.response import Response

from .commands import idempotent_command
from .services import Conflict, event, lock_register


class SuperuserOnly(BasePermission):
    message = 'Изменять остаток кассы может только суперпользователь.'

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_superuser)


class CashAdjustmentSerializer(serializers.Serializer):
    balance = serializers.DecimalField(max_digits=20, decimal_places=2, min_value=Decimal('0.00'))
    expected_balance = serializers.DecimalField(max_digits=20, decimal_places=2, min_value=Decimal('0.00'))


@api_view(['POST'])
@permission_classes([SuperuserOnly])
@idempotent_command
@transaction.atomic
def adjust(request):
    serializer = CashAdjustmentSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    register = lock_register(request.user)
    if register.balance != data['expected_balance']:
        raise Conflict('Остаток кассы изменился. Обновите данные и повторите исправление.')
    previous = register.balance
    register.balance = data['balance']
    register.save(update_fields=['balance'])
    if previous != register.balance:
        old = number_format(previous, decimal_pos=2, force_grouping=True)
        new = number_format(register.balance, decimal_pos=2, force_grouping=True)
        event(request.user, 'Остаток кассы изменён', f'{old} ₽ → {new} ₽', kind='cash')
    return Response({'balance': format(register.balance, '.2f')})
