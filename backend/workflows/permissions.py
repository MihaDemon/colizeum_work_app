from django.db.models import Q


def role(user):
    return 'superuser' if user.is_superuser else 'manager' if user.is_staff else 'admin'


def visible_tasks(user, queryset):
    if user.is_superuser:
        return queryset
    return queryset.filter(Q(creator=user) | Q(assignee=user))


def person(user):
    contact = user.phone_number
    name = ' '.join(filter(None, [contact.first_name, contact.last_name])) if contact else user.get_full_name()
    name = name or user.username
    return {'id': str(user.pk), 'name': name, 'initials': ''.join(p[0] for p in name.split()[:2]).upper(), 'role': role(user), 'isActive': user.is_active}
