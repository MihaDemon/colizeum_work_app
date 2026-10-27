from django.db import models
from django.contrib.auth.models import AbstractUser

from users.constraints import (
    MAX_PHONE_NUMBER_LENGTH,
    MAX_USERNAME_LENGTH,
    MAX_TELEGRAM_ID_LENGTH,
    MAX_FIRST_NAME_LENGTH,
    MAX_LAST_NAME_LENGTH
)


class AdminUser(models.Model):
    role = models.CharField(max_length=7, choices=[('admin', 'Administrator'), ('manager', 'Manager')], default='admin')
    telegram_id = models.CharField(max_length=255, unique=True, null=True, blank=True)

    phone_number = models.CharField(
        verbose_name='Номер телефона',
        unique=True,
        blank=True,
        max_length=MAX_PHONE_NUMBER_LENGTH,
        primary_key=True
    )
    first_name = models.CharField(
        verbose_name='Имя',
        blank=True,
        max_length=MAX_FIRST_NAME_LENGTH
    )
    last_name = models.CharField(
        verbose_name='Фамилия',
        blank=True,
        max_length=MAX_LAST_NAME_LENGTH
    )

    class Meta:
        verbose_name = 'Администратор'
        verbose_name_plural = 'Администраторы'
        ordering = ('first_name', 'last_name')

    def __str__(self) -> str:
        return f'{self.first_name} {self.last_name}'


class User(AbstractUser):
    username = models.CharField(
        verbose_name='Логин',
        unique=True,
        blank=False,
        max_length=MAX_USERNAME_LENGTH
    )
    phone_number = models.OneToOneField(
        'AdminUser',
        on_delete=models.CASCADE,
        blank=True,
        null=True,
        verbose_name='Номер телефона',
        related_name='user'
    )
    email = models.EmailField(
        verbose_name='Почта',
        null=True, default=None,
        unique=True,
        blank=True
    )
    telegram_id = models.CharField(
        verbose_name='Телеграм ID',
        null=True, default=None,
        unique=True,
        blank=True,
        max_length=MAX_TELEGRAM_ID_LENGTH
    )

    def save(self, *args, **kwargs):
        # UserManager normalizes omitted email to an empty string. Store absence
        # as NULL so independent Telegram-only accounts do not collide.
        self.email = self.email or None
        self.telegram_id = self.telegram_id or None
        super().save(*args, **kwargs)

    class Meta:
        ordering = ('username',)
        verbose_name = 'Пользователь'
        verbose_name_plural = 'Пользователи'

    def __str__(self) -> str:
        return self.username
