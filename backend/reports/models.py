from api.fields import EvidenceImageField
from decimal import Decimal

from django.db import models, router, transaction
from django.contrib.auth import get_user_model
from django.core.validators import MinValueValidator

from reports.exceptions import InsufficientCash

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
    date = models.DateField(
        verbose_name='Дата',
        blank=False,
        null=False
    )
    admin = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        verbose_name='Администратор',
    )
    cards = models.DecimalField(
        verbose_name='Безнал',
        max_digits=20,
        decimal_places=2,
        blank=False,
        default=Decimal('0.00'),
        validators=[MinValueValidator(Decimal('0.00'))],
    )
    spb = models.DecimalField(
        verbose_name='СБП',
        max_digits=20,
        decimal_places=2,
        blank=False,
        default=Decimal('0.00'),
        validators=[MinValueValidator(Decimal('0.00'))],
    )
    cash = models.DecimalField(
        verbose_name='Наличные',
        max_digits=20,
        decimal_places=2,
        blank=False,
        default=Decimal('0.00'),
        validators=[MinValueValidator(Decimal('0.00'))],
    )
    info = models.TextField(
        verbose_name='Информация',
        blank=True,
        null=True
    )

    class Meta:
        verbose_name = 'Отчёт'
        verbose_name_plural = 'Отчёты'
        constraints = [models.CheckConstraint(
            condition=models.Q(cards__gte=0, spb__gte=0, cash__gte=0),
            name='nonnegative_report_amounts',
        )]

    def save(self, *args, **kwargs):
        using = kwargs.get('using') or router.db_for_write(type(self), instance=self)
        with transaction.atomic(using=using):
            CashRegister.get_default(using=using)

            register = CashRegister.objects.using(using).select_for_update().get(pk=1)

            previous = Report.objects.using(using).filter(pk=self.pk).first()

            super().save(*args, **kwargs)

            saved = Report.objects.using(using).filter(pk=self.pk).first()
            if saved is None:
                return

            register.apply_change(saved.cash - (previous.cash if previous else 0), using=using)


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
        null=True,
        verbose_name='Администратор',
    )
    amount = models.DecimalField(
        verbose_name='Сумма',
        max_digits=20,
        decimal_places=2,
        blank=False,
        default=Decimal('0.00'),
        validators=[MinValueValidator(Decimal('0.00'))],
    )
    from_register = models.BooleanField(
        verbose_name='Из кассы',
        default=True
    )
    info = models.TextField(
        verbose_name='Информация',
        blank=False,
        null=False
    )

    class Meta:
        verbose_name = 'Расход'
        verbose_name_plural = 'Расходы'
        constraints = [models.CheckConstraint(
            condition=models.Q(amount__gte=0), name='nonnegative_expense_amount',
        )]

    def save(self, *args, **kwargs):
        using = kwargs.get('using') or router.db_for_write(type(self), instance=self)
        with transaction.atomic(using=using):
            CashRegister.get_default(using=using)

            register = CashRegister.objects.using(using).select_for_update().get(pk=1)

            previous = Expenses.objects.using(using).filter(pk=self.pk).first()

            super().save(*args, **kwargs)

            saved = Expenses.objects.using(using).filter(pk=self.pk).first()
            if saved is None:
                return

            previous_effect = -previous.amount if previous and previous.from_register else 0
            saved_effect = -saved.amount if saved.from_register else 0
            register.apply_change(saved_effect - previous_effect, using=using)


class ReportPhoto(models.Model):
    label = models.CharField(max_length=100, blank=True, verbose_name='Название фотографии')
    report = models.ForeignKey(
        Report,
        on_delete=models.CASCADE,
        related_name='photos',
        verbose_name='Отчёт'
    )
    image = EvidenceImageField(
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
    image = EvidenceImageField(
        verbose_name='Фотография',
        upload_to='expenses/%Y/%m/%d/'
    )

    class Meta:
        verbose_name = 'Фотография расхода'
        verbose_name_plural = 'Фотографии расхода'


class CashRegister(models.Model):
    id = models.PositiveSmallIntegerField(
        primary_key=True,
        default=1,
        editable=False,
    )
    balance = models.DecimalField(
        verbose_name='Остаток наличных',
        max_digits=20,
        decimal_places=2,
        blank=False,
        default=Decimal('0.00'),
        validators=[MinValueValidator(Decimal('0.00'))],
    )

    class Meta:
        verbose_name = 'Касса'
        verbose_name_plural = 'Кассы'
        constraints = (
            models.CheckConstraint(
                condition=models.Q(id=1),
                name="single_cash_register",
            ),
            models.CheckConstraint(
                condition=models.Q(balance__gte=0), name='nonnegative_cash_balance',
            ),
        )

    @classmethod
    def get_default(cls, using=None):
        cash_register, _ = cls.objects.using(using).get_or_create(id=1)

        return cash_register

    def apply_change(self, amount, *, using):
        # Check and update in the same SQL statement, including on databases
        # where select_for_update() does not lock rows (SQLite).
        updated = type(self).objects.using(using).filter(
            pk=self.pk, balance__gte=-amount,
        ).update(balance=models.F('balance') + amount)
        if not updated:
            self.refresh_from_db(using=using, fields=['balance'])
            raise InsufficientCash(self.balance)
        self.refresh_from_db(using=using, fields=['balance'])

    def __str__(self):
        return 'Касса клуба'
