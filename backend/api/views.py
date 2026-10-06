import json
from urllib.parse import parse_qsl

from django.conf import settings
from django.contrib.auth import get_user_model
from django.utils import timezone

from rest_framework import viewsets, status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import action
from rest_framework.response import Response

from api.utils import validate_telegram_data
from users.models import AdminUser

User = get_user_model()


class AuthViewSet(viewsets.ViewSet):
    @action(detail=False, methods=['post'], url_path='telegram')
    def telegram(self, request):
        """
        Handle Telegram authentication.
        """
        init_data = request.data.get('initData')
        bot_token = settings.TELEGRAM_BOT_TOKEN

        if not init_data:
            return Response(
                {'error': 'Данные Telegram не предоставлены'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if not validate_telegram_data(init_data, bot_token):
            return Response(
                {'error': 'Неверные данные Telegram'},
                status=status.HTTP_403_FORBIDDEN
            )

        parsed_data = dict(parse_qsl(init_data))
        user_data = json.loads(parsed_data.get('user', '{}'))
        telegram_id = str(user_data.get('id'))

        if not telegram_id:
            return Response(
                {'error': 'Нет Telegram ID в данных'},
                status=status.HTTP_400_BAD_REQUEST
            )

        user = User.objects.filter(telegram_id=telegram_id).first()

        if user:
            user.last_login = timezone.now()

            user.save(update_fields=['last_login'])

            token, _ = Token.objects.get_or_create(user=user)

            return Response(
                {'token': token.key, 'is_new_user': False},
                status=status.HTTP_200_OK
            )

        phone_number = request.data.get('phone_number')
        username = request.data.get('username')

        if not phone_number or not username:
            return Response(
                {'require_registration': 'True'},
                status=status.HTTP_404_NOT_FOUND
            )

        try:
            admin_user = AdminUser.objects.get(phone_number=phone_number)

        except AdminUser.DoesNotExist:
            return Response(
                {'error': 'Данного телефона нет в базе администраторов'},
                status=status.HTTP_404_NOT_FOUND
            )

        if User.objects.filter(phone_number=admin_user).exists():
            return Response(
                {'error': 'Этот номер телефона уже зарегистрирован'},
                status=status.HTTP_400_BAD_REQUEST
            )

        if User.objects.filter(username=username).exists():
            return Response(
                {'error': 'Этот логин уже занят'},
                status=status.HTTP_400_BAD_REQUEST
            )

        user = User.objects.create(
            username=username,
            phone_number=admin_user,
            telegram_id=telegram_id,
            last_login=timezone.now()
        )

        user.set_unusable_password()
        user.save()

        token, _ = Token.objects.get_or_create(user=user)

        return Response(
            {'token': token.key, 'is_new_user': True},
            status=status.HTTP_201_CREATED
        )
