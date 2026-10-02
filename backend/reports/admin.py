from decimal import Decimal

from django import forms
from django.contrib import admin
from django.db import models
from django.db.models import Count, ExpressionWrapper, F, Sum
from django.urls import reverse
from django.utils.formats import date_format
from django.utils.html import format_html
from django.utils.timezone import localtime

from reports.models import ExpensePhoto, Expenses, Report, ReportPhoto


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
    change_list_template = 'admin/reports/change_list.html'
    change_form_template = 'admin/reports/change_form.html'
    list_per_page = 25
    ordering = ('-date', '-pk')
    date_hierarchy = 'date'
    search_fields = ('admin__username', 'info')
    search_help_text = 'Поиск по администратору или комментарию'
    list_select_related = ('admin',)
    readonly_fields = ('date',)
    formfield_overrides = {
        models.DecimalField: {
            'widget': forms.NumberInput(attrs={'step': '0.01', 'inputmode': 'decimal'}),
        },
        models.TextField: {'widget': forms.Textarea(attrs={'rows': 4})},
    }

    class Media:
        js = ('reports/admin.js',)

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(_photo_count=Count('photos'))

    def get_fieldsets(self, request, obj=None):
        fieldsets = super().get_fieldsets(request, obj)
        if obj is not None:
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
        return format_html(
            '<span class="reports-date">{}</span><span class="reports-time">{}</span>',
            date_format(localtime(obj.date), 'd E Y'),
            date_format(localtime(obj.date), 'H:i'),
        )

    @admin.display(description='Администратор', ordering='admin__username')
    def administrator(self, obj):
        return obj.admin.get_username() if obj.admin else 'Не указан'

    @admin.display(description='Фото', ordering='_photo_count')
    def photo_count(self, obj):
        return format_html('<span class="reports-photo-count">{}</span>', obj._photo_count)

    def surface_context(self, request):
        navigation = []
        for model, label in ((Report, 'Отчёты'), (Expenses, 'Расходы')):
            model_admin = self.admin_site.get_model_admin(model)
            if model_admin.has_view_or_change_permission(request):
                navigation.append({
                    'label': label,
                    'url': reverse(f'{self.admin_site.name}:reports_{model._meta.model_name}_changelist'),
                    'active': self.model is model,
                })
        return {
            'reports_navigation': navigation,
            'is_report': self.model is Report,
        }

    def render_change_form(self, request, context, *args, **kwargs):
        context.update(self.surface_context(request))
        obj = context.get('original')
        label = 'Отчёт' if self.model is Report else 'Расход'
        context['reports_form_title'] = f'{label} №{obj.pk}' if obj else ('Новый отчёт' if self.model is Report else 'Новый расход')
        if self.model is Report:
            context['receipt_total'] = money(obj.cards + obj.spb + obj.cash if obj else 0)
        elif obj:
            context['expense_total'] = money(obj.amount)
        return super().render_change_form(request, context, *args, **kwargs)

    def changelist_view(self, request, extra_context=None):
        response = super().changelist_view(request, extra_context)
        if hasattr(response, 'context_data') and 'cl' in response.context_data:
            response.context_data.update(self.surface_context(request))
            queryset = response.context_data['cl'].queryset
            fields = ('cards', 'spb', 'cash', 'encashment') if self.model is Report else ('amount',)
            totals = queryset.aggregate(**{field: Sum(field) for field in fields})
            if self.model is Report:
                response.context_data['selection_totals'] = [
                    {'label': 'Поступления', 'value': money(sum((totals[field] or 0 for field in ('cards', 'spb', 'cash')))), 'primary': True},
                    {'label': 'Безнал', 'value': money(totals['cards'])},
                    {'label': 'СБП', 'value': money(totals['spb'])},
                    {'label': 'Наличные', 'value': money(totals['cash'])},
                    {'label': 'Инкассация', 'value': money(totals['encashment'])},
                ]
            else:
                response.context_data['selection_totals'] = [
                    {'label': 'Сумма расходов', 'value': money(totals['amount']), 'primary': True},
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
        ('Наличные в кассе', {'fields': (('remaining_cash', 'encashment'),), 'classes': ('reports-cash',)}),
        ('Комментарий к смене', {'fields': ('info',), 'classes': ('reports-note',)}),
    )

    def get_queryset(self, request):
        return super().get_queryset(request).annotate(
            _receipts=ExpressionWrapper(
                F('cards') + F('spb') + F('cash'),
                output_field=models.DecimalField(max_digits=22, decimal_places=2),
            ),
        )

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
    list_display = ('recorded_at', 'administrator', 'expense_amount', 'comment', 'photo_count')
    list_display_links = ('recorded_at',)
    list_filter = (('admin', AdministratorFilter), 'date')
    fieldsets = (
        ('Детали расхода', {'fields': (('admin', 'amount'), 'date'), 'classes': ('reports-meta',)}),
        ('Комментарий к расходу', {'fields': ('info',), 'classes': ('reports-note',)}),
    )

    @admin.display(description='Сумма, ₽', ordering='amount')
    def expense_amount(self, obj):
        return format_html('<span class="reports-money reports-money-strong">{}</span>', money(obj.amount))

    @admin.display(description='Комментарий')
    def comment(self, obj):
        text = obj.info or '—'
        return text if len(text) <= 90 else f'{text[:87]}…'
