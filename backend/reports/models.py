from django.db import models
from django.contrib.auth import get_user_model

User = get_user_model()


class Report(models.Model):
    class Shift(models.TextChoices):
        DAY = 'day', 'День'
        NIGHT = 'night', 'Ночь'

    shift = models.CharField(
        verbose_name='Смена',
        max_length=5,
        choices=Shift.choices,
        blank=False,
        default=Shift.DAY
    )
    date = models.DateTimeField(
        verbose_name='Дата',
        auto_now_add=True,
        blank=False,
        null=False
    )
    admin = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        blank=True,
        null=True
    )
    cards = models.DecimalField(
        verbose_name='Безнал',
        max_digits=20,
        decimal_places=2,
        blank=False,
        default=0
    )
    spb = models.DecimalField(
        verbose_name='СБП',
        max_digits=20,
        decimal_places=2,
        blank=False,
        default=0
    )
    cash = models.DecimalField(
        verbose_name='Наличные',
        max_digits=20,
        decimal_places=2,
        blank=False,
        default=0
    )
    remaining_cash = models.DecimalField(
        verbose_name='Остаток наличных',
        max_digits=20,
        decimal_places=2,
        blank=False,
        default=0
    )
    encashment = models.DecimalField(
        verbose_name='Инкассация',
        max_digits=20,
        decimal_places=2,
        blank=False,
        default=0
    )
    info = models.TextField(
        verbose_name='Информация',
        blank=True,
        null=True
    )

    class Meta:
        verbose_name = 'Отчёт'
        verbose_name_plural = 'Отчёты'


class Expenses(models.Model):
    date = models.DateTimeField(
        verbose_name='Дата',
        auto_now_add=True,
        blank=False,
        null=False
    )
    admin = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        blank=True,
        null=True
    )
    amount = models.DecimalField(
        verbose_name='Сумма',
        max_digits=20,
        decimal_places=2,
        blank=False,
        default=0
    )
    info = models.TextField(
        verbose_name='Информация',
        blank=True,
        null=True
    )

    class Meta:
        verbose_name = 'Расход'
        verbose_name_plural = 'Расходы'


class ReportPhoto(models.Model):
    report = models.ForeignKey(
        Report,
        on_delete=models.CASCADE,
        related_name='photos',
        verbose_name='Отчёт'
    )
    image = models.ImageField(
        verbose_name='Фотография',
        upload_to='reports/%Y/%m/%d/'
    )

    class Meta:
        verbose_name = 'Фотография отчёта'
        verbose_name_plural = 'Фотографии отчёта'


class ExpensePhoto(models.Model):
    expense = models.ForeignKey(
        Expenses,
        on_delete=models.CASCADE,
        related_name='photos',
        verbose_name='Расход'
    )
    image = models.ImageField(
        verbose_name='Фотография',
        upload_to='expenses/%Y/%m/%d/'
    )

    class Meta:
        verbose_name = 'Фотография расхода'
        verbose_name_plural = 'Фотографии расхода'
