from django.contrib.auth import get_user_model
from django.db.models import Q
from reports.models import CashRegister, Expenses, Report
from users.history import archived_people, participant_id
from .models import Activity, PhotoSettings, Shift, Task
from .permissions import person, visible_tasks


def file_url(kind, pk):
    return f'/api/files/{kind}/{pk}/'


def iso(value):
    return value.isoformat() if value else None


def participant_name(record, field):
    user = getattr(record, field)
    return person(user)['name'] if user else record.user_snapshots.get(field, {}).get('name', 'Удалённый сотрудник')


def cleaner_data(visit):
    return {'id': str(visit.pk), 'shiftId': str(visit.shift_id), 'adminId': participant_id(visit, 'admin'),
            'adminName': participant_name(visit, 'admin'), 'occurredAt': iso(visit.occurred_at)}


def expense_data(expense):
    photos = list(expense.photos.all())
    return {'id': str(expense.pk), 'adminId': participant_id(expense, 'admin'), 'adminName': participant_name(expense, 'admin'),
            'shiftId': str(expense.work_shift_expense.shift_id) if hasattr(expense, 'work_shift_expense') else None,
            'amount': float(expense.amount), 'description': expense.info, 'createdAt': iso(expense.date),
            'photo': file_url('expense', photos[0].pk) if photos else None,
            'photos': [{'url': file_url('expense', p.pk), 'label': 'Чек расхода'} for p in photos]}


def task_data(task):
    submission = next(iter(task.submissions.all()), None)
    photos = []
    if submission:
        if submission.photo:
            photos.append({'id': f'legacy-{submission.pk}', 'slot': '', 'label': 'Фото выполнения', 'url': file_url('submission', submission.pk)})
        photos.extend({'id': str(photo.pk), 'slot': photo.slot, 'label': photo.label, 'url': file_url('submission-photo', photo.pk)} for photo in submission.photos.all())
    return {
        'id': str(task.pk), 'title': task.title, 'description': task.description,
        'managerId': participant_id(task, 'creator'), 'adminId': participant_id(task, 'assignee'),
        'shiftId': str(task.shift_id) if task.shift_id else None,
        'priority': task.priority, 'requiresPhoto': task.requires_photo,
        'photoMode': 'single' if task.requires_photo and task.photo_mode == 'optional' else task.photo_mode,
        'photoRequirements': task.photo_requirements, 'photos': photos,
        'referencePhoto': file_url('reference', task.pk) if task.reference_photo else None,
        'status': task.status, 'submissionVersion': task.submission_version, 'photo': photos[0]['url'] if photos else None,
        'photoName': photos[0]['label'] if photos else None,
        'note': submission.note if submission else '', 'rejectionReason': task.rejection_reason,
        'createdAt': iso(task.created_at), 'submittedAt': iso(task.submitted_at), 'acceptedAt': iso(task.accepted_at),
    }


def shift_data(shift, include_cleaner=True):
    report = shift.report
    cleaner = getattr(shift, 'cleaner_visit', None)
    return {
        'id': str(shift.pk), 'adminId': participant_id(shift, 'admin'), 'type': shift.shift_type,
        'adminName': participant_name(shift, 'admin'), 'cleanerVisitedAt': iso(cleaner.occurred_at) if cleaner and include_cleaner else None,
        'openedAt': iso(shift.opened_at), 'closedAt': iso(shift.closed_at),
        'photoRequirements': shift.photo_requirements,
        **({'balance': float(CashRegister.objects.filter(pk=1).values_list('balance', flat=True).first() or 0)} if not report else {}),
        **({'cash': float(report.cash), 'cards': float(report.cards), 'sbp': float(report.spb),
            'total': str(report.cash + report.cards + report.spb),
            'photos': {p.label or f'Фото {p.pk}': file_url('report', p.pk) for p in report.photos.all()}} if report else {}),
    }


def workspace_data(user):
    tasks = visible_tasks(user, Task.objects.select_related('creator', 'assignee').prefetch_related('submissions__photos'))
    photo_settings, _ = PhotoSettings.objects.get_or_create(pk=1)
    shifts = Shift.objects.select_related('report', 'admin__phone_number', 'cleaner_visit').prefetch_related('report__photos')
    current = shifts.filter(closed_at__isnull=True).first()
    history = shifts.filter(closed_at__isnull=False)
    expenses = Expenses.objects.select_related('work_shift_expense').prefetch_related('photos').order_by('-date')
    activity = Activity.objects.select_related('task')
    if not user.is_staff and not user.is_superuser:
        history = history.filter(admin=user)
        expenses = expenses.filter(admin=user)
        activity = activity.filter(Q(actor=user) | Q(task__assignee=user)).exclude(kind='cleaner')
    elif not user.is_superuser:
        activity = activity.filter(Q(actor=user) | Q(task__creator=user) | Q(task__assignee=user) | Q(task__isnull=True))
    people_ids = {user.pk}
    if current:
        people_ids.add(current.admin_id)
    task_list, history_list, expense_list = list(tasks), list(history), list(expenses)
    for task in task_list:
        people_ids.update([task.creator_id, task.assignee_id])
    people_ids.update(s.admin_id for s in history_list)
    people_ids.update(e.admin_id for e in expense_list if e.admin_id)
    legacy_reports = Report.objects.filter(work_shift__isnull=True).select_related('admin').prefetch_related('photos').order_by('-date', '-pk')
    if not user.is_staff and not user.is_superuser:
        legacy_reports = legacy_reports.filter(admin=user)
    legacy_reports = list(legacy_reports)
    people_ids.update(r.admin_id for r in legacy_reports if r.admin_id)
    activity_list = list(activity[:200])
    people_ids.update(a.actor_id for a in activity_list if a.actor_id)
    available = Q(is_active=True) if user.is_superuser else Q(is_active=True, is_staff=False, is_superuser=False) if user.is_staff else Q(pk=user.pk)
    people = get_user_model().objects.select_related('phone_number').filter(Q(pk__in=people_ids) | available)
    legacy = [{
        'id': f'legacy-{r.pk}', 'adminId': participant_id(r, 'admin'), 'type': r.shift,
        # A date anchor is only used to format the date; the UI does not invent shift times.
        'openedAt': f'{r.date.isoformat()}T12:00:00+03:00', 'legacy': True,
        'cash': float(r.cash), 'cards': float(r.cards), 'sbp': float(r.spb),
        'total': str(r.cash + r.cards + r.spb),
        'photos': {p.label or f'Фото {p.pk}': file_url('report', p.pk) for p in r.photos.all()},
    } for r in legacy_reports]
    archives = archived_people(
        ([current] if current else []) + task_list + history_list + expense_list + legacy_reports
        + activity_list + [a.task for a in activity_list if a.task_id]
    )
    balance = CashRegister.objects.filter(pk=1).values_list('balance', flat=True).first() or 0
    return {
        'user': person(user), 'people': [person(p) for p in people] + archives,
        'state': {
            'photoSettings': {'reportFields': photo_settings.report_fields, 'version': photo_settings.version},
            'shift': shift_data(current) if current else None,
            'shifts': sorted([shift_data(s, include_cleaner=user.is_staff or user.is_superuser) for s in history_list] + legacy, key=lambda s: s['openedAt'], reverse=True), 'tasks': [task_data(t) for t in task_list],
            'expenses': [{
                'id': str(e.pk), 'adminId': participant_id(e, 'admin'),
                'shiftId': str(e.work_shift_expense.shift_id) if hasattr(e, 'work_shift_expense') else None,
                'amount': float(e.amount), 'description': e.info, 'createdAt': iso(e.date),
                'photo': file_url('expense', e.photos.all()[0].pk) if e.photos.all() else None,
            } for e in expense_list],
            'balance': float(balance),
            'activity': [{'id': str(a.pk), 'title': a.title, 'description': a.description, 'time': iso(a.created_at),
                          'kind': a.kind, 'actorId': participant_id(a, 'actor'),
                          'managerId': participant_id(a.task, 'creator') if a.task_id else None, 'recipientId': participant_id(a.task, 'assignee') if a.task_id else None} for a in activity_list],
        },
    }
