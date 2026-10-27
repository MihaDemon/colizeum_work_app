from decimal import Decimal
from io import BytesIO
import tempfile

from PIL import Image
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError, transaction
from django.test import TestCase, override_settings
from django.utils import timezone

from reports.models import CashRegister, Expenses, Report
from reports.exceptions import InsufficientCash


def photo():
    image = BytesIO()
    Image.new('RGB', (2, 2)).save(image, format='PNG')
    return SimpleUploadedFile('receipt.png', image.getvalue(), content_type='image/png')


class CashAccountingTests(TestCase):
    def balance(self, expected):
        self.assertEqual(CashRegister.get_default().balance, Decimal(expected))

    def test_report_create_update_and_delete(self):
        report = Report.objects.create(date=timezone.localdate(), cash='100.35')
        self.balance('100.35')
        report.cash = Decimal('200.50')
        report.save()
        self.balance('200.50')
        report.save()
        self.balance('200.50')
        report.delete()
        self.balance('0.00')

    def test_expense_funding_source_changes(self):
        Report.objects.create(date=timezone.localdate(), cash='100.00')
        expense = Expenses.objects.create(amount='30.25', from_register=False)
        self.balance('100.00')
        expense.from_register = True
        expense.save()
        self.balance('69.75')
        expense.amount = Decimal('40.10')
        expense.save()
        self.balance('59.90')
        expense.from_register = False
        expense.save()
        self.balance('100.00')
        expense.delete()
        self.balance('100.00')

    def test_partial_saves_use_persisted_financial_values(self):
        report = Report.objects.create(date=timezone.localdate(), cash='100.00')
        report.cash = Decimal('999.00')
        report.info = 'Only save this comment'
        report.save(update_fields=['info'])
        self.balance('100.00')
        expense = Expenses.objects.create(amount='25.00')
        expense.amount = Decimal('500.00')
        expense.from_register = False
        expense.save(update_fields=['from_register'])
        self.balance('100.00')

    def test_queryset_deletion_reverses_all_records(self):
        Report.objects.create(date=timezone.localdate(), cash='100.00')
        Report.objects.create(date=timezone.localdate(), cash='20.00')
        Expenses.objects.create(amount='5.00')
        Expenses.objects.create(amount='9.00', from_register=False)
        self.balance('115.00')
        Expenses.objects.all().delete()
        self.balance('120.00')
        Report.objects.all().delete()
        self.balance('0.00')

    def test_deletion_reads_latest_persisted_values(self):
        report = Report.objects.create(date=timezone.localdate(), cash='10.00')
        latest = Report.objects.get(pk=report.pk)
        latest.cash = Decimal('20.00')
        latest.save()
        report.delete()
        self.balance('0.00')

    def test_transaction_rollback_restores_balance(self):
        with self.assertRaises(RuntimeError):
            with transaction.atomic():
                Report.objects.create(date=timezone.localdate(), cash='100.00')
                Expenses.objects.create(amount='20.00')
                raise RuntimeError('Abort')
        self.assertFalse(Report.objects.exists())
        self.balance('0.00')

    def test_insufficient_expense_rolls_back_and_exact_balance_is_allowed(self):
        Report.objects.create(date=timezone.localdate(), cash='10.00')
        with self.assertRaises(InsufficientCash):
            Expenses.objects.create(amount='10.01', info='Supplies')
        self.assertFalse(Expenses.objects.exists())
        self.balance('10.00')
        Expenses.objects.create(amount='10.00', info='Supplies')
        self.balance('0.00')

    def test_expense_edit_and_funding_switch_cannot_overdraw(self):
        Report.objects.create(date=timezone.localdate(), cash='100.00')
        expense = Expenses.objects.create(amount='80.00', info='Supplies')
        expense.amount = Decimal('101.00')
        with self.assertRaises(InsufficientCash):
            expense.save()
        expense.refresh_from_db()
        self.assertEqual(expense.amount, Decimal('80.00'))
        external = Expenses.objects.create(amount='30.00', from_register=False, info='Other funds')
        external.from_register = True
        with self.assertRaises(InsufficientCash):
            external.save()
        self.balance('20.00')

    def test_spent_report_cannot_be_reduced_or_deleted(self):
        report = Report.objects.create(date=timezone.localdate(), cash='100.00')
        Expenses.objects.create(amount='80.00', info='Supplies')
        report.cash = Decimal('79.00')
        with self.assertRaises(InsufficientCash):
            report.save()
        report.refresh_from_db()
        self.assertEqual(report.cash, Decimal('100.00'))
        with self.assertRaises(InsufficientCash), transaction.atomic():
            report.delete()
        self.assertTrue(Report.objects.filter(pk=report.pk).exists())
        self.balance('20.00')

    def test_bulk_delete_is_atomic_if_later_report_would_overdraw(self):
        Report.objects.create(date=timezone.localdate(), cash='10.00')
        Report.objects.create(date=timezone.localdate(), cash='90.00')
        Expenses.objects.create(amount='80.00', info='Supplies')
        with self.assertRaises(InsufficientCash), transaction.atomic():
            Report.objects.all().delete()
        self.assertEqual(Report.objects.count(), 2)
        self.balance('20.00')

    def test_stale_register_cannot_spend_the_same_balance_twice(self):
        Report.objects.create(date=timezone.localdate(), cash='100.00')
        first = CashRegister.get_default()
        second = CashRegister.get_default()
        first.apply_change(Decimal('-80.00'), using='default')
        with self.assertRaises(InsufficientCash):
            second.apply_change(Decimal('-80.00'), using='default')
        self.balance('20.00')

    def test_database_rejects_negative_balance_and_amounts(self):
        report = Report.objects.create(date=timezone.localdate(), cash='100.00')
        expense = Expenses.objects.create(amount='5.00', info='Supplies')
        for queryset, values in (
            (CashRegister.objects.all(), {'balance': '-0.01'}),
            (Report.objects.filter(pk=report.pk), {'cash': '-0.01'}),
            (Report.objects.filter(pk=report.pk), {'cards': '-0.01'}),
            (Expenses.objects.filter(pk=expense.pk), {'amount': '-0.01'}),
        ):
            with self.subTest(values=values):
                with self.assertRaises(IntegrityError), transaction.atomic():
                    queryset.update(**values)
        self.balance('95.00')


class ReportsAdminTests(TestCase):
    def setUp(self):
        self.media = tempfile.TemporaryDirectory()
        self.settings = override_settings(MEDIA_ROOT=self.media.name)
        self.settings.enable()
        self.addCleanup(self.media.cleanup)
        self.addCleanup(self.settings.disable)
        self.user = get_user_model().objects.create_superuser(
            username='manager', email='manager@example.com', password='test-password', telegram_id='admin',
        )
        self.client.force_login(self.user)

    def test_admin_pages_render_new_fields_and_register(self):
        for url in ('/admin/reports/report/', '/admin/reports/expenses/',
                    '/admin/reports/report/add/', '/admin/reports/expenses/add/',
                    '/admin/reports/cashregister/'):
            response = self.client.get(url)
            self.assertEqual(response.status_code, 200, url)
        report = self.client.get('/admin/reports/report/add/')
        self.assertContains(report, 'name="date"')
        self.assertNotContains(report, 'remaining_cash')
        self.assertNotContains(report, 'id_encashment')
        self.assertContains(report, 'data-cash-projected')
        expense = self.client.get('/admin/reports/expenses/add/')
        self.assertContains(expense, 'name="from_register"')
        self.assertNotContains(expense, 'name="date"')

    def test_admin_report_creation_and_superuser_cash_register_edit(self):
        response = self.client.post('/admin/reports/report/add/', {
            'date': '2026-10-11', 'shift': 'night',
            'admin': self.user.pk, 'cards': '10.00', 'spb': '20.00',
            'cash': '100.00', 'info': '', '_save': 'Save',
            'photos-TOTAL_FORMS': '1', 'photos-INITIAL_FORMS': '0',
            'photos-MIN_NUM_FORMS': '1', 'photos-MAX_NUM_FORMS': '1000',
            'photos-0-image': photo(),
        })
        self.assertEqual(response.status_code, 302, getattr(response, 'context', None))
        self.assertEqual(CashRegister.get_default().balance, Decimal('100.00'))
        register = self.client.get('/admin/reports/cashregister/1/change/')
        self.assertEqual(register.status_code, 200)
        self.assertContains(register, 'name="balance"')
        self.assertEqual(self.client.post('/admin/reports/cashregister/1/change/', {'balance': '999.00'}).status_code, 302)
        self.assertEqual(CashRegister.get_default().balance, Decimal('999.00'))

    def test_superuser_can_create_delete_cash_register_and_cannot_overwrite_by_adding(self):
        url = '/admin/reports/cashregister/'
        self.assertEqual(self.client.post(url + 'add/', {'balance': '150.00'}).status_code, 302)
        self.assertEqual(CashRegister.get_default().balance, Decimal('150.00'))
        duplicate = self.client.post(url + 'add/', {'balance': '1.00'})
        self.assertContains(duplicate, 'Касса уже существует')
        self.assertEqual(CashRegister.get_default().balance, Decimal('150.00'))
        negative = self.client.post(url + '1/change/', {'balance': '-1.00'})
        self.assertEqual(negative.status_code, 200)
        self.assertEqual(CashRegister.get_default().balance, Decimal('150.00'))
        self.assertEqual(self.client.post(url + '1/delete/', {'post': 'yes'}).status_code, 302)
        self.assertFalse(CashRegister.objects.exists())

    def test_failed_inline_validation_preserves_stored_cash_effect_for_preview(self):
        report = Report.objects.create(date=timezone.localdate(), cash='2000.00')
        response = self.client.post(f'/admin/reports/report/{report.pk}/change/', {
            'date': '2026-10-11', 'shift': 'night',
            'admin': self.user.pk, 'cards': '0.00', 'spb': '0.00',
            'cash': '3000.00', 'info': '', '_save': 'Save',
            'photos-TOTAL_FORMS': '0', 'photos-INITIAL_FORMS': '0',
            'photos-MIN_NUM_FORMS': '1', 'photos-MAX_NUM_FORMS': '1000',
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.context['original_cash_effect'], Decimal('2000.00'))
        self.assertContains(response, 'data-original-effect="2000.00"')
        report.refresh_from_db()
        self.assertEqual(report.cash, Decimal('2000.00'))
        self.assertEqual(CashRegister.get_default().balance, Decimal('2000.00'))

    def test_admin_expense_requires_description(self):
        response = self.client.post('/admin/reports/expenses/add/', {
            'admin': self.user.pk, 'amount': '5.00', 'from_register': 'on', 'info': '',
            'photos-TOTAL_FORMS': '0', 'photos-INITIAL_FORMS': '0',
            'photos-MIN_NUM_FORMS': '0', 'photos-MAX_NUM_FORMS': '1000',
        })
        self.assertEqual(response.status_code, 200)
        self.assertIn('info', response.context['adminform'].form.errors)
        self.assertFalse(Expenses.objects.exists())

    def test_admin_overspending_shows_form_error_without_saving(self):
        response = self.client.post('/admin/reports/expenses/add/', {
            'admin': self.user.pk, 'amount': '5.00', 'from_register': 'on', 'info': 'Supplies',
            'photos-TOTAL_FORMS': '0', 'photos-INITIAL_FORMS': '0',
            'photos-MIN_NUM_FORMS': '0', 'photos-MAX_NUM_FORMS': '1000',
        })
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Недостаточно наличных')
        self.assertFalse(Expenses.objects.exists())

    def test_admin_single_and_bulk_delete_show_error_for_spent_report(self):
        report = Report.objects.create(date=timezone.localdate(), cash='100.00')
        Expenses.objects.create(amount='80.00', info='Supplies')
        response = self.client.post(f'/admin/reports/report/{report.pk}/delete/', {'post': 'yes'}, follow=True)
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Недостаточно наличных')
        response = self.client.post('/admin/reports/report/', {
            'action': 'delete_selected', '_selected_action': [report.pk], 'post': 'yes',
        }, follow=True)
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'Недостаточно наличных')
        self.assertTrue(Report.objects.filter(pk=report.pk).exists())
        self.assertEqual(CashRegister.get_default().balance, Decimal('20.00'))

