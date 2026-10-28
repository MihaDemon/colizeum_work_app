from django.http import FileResponse, Http404
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.response import Response

from . import schedules
from .commands import idempotent_command
from .models import SchedulePeriod


class Slot(serializers.Serializer):
    date = serializers.DateField()
    type = serializers.ChoiceField(choices=['day', 'night'])
    admin_id = serializers.IntegerField(min_value=1, allow_null=True)


class Version(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)


class Save(Version):
    slots = Slot(many=True, max_length=32)
    source = serializers.ChoiceField(choices=['manual', 'automatic'], default='manual')
    admins = serializers.ListField(child=serializers.IntegerField(min_value=1), max_length=4, default=list)


class Generate(Version):
    admins = serializers.ListField(child=serializers.IntegerField(min_value=1), max_length=4)


class Restore(Version):
    revision = serializers.IntegerField(min_value=1)


class Settings(Version):
    default_admin = serializers.IntegerField(min_value=1, allow_null=True)


def validated(cls, request):
    serializer = cls(data=request.data)
    serializer.is_valid(raise_exception=True)
    return serializer.validated_data


@api_view(['GET'])
def overview(request):
    return Response(schedules.overview(request.user))


@api_view(['GET', 'POST'])
@idempotent_command
def period(request, pk):
    period = get_object_or_404(SchedulePeriod, pk=pk)
    if request.method == 'POST':
        return Response(schedules.save_plan(request.user, period, validated(Save, request)))
    revision = None
    if 'revision' in request.query_params:
        number = serializers.IntegerField(min_value=1).run_validation(request.query_params['revision'])
        revision = get_object_or_404(period.revisions, number=number)
    return Response(schedules.period_data(period, request.user, revision))


@api_view(['POST'])
@idempotent_command
def generate(request, pk):
    return Response(schedules.generate(request.user, get_object_or_404(SchedulePeriod, pk=pk), validated(Generate, request)))


@api_view(['POST'])
@idempotent_command
def restore(request, pk):
    return Response(schedules.restore(request.user, get_object_or_404(SchedulePeriod, pk=pk), validated(Restore, request)))


@api_view(['POST'])
@idempotent_command
def settings(request):
    return Response(schedules.configure(request.user, validated(Settings, request)))


@api_view(['GET'])
def image(request, pk):
    period = get_object_or_404(SchedulePeriod, pk=pk)
    if not period.summary_image:
        raise Http404
    try:
        response = FileResponse(period.summary_image.open('rb'), content_type='image/png')
    except FileNotFoundError:
        raise Http404
    response['Cache-Control'] = 'private, no-store'
    response['X-Content-Type-Options'] = 'nosniff'
    return response
