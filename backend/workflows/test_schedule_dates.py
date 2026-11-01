from datetime import date, datetime
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase
from django.utils import timezone
from rest_framework.test import APITestCase

from reports.models import CashRegister, Report
from .models import PhotoSettings, Shift


class ScheduleDateWorkflowTests(APITestCase):
    def setUp(self):
        self.admin = get_user_model().objects.create_user(username='day-admin')
        self.night_admin = get_user_model().objects.create_user(username='night-admin')
        self.client.force_authenticate(self.admin)
        PhotoSettings.objects.create(pk=1, report_fields=[])
        CashRegister.objects.create(balance=1000)

    def open_at(self, kind, stamp, schedule_date=None):
        with patch('django.utils.timezone.now', return_value=datetime.fromisoformat(stamp)):
            response = self.client.post('/api/shifts/open/', {'shift_type': kind, **({'schedule_date': schedule_date} if schedule_date else {})})
        self.assertEqual(response.status_code, 201, response.data)
        return response.data['id']

    def close_at(self, pk, stamp):
        with patch('django.utils.timezone.now', return_value=datetime.fromisoformat(stamp)):
            response = self.client.post(f'/api/shifts/{pk}/close/', {'cash': '100', 'cards': '200', 'sbp': '300'})
        self.assertEqual(response.status_code, 200, response.data)
        return Shift.objects.select_related('report').get(pk=pk)

    def test_late_month_end_handover_keeps_day_and_night_on_october_31(self):
        day_pk = self.open_at('day', '2026-10-31T10:00:00+03:00')
        day = self.close_at(day_pk, '2026-11-01T00:31:00+03:00')
        self.assertEqual(day.report.date, date(2026, 10, 31))
        day_data = self.client.get(f'/api/shifts/{day_pk}/').data
        self.assertEqual(day_data['scheduleDate'], '2026-10-31')
        self.assertEqual(datetime.fromisoformat(day_data['closedAt']), datetime.fromisoformat('2026-11-01T00:31:00+03:00'))

        self.client.force_authenticate(self.night_admin)
        night_pk = self.open_at('night', '2026-11-01T00:32:00+03:00')
        current = self.client.get('/api/workspace/').data['state']['shift']
        self.assertEqual(current['scheduleDate'], '2026-10-31')
        self.assertEqual(datetime.fromisoformat(current['openedAt']), datetime.fromisoformat('2026-11-01T00:32:00+03:00'))
        night = self.close_at(night_pk, '2026-11-01T10:00:00+03:00')
        self.assertEqual(night.report.date, date(2026, 10, 31))
        history = self.client.get('/api/workspace/').data['state']['shifts']
        self.assertEqual(history[0]['scheduleDate'], '2026-10-31')
        self.assertEqual(CashRegister.get_default().balance, 1200)

        next_pk = self.open_at('day', '2026-11-01T10:01:00+03:00')
        current = self.client.get('/api/workspace/').data['state']['shift']
        self.assertEqual(current['id'], next_pk)
        self.assertEqual(current['scheduleDate'], '2026-11-01')

    def test_regular_night_and_late_closing_use_opening_schedule_date(self):
        pk = self.open_at('night', '2026-10-31T22:00:00+03:00', '2026-10-31')
        shift = self.close_at(pk, '2026-11-02T00:10:00+03:00')
        self.assertEqual(shift.report.date, date(2026, 10, 31))
        self.assertEqual(shift.report.shift, 'night')

    def test_legacy_report_keeps_its_explicit_date(self):
        report = Report.objects.create(admin=self.admin, shift='night', date=date(2026, 10, 31), cash=0)
        legacy = self.client.get('/api/workspace/').data['state']['shifts'][0]
        self.assertEqual(legacy['id'], f'legacy-{report.pk}')
        self.assertEqual(legacy['scheduleDate'], '2026-10-31')

    def test_missing_day_shift_requires_explicit_date_and_rejects_invalid_dates(self):
        with patch('django.utils.timezone.now', return_value=datetime.fromisoformat('2026-11-01T00:32:00+03:00')):
            for extra in ({}, {'schedule_date': '2026-11-02'}, {'schedule_date': 'invalid'}):
                response = self.client.post('/api/shifts/open/', {'shift_type': 'night', **extra})
                self.assertEqual(response.status_code, 400, response.data)
                self.assertIn('schedule_date', response.data)
            self.assertFalse(Shift.objects.exists())
            self.assertEqual(self.client.get('/api/workspace/').data['state']['shiftOpening'], {
                'today': '2026-11-01', 'nightDate': None,
            })
        pk = self.open_at('night', '2026-11-01T00:32:00+03:00', '2026-10-31')
        self.assertEqual(Shift.objects.get(pk=pk).schedule_date, date(2026, 10, 31))

    def test_handover_has_no_clock_cutoff_and_cannot_override_the_day_date(self):
        pk = self.open_at('day', '2026-10-31T10:00:00+03:00')
        self.close_at(pk, '2026-11-01T11:00:00+03:00')
        with patch('django.utils.timezone.now', return_value=datetime.fromisoformat('2026-11-01T11:01:00+03:00')):
            self.assertEqual(self.client.get('/api/workspace/').data['state']['shiftOpening']['nightDate'], '2026-10-31')
            response = self.client.post('/api/shifts/open/', {'shift_type': 'night', 'schedule_date': '2026-11-01'})
            self.assertEqual(response.status_code, 400, response.data)
        pk = self.open_at('night', '2026-11-01T11:01:00+03:00')
        self.assertEqual(Shift.objects.get(pk=pk).schedule_date, date(2026, 10, 31))

    def test_stale_day_and_previous_night_do_not_supply_a_handover_date(self):
        pk = self.open_at('day', '2026-10-30T10:00:00+03:00')
        self.close_at(pk, '2026-10-30T22:00:00+03:00')
        with patch('django.utils.timezone.now', return_value=datetime.fromisoformat('2026-10-31T22:00:00+03:00')):
            self.assertEqual(self.client.get('/api/workspace/').data['state']['shiftOpening']['nightDate'], '2026-10-30')
        with patch('django.utils.timezone.now', return_value=datetime.fromisoformat('2026-10-31T22:00:01+03:00')):
            self.assertEqual(self.client.post('/api/shifts/open/', {'shift_type': 'night'}).status_code, 400)
        pk = self.open_at('night', '2026-10-31T22:00:01+03:00', '2026-10-31')
        self.close_at(pk, '2026-11-01T10:00:00+03:00')
        with patch('django.utils.timezone.now', return_value=datetime.fromisoformat('2026-11-01T10:01:00+03:00')):
            self.assertEqual(self.client.post('/api/shifts/open/', {'shift_type': 'night'}).status_code, 400)

    def test_year_boundary_and_moscow_date_ignore_active_request_timezone(self):
        with timezone.override('America/New_York'):
            pk = self.open_at('day', '2026-12-31T10:00:00+03:00')
            self.close_at(pk, '2026-12-31T21:31:00+00:00')
            pk = self.open_at('night', '2026-12-31T21:32:00+00:00')
            self.assertEqual(Shift.objects.get(pk=pk).schedule_date, date(2026, 12, 31))
            self.close_at(pk, '2027-01-01T07:00:00+00:00')
            pk = self.open_at('day', '2027-01-01T21:40:00+00:00')
            self.assertEqual(Shift.objects.get(pk=pk).schedule_date, date(2027, 1, 2))

    def test_stale_day_form_date_is_rejected_after_midnight(self):
        with patch('django.utils.timezone.now', return_value=datetime.fromisoformat('2026-11-01T00:01:00+03:00')):
            response = self.client.post('/api/shifts/open/', {'shift_type': 'day', 'schedule_date': '2026-10-31'})
        self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(Shift.objects.exists())


class ScheduleDateMigrationTests(TransactionTestCase):
    def test_backfill_repairs_handover_reports_without_changing_money_or_timestamps(self):
        before = [('workflows', '0010_task_deleted_at')]
        after = [('workflows', '0011_shift_schedule_date')]
        executor = MigrationExecutor(connection)
        latest = executor.loader.graph.leaf_nodes()
        self.addCleanup(lambda: MigrationExecutor(connection).migrate(latest))
        executor.migrate(before)
        apps = executor.loader.project_state(before).apps
        OldShift = apps.get_model('workflows', 'Shift')
        OldReport = apps.get_model('reports', 'Report')
        OldRegister = apps.get_model('reports', 'CashRegister')
        OldPeriod = apps.get_model('workflows', 'SchedulePeriod')
        OldRevision = apps.get_model('workflows', 'ScheduleRevision')
        OldRegister.objects.create(pk=1, balance=4321)
        october = OldPeriod.objects.create(start='2026-10-16', end='2026-10-31')
        november = OldPeriod.objects.create(start='2026-11-01', end='2026-11-15')
        planned = {'id': '42', 'name': 'По графику октября'}
        right_revision = OldRevision.objects.create(period=october, number=1,
            created_at=datetime.fromisoformat('2026-10-15T12:00:00+03:00'), plan={'2026-10-31/night': planned})
        wrong_revision = OldRevision.objects.create(period=november, number=1,
            created_at=datetime.fromisoformat('2026-10-30T12:00:00+03:00'))

        def shift(kind, opened, closed, report_date):
            report = OldReport.objects.create(date=report_date, shift=kind, cash=100, cards=200, spb=300)
            record = OldShift.objects.create(shift_type=kind, closed_at=datetime.fromisoformat(closed), report=report)
            OldShift.objects.filter(pk=record.pk).update(opened_at=datetime.fromisoformat(opened))
            return record.pk, report.pk

        day, day_report = shift('day', '2026-10-31T10:00:00+03:00', '2026-11-01T00:31:00+03:00', '2026-11-01')
        night, night_report = shift('night', '2026-11-01T00:32:00+03:00', '2026-11-01T10:00:00+03:00', '2026-11-01')
        OldShift.objects.filter(pk=night).update(schedule_date='2026-11-01', schedule_revision=wrong_revision)
        corrected, corrected_report = shift('day', '2026-11-01T10:01:00+03:00', '2026-11-01T22:00:00+03:00', '2026-10-30')
        standalone = OldReport.objects.create(date='2026-11-01', shift='night', cash=50)
        timestamps = list(OldShift.objects.order_by('pk').values_list('pk', 'opened_at', 'closed_at'))
        amounts = list(OldReport.objects.order_by('pk').values_list('pk', 'cash', 'cards', 'spb'))

        executor = MigrationExecutor(connection)
        executor.migrate(after)
        for pk in (day, night):
            self.assertEqual(Shift.objects.get(pk=pk).schedule_date, date(2026, 10, 31))
        for pk in (day_report, night_report):
            self.assertEqual(Report.objects.get(pk=pk).date, date(2026, 10, 31))
        fixed_night = Shift.objects.get(pk=night)
        self.assertEqual(fixed_night.schedule_revision_id, right_revision.pk)
        self.assertEqual(fixed_night.proposed_admin, planned)
        self.assertEqual(Shift.objects.get(pk=corrected).schedule_date, date(2026, 10, 30))
        self.assertEqual(Report.objects.get(pk=corrected_report).date, date(2026, 10, 30))
        self.assertEqual(Report.objects.get(pk=standalone.pk).date, date(2026, 11, 1))
        self.assertEqual(list(Shift.objects.order_by('pk').values_list('pk', 'opened_at', 'closed_at')), timestamps)
        self.assertEqual(list(Report.objects.order_by('pk').values_list('pk', 'cash', 'cards', 'spb')), amounts)
        self.assertEqual(CashRegister.get_default().balance, 4321)
