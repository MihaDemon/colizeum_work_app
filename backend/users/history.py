from django.db import models


class UserHistory(models.Model):
    """Keep attribution when an employee's login is deleted."""
    user_snapshots = models.JSONField(
        default=dict, editable=False, verbose_name='Удалённые сотрудники',
    )

    class Meta:
        abstract = True


def participant_id(record, field):
    user_id = getattr(record, f'{field}_id')
    if user_id is not None:
        return str(user_id)
    return record.user_snapshots.get(field, {}).get('id', 'deleted-unknown')


def archived_people(records):
    people = {'deleted-unknown': {
        'id': 'deleted-unknown', 'name': 'Удалённый сотрудник',
        'initials': 'УС', 'role': 'admin', 'deleted': True,
    }}
    for record in records:
        for snapshot in record.user_snapshots.values():
            people[snapshot['id']] = snapshot
    return list(people.values())
