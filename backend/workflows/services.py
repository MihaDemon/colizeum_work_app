from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from django.utils.formats import number_format
from rest_framework.exceptions import APIException, PermissionDenied

from reports.models import CashRegister, ExpensePhoto, Expenses, Report, ReportPhoto
from .models import Activity, CleanerVisit, PhotoSettings, Shift, ShiftExpense, Task, TaskSubmission, TaskSubmissionPhoto, TelegramNotification
from .permissions import person, role
from .notifications import MOSCOW, queue_management
from .photos import uploaded_photos, validate_photos


class Conflict(APIException):
    status_code = 409
    default_detail = 'Данные изменились. Обновите экран и повторите попытку.'


def lock_register(user=None):
    CashRegister.get_default()
    register = CashRegister.objects.select_for_update().get(pk=1)
    if user is not None and not get_user_model().objects.filter(pk=user.pk, is_active=True).exists():
        raise PermissionDenied('Учётная запись удалена или отключена.')
    return register


def own_shift(user):
    if role(user) != 'admin':
        raise PermissionDenied('Работать со сменами могут только администраторы.')
    shift = Shift.objects.filter(closed_at__isnull=True).first()
    if not shift or shift.admin_id != user.pk:
        raise Conflict('Сначала откройте свою смену.')
    return shift


def event(user, title, description='', kind='shift', task=None):
    Activity.objects.create(actor=user, title=title, description=description, kind=kind, task=task)


@transaction.atomic
def open_shift(user, data):
    lock_register(user)
    if role(user) != 'admin':
        raise PermissionDenied('Открывать смены могут только администраторы.')
    if Shift.objects.filter(closed_at__isnull=True).exists():
        raise Conflict('Предыдущая смена ещё открыта.')
    settings, _ = PhotoSettings.objects.get_or_create(pk=1)
    shift = Shift.objects.create(admin=user, photo_requirements=settings.report_fields, **data)
    from .schedules import bind_shift
    bind_shift(shift)
    event(user, 'Смена открыта', shift.get_shift_type_display())
    register = CashRegister.objects.get(pk=1)
    queue_management('shift_open', f'Смена открыта\nАдминистратор: {person(user)["name"]}\nТип: {shift.get_shift_type_display()}\nВремя: {shift.opened_at.astimezone(MOSCOW):%d/%m/%Y %H:%M}\nНаличные в кассе: {number_format(register.balance, decimal_pos=2, force_grouping=True)} ₽', shift=shift)
    return shift


@transaction.atomic
def close_shift(user, pk, data):
    lock_register(user)
    shift = own_shift(user)
    if str(shift.pk) != str(pk):
        raise Conflict('Эта смена больше не является вашей текущей сменой.')
    photos = uploaded_photos(data, [
        ('desk_photo', 'desk', 'Стол администратора'),
        ('receipt_photo', 'receipt', 'Чек закрытия смены'),
        ('additional_photo', 'additional', 'Дополнительное фото'),
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
    event(user, 'Смена закрыта', f'Итого: {number_format(report.cash + report.cards + report.spb, decimal_pos=2, force_grouping=True)} ₽')
    total = report.cash + report.cards + report.spb
    amounts = '\n'.join(f'{label}: {number_format(amount, decimal_pos=2, force_grouping=True)} ₽' for label, amount in [('Наличные', report.cash), ('Карта', report.cards), ('СБП', report.spb), ('Итого', total), ('Наличные в кассе', CashRegister.objects.get(pk=1).balance)])
    queue_management('shift_close', f'Смена закрыта\nАдминистратор: {person(user)["name"]}\nТип: {shift.get_shift_type_display()}\nВремя: {shift.closed_at.astimezone(MOSCOW):%d/%m/%Y %H:%M}\n{amounts}', shift=shift)
    return shift


@transaction.atomic
def add_expense(user, data):
    lock_register(user)
    shift = own_shift(user)
    expense = Expenses.objects.create(admin=user, amount=data['amount'], info=data['description'], from_register=True)
    ShiftExpense.objects.create(shift=shift, expense=expense)
    if data.get('photo'):
        ExpensePhoto.objects.create(expense=expense, image=data['photo'])
    event(user, 'Расход сохранён', f"{number_format(expense.amount, decimal_pos=2, force_grouping=True)} ₽ · {expense.info}", kind='expense')
    queue_management('expense', f'Расход из кассы\nАдминистратор: {person(user)["name"]}\nСумма: {number_format(expense.amount, decimal_pos=2, force_grouping=True)} ₽\nПричина: {expense.info[:2000]}\nВремя: {expense.date.astimezone(MOSCOW):%d/%m/%Y %H:%M}\nНаличные в кассе: {number_format(CashRegister.objects.get(pk=1).balance, decimal_pos=2, force_grouping=True)} ₽', expense=expense)
    return expense


@transaction.atomic
def mark_cleaner(user, pk):
    lock_register(user)
    shift = own_shift(user)
    if str(shift.pk) != str(pk):
        raise Conflict('Эта смена больше не является вашей текущей сменой.')
    if CleanerVisit.objects.filter(shift=shift).exists():
        raise Conflict('Приход уборщицы уже отмечен в этой смене.')
    visit = CleanerVisit.objects.create(shift=shift, admin=user, occurred_at=timezone.now())
    message = f'Уборщица пришла {visit.occurred_at.astimezone(MOSCOW):%d/%m/%y %H:%M}'
    event(user, 'Приход уборщицы', message, kind='cleaner')
    queue_management('cleaner', message, shift=shift)
    return visit


@transaction.atomic
def create_task(user, data):
    lock_register(user)
    assignee = get_user_model().objects.select_for_update().filter(pk=data['assignee'].pk).first()
    if assignee is None:
        raise Conflict('Сотрудник удалён. Выберите другого исполнителя.')
    data['assignee'] = assignee
    actor_role, target_role = role(user), role(assignee)
    if not assignee.is_active or user == assignee or actor_role == 'admin' or target_role == 'superuser':
        raise PermissionDenied('Выберите администратора или управляющего, которому можно назначить задачу.')
    shift = Shift.objects.filter(closed_at__isnull=True).first()
    if actor_role == 'manager':
        if target_role != 'admin' or not shift or shift.admin_id != assignee.pk:
            raise PermissionDenied('Управляющий может назначать задачи администратору текущей смены.')
    task = Task.objects.create(creator=user, shift=shift if shift and shift.admin_id == assignee.pk else None, **data)
    event(user, 'Задача назначена', task.title, kind='task', task=task)
    return task


@transaction.atomic
def submit_task(user, pk, data):
    # Shared lock order (register, then task) avoids a close/create/submit deadlock.
    lock_register(user)
    task = Task.objects.select_for_update().get(pk=pk)
    if role(user) == 'superuser' or task.assignee_id != user.pk:
        raise PermissionDenied('Выполнить задачу может только назначенный сотрудник.')
    if role(user) == 'admin':
        shift = own_shift(user)
        if task.shift_id and task.shift_id != shift.pk:
            raise Conflict('Эта задача относится к другой смене.')
    if task.status not in [Task.Status.ACTIVE, Task.Status.REJECTED]:
        raise Conflict('Эта задача уже отправлена на проверку.')
    previous = task.submissions.first()
    photos = uploaded_photos(data, [('photo', '', 'Фото выполнения')])
    if data.get('photo'):
        photos[-1]['legacy'] = True
    available = {}
    if previous:
        if previous.photo:
            available[f'legacy-{previous.pk}'] = {'image': previous.photo.name, 'slot': '', 'label': 'Фото выполнения', 'legacy': True}
        for image in previous.photos.all():
            available[str(image.pk)] = {'image': image.image.name, 'slot': image.slot, 'label': image.label}
    retained = data.get('retained_photos')
    if retained is None:
        retained = list(available) if not photos else []
    if any(pk not in available for pk in retained):
        from rest_framework.exceptions import ValidationError
        raise ValidationError({'retained_photos': 'Можно сохранить только фотографии из последнего выполнения этой задачи.'})
    photos.extend(dict(available[pk]) for pk in retained)
    if task.requires_photo and not photos:
        raise Conflict('Необходимо фото выполнения.')
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
    if task.creator_id:
        TelegramNotification.objects.create(submission=submission, recipient=task.creator, next_attempt_at=timezone.now())
    event(user, 'Задача на проверке', task.title, kind='task', task=task)
    return task


@transaction.atomic
def save_photo_settings(user, data):
    if role(user) not in ['manager', 'superuser']:
        raise PermissionDenied('Настраивать фотографии отчёта могут только управляющие и суперпользователи.')
    lock_register(user)
    settings, _ = PhotoSettings.objects.get_or_create(pk=1)
    if data['version'] != settings.version:
        raise Conflict('Настройки фотографий изменились. Откройте настройки заново и повторите попытку.')
    settings.report_fields = data['report_fields']
    settings.version += 1
    settings.save(update_fields=['report_fields', 'version'])
    event(user, 'Требования к фото отчёта обновлены', 'Применяется к сменам, открытым после изменения настроек.')
    return settings


@transaction.atomic
def review_task(user, pk, data):
    lock_register(user)
    task = Task.objects.select_for_update().get(pk=pk)
    if task.assignee_id == user.pk or not (user.is_superuser or (user.is_staff and task.creator_id == user.pk)):
        raise PermissionDenied('Проверить задачу может только её постановщик или суперпользователь.')
    if task.status != Task.Status.MODERATION or task.submission_version != data['version']:
        raise Conflict('Эта задача сейчас не ожидает проверки.')
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
    event(user, 'Задача принята' if data['accept'] else 'Задача возвращена на доработку', task.title, kind='task', task=task)
    return task
