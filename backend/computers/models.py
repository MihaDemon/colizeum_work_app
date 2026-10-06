from django.db import models

from computers.mixins import DeviceBaseModelMixin
from computers.constraints import (
    SN_MAX_LENGTH, COMPONENT_MAX_LENGTH
)


class Mouse(DeviceBaseModelMixin):
    class Meta:
        verbose_name = 'Мышка'
        verbose_name_plural = 'Мышки'


class Keyboard(DeviceBaseModelMixin):
    class Meta:
        verbose_name = 'Клавиатура'
        verbose_name_plural = 'Клавиатуры'


class Headset(DeviceBaseModelMixin):
    class Meta:
        verbose_name = 'Наушники'
        verbose_name_plural = 'Наушники'


class Monitor(DeviceBaseModelMixin):
    class Meta:
        verbose_name = 'Монитор'
        verbose_name_plural = 'Мониторы'


class PC(models.Model):
    serial_number = models.CharField(
        verbose_name='Серийный номер',
        unique=True,
        blank=False,
        max_length=SN_MAX_LENGTH
    )
    cpu = models.CharField(
        verbose_name='Процессор',
        blank=False,
        max_length=COMPONENT_MAX_LENGTH
    )
    gpu = models.CharField(
        verbose_name='Видеокарта',
        blank=False,
        max_length=COMPONENT_MAX_LENGTH
    )
    ram = models.CharField(
        verbose_name='Оперативная память',
        blank=False,
        max_length=COMPONENT_MAX_LENGTH
    )
    storage = models.CharField(
        verbose_name='Хранилище',
        blank=False,
        max_length=COMPONENT_MAX_LENGTH
    )
    warranty_until = models.DateTimeField(
        verbose_name='Гарантия до',
        blank=True,
        null=True
    )
    info = models.TextField(
        verbose_name='Информация',
        blank=True,
        null=True
    )

    class Meta:
        verbose_name = 'ПК'
        verbose_name_plural = 'ПК'
        ordering = ('serial_number',)

    def __str__(self):
        return f'{self.gpu} | {self.serial_number}'


class Station(models.Model):
    club_number = models.PositiveSmallIntegerField(
        verbose_name='Номер ПК',
        unique=True,
        blank=False,
    )
    mouse = models.ForeignKey(
        'Mouse',
        on_delete=models.SET_NULL,
        blank=True,
        null=True
    )
    keyboard = models.ForeignKey(
        'Keyboard',
        on_delete=models.SET_NULL,
        blank=True,
        null=True
    )
    headset = models.ForeignKey(
        'Headset',
        on_delete=models.SET_NULL,
        blank=True,
        null=True
    )
    monitor = models.ForeignKey(
        'Monitor',
        on_delete=models.SET_NULL,
        blank=True,
        null=True
    )
    pc = models.ForeignKey(
        'PC',
        on_delete=models.SET_NULL,
        blank=True,
        null=True
    )
    info = models.TextField(
        verbose_name='Информация',
        blank=True,
        null=True
    )

    class Meta:
        verbose_name = 'Игровое место'
        verbose_name_plural = 'Игровые места'
        ordering = ('-club_number',)

    def __str__(self):
        return f'ПК №{self.club_number}'


class PlayStation(models.Model):
    club_number = models.PositiveSmallIntegerField(
        verbose_name='Номер PlayStation',
        unique=True,
        blank=False,
    )
    serial_number = models.CharField(
        verbose_name='Серийный номер',
        unique=True,
        blank=False,
        max_length=SN_MAX_LENGTH
    )
    warranty_until = models.DateTimeField(
        verbose_name='Гарантия до',
        blank=True,
        null=True
    )
    info = models.TextField(
        verbose_name='Информация',
        blank=True,
        null=True
    )

    class Meta:
        verbose_name = 'PlayStation'
        verbose_name_plural = 'PlayStation'
        ordering = ('serial_number',)

    def __str__(self):
        return f'PlayStation | {self.serial_number}'
