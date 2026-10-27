from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import APIException, PermissionDenied

from reports.models import CashRegister, ExpensePhoto, Expenses, Report, ReportPhoto
from .models import Activity, PhotoSettings, Shift, ShiftExpense, Task, TaskSubmission, TaskSubmissionPhoto, TelegramNotification
from .permissions import role
from .photos import uploaded_photos, validate_photos


class Conflict(APIException):
    status_code = 409
    default_detail = 'This record changed. Refresh and try again.'


def lock_register():
    CashRegister.get_default()
    return CashRegister.objects.select_for_update().get(pk=1)


def own_shift(user):
    if role(user) != 'admin':
        raise PermissionDenied('Only administrators can operate shifts.')
    shift = Shift.objects.filter(closed_at__isnull=True).first()
    if not shift or shift.admin_id != user.pk:
        raise Conflict('You must have your own open shift.')
    return shift


def event(user, title, description='', kind='shift', task=None):
    Activity.objects.create(actor=user, title=title, description=description, kind=kind, task=task)


@transaction.atomic
def open_shift(user, data):
    lock_register()
    if role(user) != 'admin':
        raise PermissionDenied('Only administrators can open shifts.')
    if Shift.objects.filter(closed_at__isnull=True).exists():
        raise Conflict('The previous shift is still open.')
    settings, _ = PhotoSettings.objects.get_or_create(pk=1)
    shift = Shift.objects.create(admin=user, photo_requirements=settings.report_fields, **data)
    event(user, 'Shift opened', shift.get_shift_type_display())
    return shift


@transaction.atomic
def close_shift(user, pk, data):
    lock_register()
    shift = own_shift(user)
    if str(shift.pk) != str(pk):
        raise Conflict('This is no longer your active shift.')
    photos = uploaded_photos(data, [
        ('desk_photo', 'desk', 'Administrator desk'),
        ('receipt_photo', 'receipt', 'Closing receipt'),
        ('additional_photo', 'additional', 'Additional photo'),
    ])
    validate_photos(photos, 'named', shift.photo_requirements)
    report = Report.objects.create(
        admin=user, shift=shift.shift_type, date=timezone.localdate(),
        cash=data['cash'], cards=data['cards'], spb=data['sbp'],
    )
    for item in photos:
        ReportPhoto.objects.create(report=report, image=item['image'], label=item['label'])
    shift.report = report
    shift.closed_at = timezone.now()
    shift.save(update_fields=['report', 'closed_at'])
    # Unfinished shift assignments remain actionable on the recipient's next shift.
    Task.objects.filter(shift=shift).exclude(status=Task.Status.ACCEPTED).update(shift=None)
    event(user, 'Shift closed', f'Total: {report.cash + report.cards + report.spb} ₽')
    return shift


@transaction.atomic
def add_expense(user, data):
    lock_register()
    shift = own_shift(user)
    expense = Expenses.objects.create(admin=user, amount=data['amount'], info=data['description'], from_register=True)
    ShiftExpense.objects.create(shift=shift, expense=expense)
    if data.get('photo'):
        ExpensePhoto.objects.create(expense=expense, image=data['photo'])
    event(user, 'Expense recorded', f"{expense.amount} ₽ · {expense.info}", kind='expense')
    return expense


@transaction.atomic
def create_task(user, data):
    lock_register()
    assignee = get_user_model().objects.select_for_update().get(pk=data['assignee'].pk)
    data['assignee'] = assignee
    actor_role, target_role = role(user), role(assignee)
    if not assignee.is_active or user == assignee or actor_role == 'admin' or target_role == 'superuser':
        raise PermissionDenied('Choose an administrator or manager you can assign tasks to.')
    shift = Shift.objects.filter(closed_at__isnull=True).first()
    if actor_role == 'manager':
        if target_role != 'admin' or not shift or shift.admin_id != assignee.pk:
            raise PermissionDenied('Managers can assign tasks to the current shift administrator.')
    task = Task.objects.create(creator=user, shift=shift if shift and shift.admin_id == assignee.pk else None, **data)
    event(user, 'Task assigned', task.title, kind='task', task=task)
    return task


@transaction.atomic
def submit_task(user, pk, data):
    # Shared lock order (register, then task) avoids a close/create/submit deadlock.
    lock_register()
    task = Task.objects.select_for_update().get(pk=pk)
    if role(user) == 'superuser' or task.assignee_id != user.pk:
        raise PermissionDenied('Only the assigned employee can complete this task.')
    if role(user) == 'admin':
        shift = own_shift(user)
        if task.shift_id and task.shift_id != shift.pk:
            raise Conflict('This task belongs to another shift.')
    if task.status not in [Task.Status.ACTIVE, Task.Status.REJECTED]:
        raise Conflict('This task has already been submitted.')
    previous = task.submissions.first()
    photos = uploaded_photos(data, [('photo', '', 'Completion photo')])
    if data.get('photo'):
        photos[-1]['legacy'] = True
    available = {}
    if previous:
        if previous.photo:
            available[f'legacy-{previous.pk}'] = {'image': previous.photo.name, 'slot': '', 'label': 'Completion photo', 'legacy': True}
        for image in previous.photos.all():
            available[str(image.pk)] = {'image': image.image.name, 'slot': image.slot, 'label': image.label}
    retained = data.get('retained_photos')
    if retained is None:
        retained = list(available) if not photos else []
    if any(pk not in available for pk in retained):
        from rest_framework.exceptions import ValidationError
        raise ValidationError({'retained_photos': 'Only photos from your latest submission can be retained.'})
    photos.extend(dict(available[pk]) for pk in retained)
    if task.requires_photo and not photos:
        raise Conflict('A completion photo is required.')
    mode = 'single' if task.requires_photo and task.photo_mode == 'optional' else task.photo_mode
    validate_photos(photos, mode, task.photo_requirements)
    task.submission_version += 1
    legacy_photo = photos[0]['image'] if len(photos) == 1 and photos[0].get('legacy') else ''
    submission = TaskSubmission.objects.create(task=task, version=task.submission_version, submitted_by=user, photo=legacy_photo, note=data['note'])
    if not legacy_photo:
        for item in photos:
            TaskSubmissionPhoto.objects.create(submission=submission, image=item['image'], slot=item['slot'], label=item['label'])
    task.status = Task.Status.MODERATION
    task.submitted_at = timezone.now()
    task.rejection_reason = ''
    task.save(update_fields=['submission_version', 'status', 'submitted_at', 'rejection_reason'])
    TelegramNotification.objects.create(submission=submission, recipient=task.creator, next_attempt_at=timezone.now())
    event(user, 'Task on moderation', task.title, kind='task', task=task)
    return task


@transaction.atomic
def save_photo_settings(user, data):
    if role(user) not in ['manager', 'superuser']:
        raise PermissionDenied('Only managers and superusers can configure report photos.')
    lock_register()
    settings, _ = PhotoSettings.objects.get_or_create(pk=1)
    if data['version'] != settings.version:
        raise Conflict('Photo settings changed. Reopen settings and try again.')
    settings.report_fields = data['report_fields']
    settings.version += 1
    settings.save(update_fields=['report_fields', 'version'])
    event(user, 'Report photo requirements updated', 'Applies to shifts opened from now on.')
    return settings


@transaction.atomic
def review_task(user, pk, data):
    task = Task.objects.select_for_update().get(pk=pk)
    if task.assignee_id == user.pk or not (user.is_superuser or (user.is_staff and task.creator_id == user.pk)):
        raise PermissionDenied('Only the assigning manager or superuser can review this task.')
    if task.status != Task.Status.MODERATION or task.submission_version != data['version']:
        raise Conflict('This task is not awaiting moderation.')
    submission = task.submissions.get(version=task.submission_version)
    submission.reviewed_by = user
    submission.reviewed_at = timezone.now()
    submission.decision = 'accepted' if data['accept'] else 'rejected'
    submission.reason = data['reason'] if not data['accept'] else ''
    submission.save(update_fields=['reviewed_by', 'reviewed_at', 'decision', 'reason'])
    task.status = submission.decision
    task.rejection_reason = submission.reason
    task.accepted_at = submission.reviewed_at if data['accept'] else None
    task.save(update_fields=['status', 'rejection_reason', 'accepted_at'])
    event(user, 'Task accepted' if data['accept'] else 'Task needs rework', task.title, kind='task', task=task)
    return task
