from django.db.models import Q


def role(user):
    return 'superuser' if user.is_superuser else 'manager' if user.is_staff else 'admin'


def visible_tasks(user, queryset):
    queryset = queryset.filter(deleted_at__isnull=True)
    if user.is_superuser:
        return queryset
    scope = Q(creator=user) | Q(assignee=user)
    if user.is_staff:
        scope |= Q(reviewers=user)
    return queryset.filter(scope).distinct()


def can_review(user, task):
    if task.assignee_id == user.pk:
        return False
    return user.is_superuser or (user.is_staff and (
        task.reviewers.filter(pk=user.pk).exists() if task.reviewer_snapshots else task.creator_id == user.pk
    ))


def review_recipients(task):
    from django.contrib.auth import get_user_model
    users = get_user_model().objects.filter(is_active=True)
    if task.reviewer_snapshots:
        assigned = users.filter(Q(is_staff=True) | Q(is_superuser=True), review_tasks=task)
    else:
        assigned = users.filter(Q(is_staff=True) | Q(is_superuser=True), pk=task.creator_id)
    assigned = list(assigned.exclude(pk=task.assignee_id))
    return (assigned or list(users.filter(is_superuser=True).exclude(pk=task.assignee_id))) if task.reviewer_snapshots else assigned


def person(user):
    contact = user.phone_number
    name = ' '.join(filter(None, [contact.first_name, contact.last_name])) if contact else user.get_full_name()
    name = name or user.username
    return {'id': str(user.pk), 'name': name, 'initials': ''.join(p[0] for p in name.split()[:2]).upper(), 'role': role(user), 'isActive': user.is_active}
