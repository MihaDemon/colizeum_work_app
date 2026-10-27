import hashlib
import json
import uuid
from functools import wraps
from django.db import transaction
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from .models import CommandReceipt
from .services import Conflict, lock_register


def idempotent_command(handler):
    @wraps(handler)
    def wrapped(*args, **kwargs):
        request = next(arg for arg in args if hasattr(arg, 'data') and hasattr(arg, 'user'))
        value = request.headers.get('Idempotency-Key')
        if not value:
            return handler(*args, **kwargs)
        try:
            key = uuid.UUID(value)
        except (ValueError, AttributeError):
            raise ValidationError({'detail': 'Idempotency-Key must be a UUID.'})
        digest = hashlib.sha256(request.path.encode())
        for name in sorted(request.data):
            digest.update(name.encode())
            values = request.data.getlist(name) if hasattr(request.data, 'getlist') else [request.data[name]]
            if len(values) > 1:
                digest.update(f'[{len(values)}]'.encode())
            for value in values:
                if hasattr(value, 'chunks'):
                    if len(values) > 1:
                        digest.update(f'{value.size}:'.encode())
                    for chunk in value.chunks():
                        digest.update(chunk)
                    value.seek(0)
                else:
                    digest.update(json.dumps(value, sort_keys=True).encode())
        fingerprint = digest.hexdigest()
        with transaction.atomic():
            lock_register()
            receipt = CommandReceipt.objects.filter(user=request.user, key=key).first()
            if receipt:
                if receipt.fingerprint != fingerprint:
                    raise Conflict('This retry key was already used for a different command.')
                return Response(receipt.response, status=receipt.status_code)
            response = handler(*args, **kwargs)
            if response.status_code < 400:
                CommandReceipt.objects.create(user=request.user, key=key, fingerprint=fingerprint,
                                              response=response.data, status_code=response.status_code)
            return response
    return wrapped
