from django.db import models
from django.contrib.auth.models import AbstractUser

from users.constraints import (
    MAX_USERNAME_LENGTH, MAX_TELEGRAM_ID_LENGTH
)


class User(AbstractUser):
    username = models.CharField(
        verbose_name='Логин',
        unique=True,
        blank=False,
        max_length=MAX_USERNAME_LENGTH
    )
    email = models.EmailField(
        verbose_name='Почта',
        unique=True
    )
    telegram_id = models.CharField(
        verbose_name='Телеграм ID',
        unique=True,
        blank=True,
        max_length=MAX_TELEGRAM_ID_LENGTH
    )

    class Meta:
        ordering = ('username',)
        verbose_name = 'Пользователь'
        verbose_name_plural = 'Пользователи'

    def __str__(self) -> str:
        return self.username
