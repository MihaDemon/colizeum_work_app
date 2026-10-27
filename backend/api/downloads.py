"""Short-lived QR-only links for Telegram's native file downloader."""
from urllib.parse import urljoin

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import signing
from django.http import Http404
from django.shortcuts import get_object_or_404
from django.urls import reverse
from rest_framework.decorators import api_view, authentication_classes, permission_classes
from rest_framework.permissions import AllowAny

from computers.models import Headset, Keyboard, Monitor, Mouse, PC, PlayStation, Station
from .qr import qr_png_response

QR_DOWNLOAD_MAX_AGE = 300
QR_DOWNLOAD_SALT = 'colizeum.device-qr-download'
DEVICE_MODELS = {
    model._meta.model_name: model
    for model in (Station, PC, Mouse, Keyboard, Headset, Monitor, PlayStation)
}


def qr_download_link(device, user, request):
    ticket = signing.dumps(
        {'kind': device._meta.model_name, 'pk': device.pk, 'user': user.pk},
        salt=QR_DOWNLOAD_SALT,
    )
    path = reverse('device-qr-download', kwargs={'ticket': ticket})
    url = (
        urljoin(settings.WEBAPP_URL.rstrip('/') + '/', path)
        if settings.WEBAPP_URL else request.build_absolute_uri(path)
    )
    return {'url': url, 'file_name': f'{device._meta.model_name}-{device.pk}-qr.png'}


@api_view(['GET', 'HEAD'])
@authentication_classes([])
@permission_classes([AllowAny])
def download_device_qr(request, ticket):
    # Download clients cannot attach the Mini App's Authorization header.
    # This signed capability grants access only to one QR PNG for five minutes.
    try:
        data = signing.loads(ticket, salt=QR_DOWNLOAD_SALT, max_age=QR_DOWNLOAD_MAX_AGE)
        model = DEVICE_MODELS[data['kind']]
        user_id, pk = data['user'], data['pk']
    except (signing.BadSignature, KeyError, TypeError, ValueError):
        raise Http404('Ссылка для скачивания недействительна или срок её действия истёк.')
    if not get_user_model().objects.filter(pk=user_id, is_active=True).exists():
        raise Http404('Ссылка для скачивания недоступна.')
    device = get_object_or_404(model, pk=pk)
    return qr_png_response(device, request, attachment=True)
