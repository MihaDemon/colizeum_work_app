from django.db import models

from computers.constraints import (
    MODEL_MAX_LENGTH, SN_MAX_LENGTH
)


class DeviceBaseModel(models.Model):
    model = models.CharField(
        verbose_name='Модель',
        unique=True,
        blank=False,
        max_length=MODEL_MAX_LENGTH
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

    class Meta:
        ordering = ('serial_number',)

    def __str__(self):
        return f'{self.model} | ({self.serial_number})'
