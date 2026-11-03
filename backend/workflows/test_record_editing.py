import json
import tempfile
import uuid
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from reports.models import CashRegister, Expenses, ExpensePhoto, Report, ReportPhoto
from .editing import record_version
from .models import Activity, Shift
from .tests import photo

User = get_user_model()


class RecordEditingTests(APITestCase):
    def setUp(self):
        self.media = tempfile.TemporaryDirectory()
        override = override_settings(MEDIA_ROOT=self.media.name)
        override.enable()
        self.addCleanup(self.media.cleanup)
        self.addCleanup(override.disable)
        self.admin = User.objects.create_user(username='admin')
        self.other = User.objects.create_user(username='other')
        self.manager = User.objects.create_user(username='manager', is_staff=True)
        self.client.force_authenticate(self.admin)
        CashRegister.objects.create(balance=1000)

    def expense(self):
        expense = Expenses.objects.create(admin=self.admin, amount=100, info='Бумага')
        ExpensePhoto.objects.create(expense=expense, image=photo())
        return expense

    def shift(self):
        report = Report.objects.create(admin=self.admin, shift='day', date=timezone.localdate(), cash=100, cards=200, spb=300)
        ReportPhoto.objects.create(report=report, image=photo(), label='Чек')
        shift = Shift.objects.create(admin=self.admin, report=report, shift_type='day', closed_at=timezone.now() - timedelta(hours=1))
        Shift.objects.filter(pk=shift.pk).update(opened_at=timezone.now() - timedelta(hours=2))
        shift.refresh_from_db()
        return shift

    def shift_payload(self, shift):
        return {'version': record_version(shift), 'admin_id': shift.admin_id, 'shift_type': shift.shift_type,
                'schedule_date': str(shift.schedule_date), 'opened_at': shift.opened_at.isoformat(),
                'closed_at': shift.closed_at.isoformat(), 'cash': '150.25', 'cards': '250.50', 'sbp': '350.75',
                'info': 'Исправленный отчёт'}

    def test_expense_correction_preserves_photo_and_applies_only_difference(self):
        expense = self.expense()
        response = self.client.post(f'/api/shift-expenses/{expense.pk}/', {
            'version': record_version(expense), 'amount': '80.25', 'description': 'Бумага и ручки'})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(CashRegister.get_default().balance, 919.75)
        self.assertEqual(expense.photos.count(), 1)
        self.assertEqual(response.data['description'], 'Бумага и ручки')
        self.assertTrue(Activity.objects.filter(title='Расход изменён', actor=self.admin).exists())

    def test_expense_photo_can_be_replaced_then_removed(self):
        expense = self.expense()
        old_photo = expense.photos.get().pk
        response = self.client.post(f'/api/shift-expenses/{expense.pk}/', {
            'version': record_version(expense), 'amount': 100, 'description': 'Бумага', 'photo': photo('new.png')})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertNotEqual(expense.photos.get().pk, old_photo)
        response = self.client.post(f'/api/shift-expenses/{expense.pk}/', {
            'version': response.data['editingVersion'], 'amount': 100, 'description': 'Бумага', 'remove_photo': True})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(expense.photos.exists())
        self.assertEqual(CashRegister.get_default().balance, 900)

    def test_expense_insufficient_cash_rolls_back_comment_and_photos(self):
        expense = self.expense()
        response = self.client.post(f'/api/shift-expenses/{expense.pk}/', {
            'version': record_version(expense), 'amount': 1100, 'description': 'Нельзя', 'remove_photo': True})
        self.assertEqual(response.status_code, 400, response.data)
        expense.refresh_from_db()
        self.assertEqual(expense.info, 'Бумага')
        self.assertEqual(expense.amount, 100)
        self.assertEqual(expense.photos.count(), 1)
        self.assertEqual(CashRegister.get_default().balance, 900)

    def test_other_admin_cannot_edit_but_manager_can(self):
        expense, shift = self.expense(), self.shift()
        payload = {'version': record_version(expense), 'amount': 90, 'description': 'Исправлено'}
        shift_payload = self.shift_payload(shift)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.post(f'/api/shift-expenses/{expense.pk}/', payload).status_code, 403)
        self.assertEqual(self.client.post(f'/api/shifts/{shift.pk}/edit/', shift_payload).status_code, 403)
        self.client.force_authenticate(self.manager)
        self.assertEqual(self.client.post(f'/api/shift-expenses/{expense.pk}/', payload).status_code, 200)
        self.assertEqual(self.client.post(f'/api/shifts/{shift.pk}/edit/', shift_payload).status_code, 200)

    def test_stale_edits_fail_and_idempotent_retries_apply_cash_once(self):
        expense = self.expense()
        payload = {'version': record_version(expense), 'amount': 200, 'description': 'Исправлено'}
        headers = {'HTTP_IDEMPOTENCY_KEY': str(uuid.uuid4())}
        for _ in range(2):
            self.assertEqual(self.client.post(f'/api/shift-expenses/{expense.pk}/', payload, **headers).status_code, 200)
        self.assertEqual(CashRegister.get_default().balance, 800)
        self.assertEqual(self.client.post(f'/api/shift-expenses/{expense.pk}/', payload).status_code, 409)
        shift = self.shift()
        data = self.shift_payload(shift)
        self.assertEqual(self.client.post(f'/api/shifts/{shift.pk}/edit/', data).status_code, 200)
        self.assertEqual(self.client.post(f'/api/shifts/{shift.pk}/edit/', data).status_code, 409)

    def test_all_shift_fields_and_retained_photos_are_saved(self):
        shift = self.shift()
        self.client.force_authenticate(self.manager)
        data = self.shift_payload(shift)
        data.update(admin_id=self.other.pk, shift_type='night', schedule_date=str(timezone.localdate() - timedelta(days=1)),
                    opened_at=(shift.opened_at - timedelta(minutes=15)).isoformat(),
                    closed_at=(shift.closed_at - timedelta(minutes=15)).isoformat())
        response = self.client.post(f'/api/shifts/{shift.pk}/edit/', data)
        self.assertEqual(response.status_code, 200, response.data)
        shift.refresh_from_db()
        self.assertEqual(shift.admin_id, self.other.pk)
        self.assertEqual(shift.shift_type, 'night')
        self.assertEqual(shift.opened_at.isoformat(), data['opened_at'])
        self.assertEqual(str(shift.schedule_date), data['schedule_date'])
        self.assertEqual(shift.report.admin_id, self.other.pk)
        self.assertEqual(shift.report.date, shift.schedule_date)
        self.assertEqual(shift.report.shift, shift.shift_type)
        self.assertEqual(shift.report.info, data['info'])
        self.assertEqual(str(shift.report.cards), '250.50')
        self.assertEqual(str(shift.report.spb), '350.75')
        self.assertEqual(shift.report.photos.count(), 1)
        self.assertEqual(str(CashRegister.get_default().balance), '1150.25')

    def test_admin_cannot_reassign_shift_or_edit_open_shift(self):
        shift = self.shift()
        data = self.shift_payload(shift)
        data['admin_id'] = self.other.pk
        self.assertEqual(self.client.post(f'/api/shifts/{shift.pk}/edit/', data).status_code, 403)
        opened = Shift.objects.create(admin=self.admin, shift_type='day')
        self.assertEqual(self.client.post(f'/api/shifts/{opened.pk}/edit/', data).status_code, 409)

    def test_shift_time_validation_and_cash_rollback(self):
        shift = self.shift()
        data = self.shift_payload(shift)
        for field, value in [('closed_at', (shift.opened_at - timedelta(minutes=1)).isoformat()),
                             ('closed_at', (timezone.now() + timedelta(hours=1)).isoformat()),
                             ('schedule_date', str(timezone.localdate() + timedelta(days=1)))]:
            bad = {**data, field: value}
            self.assertEqual(self.client.post(f'/api/shifts/{shift.pk}/edit/', bad).status_code, 400)
        CashRegister.objects.update(balance=10)
        data['cash'] = 0
        self.assertEqual(self.client.post(f'/api/shifts/{shift.pk}/edit/', data).status_code, 400)
        shift.refresh_from_db()
        self.assertEqual(shift.report.cash, 100)
        self.assertEqual(shift.report.info, None)
        self.assertEqual(CashRegister.get_default().balance, 10)

    def test_shift_photo_replacement_rename_removal_and_foreign_photo_rejection(self):
        shift = self.shift()
        data = self.shift_payload(shift)
        old = shift.report.photos.get()
        data.update(photos=[photo('extra.png')], photo_labels=json.dumps(['Новый чек']), photo_slots=json.dumps(['']),
                    retained_photos=json.dumps([str(old.pk)]), retained_photo_labels=json.dumps({str(old.pk): 'Старый чек'}))
        response = self.client.post(f'/api/shifts/{shift.pk}/edit/', data)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertCountEqual(shift.report.photos.values_list('label', flat=True), ['Старый чек', 'Новый чек'])
        shift.refresh_from_db()
        bad = {**self.shift_payload(shift), 'retained_photos': ['99999']}
        self.assertEqual(self.client.post(f'/api/shifts/{shift.pk}/edit/', bad, format='json').status_code, 400)
        clear = {**self.shift_payload(shift), 'retained_photos': []}
        self.assertEqual(self.client.post(f'/api/shifts/{shift.pk}/edit/', clear, format='json').status_code, 200)
        self.assertEqual(shift.report.photos.count(), 0)

    def test_legacy_report_can_be_corrected_and_deleted_attribution_is_preserved(self):
        shift = self.shift()
        report = Report.objects.create(admin=self.admin, date=timezone.localdate(), shift='day', cash=10)
        payload = self.shift_payload(shift)
        payload['version'] = record_version(report)
        response = self.client.post(f'/api/shifts/legacy-{report.pk}/edit/', payload)
        self.assertEqual(response.status_code, 200, response.data)
        report.refresh_from_db()
        self.assertEqual(report.info, payload['info'])
        self.client.force_authenticate(self.manager)
        self.admin.delete()
        shift.refresh_from_db()
        snapshot = shift.user_snapshots['admin']
        payload = self.shift_payload(shift)
        response = self.client.post(f'/api/shifts/{shift.pk}/edit/', payload, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        shift.refresh_from_db()
        self.assertEqual(shift.user_snapshots['admin'], snapshot)

    def test_versions_and_photo_ids_are_available_in_workspace_and_details(self):
        expense, shift = self.expense(), self.shift()
        state = self.client.get('/api/workspace/').data['state']
        self.assertEqual(state['expenses'][0]['editingVersion'], record_version(expense))
        self.assertEqual(state['shifts'][0]['editingVersion'], record_version(shift))
        self.assertEqual(state['shifts'][0]['reportPhotos'][0]['id'], str(shift.report.photos.get().pk))
        self.assertEqual(self.client.get(f'/api/shifts/{shift.pk}/').data['editingVersion'], record_version(shift))
