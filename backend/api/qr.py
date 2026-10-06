"""Identifier-based URLs shared by device serializers and QR endpoints."""

from urllib.parse import urlencode

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
