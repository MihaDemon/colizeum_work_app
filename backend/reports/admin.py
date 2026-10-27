from decimal import Decimal

from django import forms
from django.contrib import admin, messages
from django.db import models, router, transaction
from django.db.models import Count, ExpressionWrapper, F, Sum
from django.urls import reverse
from django.utils.formats import date_format
from django.utils.html import format_html
from django.utils.timezone import localtime
from django.utils import timezone
from django.http import HttpResponseRedirect

from reports.models import CashRegister, ExpensePhoto, Expenses, Report, ReportPhoto
from reports.exceptions import InsufficientCash
from reports.forms import FinancialRecordForm


def money(value):
    return f'{value or Decimal("0"):,.2f}'.replace(',', '\u00a0').replace('.', ',')


class AdministratorFilter(admin.RelatedOnlyFieldListFilter):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.title = 'Администратор'


class PhotoInline(admin.StackedInline):
    template = 'admin/reports/photo_inline.html'
    extra = 0
    min_num = 0

    def get_formset(self, request, obj=None, **kwargs):
        kwargs['validate_min'] = True
        return super().get_formset(request, obj, **kwargs)


class ReportPhotoInline(PhotoInline):
    model = ReportPhoto
    min_num = 1


class ExpensePhotoInline(PhotoInline):
    model = ExpensePhoto
    extra = 1


class ReportsAdminBase(admin.ModelAdmin):
    form = FinancialRecordForm
    change_list_template = 'admin/reports/change_list.html'
    change_form_template = 'admin/reports/change_form.html'
    list_per_page = 25
    ordering = ('-date', '-pk')
    date_hierarchy = 'date'
    search_fields = ('admin__username', 'info')
    search_help_text = 'Поиск по администратору или комментарию'
    list_select_related = ('admin',)
    readonly_fields = ()
    formfield_overrides = {
        models.DecimalField: {
            'widget': forms.NumberInput(attrs={'step': '0.01', 'inputmode': 'decimal'}),
        },
        models.TextField: {'widget': forms.Textarea(attrs={'rows': 4})},
    }

    class Media:
        js = ('reports/admin.js',)

    def changeform_view(self, request, object_id=None, form_url='', extra_context=None):
        if request.method != 'POST':
            return super().changeform_view(request, object_id, form_url, extra_context)
        using = router.db_for_write(self.model)
        # Keep the form's balance validation and save in the same locked
        # transaction, so another administrator cannot spend between them.
        with transaction.atomic(using=using):
            CashRegister.get_default(using=using)
            CashRegister.objects.using(using).select_for_update().get(pk=1)
            return super().changeform_view(request, object_id, form_url, extra_context)

    def delete_view(self, request, object_id, extra_context=None):
        try:
            return super().delete_view(request, object_id, extra_context)
        except InsufficientCash as error:
            self.message_user(request, ' '.join(error.messages), messages.ERROR)
            return HttpResponseRedirect(reverse(
                f'{self.admin_site.name}:reports_{self.model._meta.model_name}_change', args=[object_id],
            ))

    def response_action(self, request, queryset, action_location=None):
        try:
            with transaction.atomic(using=queryset.db):
                # Django 6.1 passes the action's location as a keyword.
                kwargs = {'action_location': action_location} if action_location is not None else {}
                return super().response_action(request, queryset, **kwargs)
        except InsufficientCash as error:
            self.message_user(request, ' '.join(error.messages), messages.ERROR)
            return HttpResponseRedirect(request.get_full_path())

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(_photo_count=Count('photos'))

    def get_fieldsets(self, request, obj=None):
        fieldsets = super().get_fieldsets(request, obj)
        if obj is not None or self.model is Report:
            return fieldsets
        return tuple(
            (title, {**options, 'fields': tuple(field for field in options['fields'] if field != 'date')})
            for title, options in fieldsets
        )

    def formfield_for_foreignkey(self, db_field, request, **kwargs):
        if db_field.name == 'admin':
            kwargs.update(label='Администратор', empty_label='Не указан')
        return super().formfield_for_foreignkey(db_field, request, **kwargs)

    @admin.display(description='Дата', ordering='date')
    def recorded_at(self, obj):
        if self.model is Report:
            return format_html('<span class="reports-date">{}</span>', date_format(obj.date, 'd E Y'))
        return format_html(
            '<span class="reports-date">{}</span><span class="reports-time">{}</span>',
            date_format(localtime(obj.date), 'd E Y'),
            date_format(localtime(obj.date), 'H:i'),
        )

    @admin.display(description='Администратор', ordering='admin__username')
    def administrator(self, obj):
        if obj.admin:
            return obj.admin.get_username()
        return obj.user_snapshots.get('admin', {}).get('name', 'Не указан')

    @admin.display(description='Фото', ordering='_photo_count')
    def photo_count(self, obj):
        return format_html('<span class="reports-photo-count">{}</span>', obj._photo_count)

    def surface_context(self, request):
        navigation = []
        for model, label in ((Report, 'Отчёты'), (Expenses, 'Расходы'), (CashRegister, 'Касса')):
            model_admin = self.admin_site.get_model_admin(model)
            if model_admin.has_view_or_change_permission(request):
                navigation.append({
                    'label': label,
                    'url': reverse(f'{self.admin_site.name}:reports_{model._meta.model_name}_changelist'),
                    'active': self.model is model,
                })
        balance = CashRegister.objects.filter(pk=1).values_list('balance', flat=True).first() or Decimal('0.00')
        return {
            'reports_navigation': navigation,
            'is_report': self.model is Report,
            'cash_register_balance': money(balance),
            'cash_register_balance_raw': balance,
        }

    def render_change_form(self, request, context, *args, **kwargs):
        context.update(self.surface_context(request))
        obj = context.get('original')
        label = 'Отчёт' if self.model is Report else 'Расход'
        context['reports_form_title'] = f'{label} №{obj.pk}' if obj else ('Новый отчёт' if self.model is Report else 'Новый расход')
        if self.model is Report:
            context['receipt_total'] = money(obj.cards + obj.spb + obj.cash if obj else 0)
            context['cash_effect'] = money(obj.cash if obj else 0)
        elif obj:
            context['expense_total'] = money(obj.amount)
            context['cash_effect'] = money(-obj.amount if obj.from_register else 0)
        # ModelForms mutate `original` even when an inline fails validation. The
        # preview must reverse the stored contribution, never that unsaved draft.
        previous = self.model.objects.filter(pk=obj.pk).first() if obj else None
        original_effect = Decimal('0.00')
        if previous:
            if self.model is Report:
                original_effect = previous.cash
            elif previous.from_register:
                original_effect = -previous.amount
        context['original_cash_effect'] = original_effect
        return super().render_change_form(request, context, *args, **kwargs)

    def changelist_view(self, request, extra_context=None):
        response = super().changelist_view(request, extra_context)
        if hasattr(response, 'context_data') and 'cl' in response.context_data:
            response.context_data.update(self.surface_context(request))
            queryset = response.context_data['cl'].queryset
            fields = ('cards', 'spb', 'cash') if self.model is Report else ('amount',)
            totals = queryset.aggregate(**{field: Sum(field) for field in fields})
            if self.model is Report:
                response.context_data['selection_totals'] = [
                    {'label': 'Поступления', 'value': money(sum((totals[field] or 0 for field in ('cards', 'spb', 'cash')))), 'primary': True},
                    {'label': 'Безнал', 'value': money(totals['cards'])},
                    {'label': 'СБП', 'value': money(totals['spb'])},
                    {'label': 'Наличные', 'value': money(totals['cash'])},
                ]
            else:
                register_total = queryset.filter(from_register=True).aggregate(amount=Sum('amount'))['amount'] or 0
                response.context_data['selection_totals'] = [
                    {'label': 'Сумма расходов', 'value': money(totals['amount']), 'primary': True},
                    {'label': 'Из кассы', 'value': money(register_total)},
                    {'label': 'Другие средства', 'value': money((totals['amount'] or 0) - register_total)},
                ]
        return response


@admin.register(Report)
class ReportAdmin(ReportsAdminBase):
    inlines = (ReportPhotoInline,)
    list_display = ('recorded_at', 'shift_badge', 'administrator', 'receipts', 'card_amount', 'sbp_amount', 'cash_amount', 'photo_count')
    list_display_links = ('recorded_at',)
    list_filter = ('shift', ('admin', AdministratorFilter), 'date')
    radio_fields = {'shift': admin.HORIZONTAL}
    fieldsets = (
        ('Смена и администратор', {'fields': (('shift', 'admin'), 'date'), 'classes': ('reports-meta',)}),
        ('Поступления за смену', {'fields': (('cards', 'spb', 'cash'),), 'classes': ('reports-payments',)}),
        ('Комментарий к смене', {'fields': ('info',), 'classes': ('reports-note',)}),
    )

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(
            _receipts=ExpressionWrapper(
                F('cards') + F('spb') + F('cash'),
                output_field=models.DecimalField(max_digits=22, decimal_places=2),
            ),
        )

    def get_changeform_initial_data(self, request):
        return {'date': timezone.localdate(), 'admin': request.user.pk, **super().get_changeform_initial_data(request)}

    @admin.display(description='Смена', ordering='shift')
    def shift_badge(self, obj):
        return format_html('<span class="reports-shift reports-shift-{}">{}</span>', obj.shift, obj.get_shift_display())

    @admin.display(description='Поступления', ordering='_receipts')
    def receipts(self, obj):
        return format_html('<span class="reports-money reports-money-strong">{}</span>', money(obj._receipts))

    @admin.display(description='Безнал', ordering='cards')
    def card_amount(self, obj):
        return money(obj.cards)

    @admin.display(description='СБП', ordering='spb')
    def sbp_amount(self, obj):
        return money(obj.spb)

    @admin.display(description='Наличные', ordering='cash')
    def cash_amount(self, obj):
        return money(obj.cash)


@admin.register(Expenses)
class ExpensesAdmin(ReportsAdminBase):
    inlines = (ExpensePhotoInline,)
    readonly_fields = ('date',)
    list_display = ('recorded_at', 'administrator', 'expense_amount', 'from_register', 'comment', 'photo_count')
    list_display_links = ('recorded_at',)
    list_filter = ('from_register', ('admin', AdministratorFilter), 'date')
    fieldsets = (
        ('Детали расхода', {'fields': (('admin', 'amount'), 'from_register', 'date'), 'classes': ('reports-meta',)}),
        ('Комментарий к расходу', {'fields': ('info',), 'classes': ('reports-note',)}),
    )

    @admin.display(description='Сумма, ₽', ordering='amount')
    def expense_amount(self, obj):
        return format_html('<span class="reports-money reports-money-strong">{}</span>', money(obj.amount))

    @admin.display(description='Комментарий')
    def comment(self, obj):
        text = obj.info or '—'
        return text if len(text) <= 90 else f'{text[:87]}…'


class CashRegisterForm(forms.ModelForm):
    class Meta:
        model = CashRegister
        fields = ('balance',)

    def clean(self):
        cleaned = super().clean()
        if self.instance._state.adding and CashRegister.objects.filter(pk=1).exists():
            raise forms.ValidationError('Касса уже существует. Измените остаток в существующей кассе.')
        return cleaned


@admin.register(CashRegister)
class CashRegisterAdmin(admin.ModelAdmin):
    form = CashRegisterForm
    list_display = ('__str__', 'balance')
    fields = ('balance',)

    def get_readonly_fields(self, request, obj=None):
        return () if request.user.is_superuser else ('balance',)

    def has_add_permission(self, request):
        return request.user.is_superuser

    def has_change_permission(self, request, obj=None):
        return request.user.is_superuser

    def has_delete_permission(self, request, obj=None):
        return request.user.is_superuser
