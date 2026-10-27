"""Identifier-based URLs shared by device serializers and QR endpoints."""

from urllib.parse import urlencode
from io import BytesIO

from django.http import HttpResponse

from rest_framework.reverse import reverse


def get_device_detail_url(device, request=None):
    lookup_field = 'club_number' if device._meta.model_name == 'station' else 'serial_number'
    url = reverse(f'{device._meta.model_name}-lookup', request=request)
    return f'{url}?{urlencode({lookup_field: getattr(device, lookup_field)})}'


def get_device_qr_url(device, request=None):
    return reverse(
        f'{device._meta.model_name}-qr-code',
        kwargs={'pk': device.pk},
        request=request,
    )


def qr_png_response(device, request, *, attachment=False):
    import segno

    buffer = BytesIO()
    segno.make_qr(get_device_detail_url(device, request)).save(
        buffer, kind='png', scale=8, border=4, dark='black', light='white',
    )
    response = HttpResponse(buffer.getvalue(), content_type='image/png')
    disposition = 'attachment' if attachment else 'inline'
    response['Content-Disposition'] = f'{disposition}; filename="{device._meta.model_name}-{device.pk}-qr.png"'
    response['Cache-Control'] = 'private, no-store'
    if attachment:
        response['Access-Control-Allow-Origin'] = 'https://web.telegram.org'
    return response
