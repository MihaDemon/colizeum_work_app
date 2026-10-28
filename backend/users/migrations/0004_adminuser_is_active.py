from django.db import migrations, models


def copy_active_state(apps, schema_editor):
    User = apps.get_model('users', 'User')
    AdminUser = apps.get_model('users', 'AdminUser')
    inactive = User.objects.using(schema_editor.connection.alias).filter(is_active=False).exclude(phone_number=None)
    AdminUser.objects.using(schema_editor.connection.alias).filter(pk__in=inactive.values('phone_number_id')).update(is_active=False)


class Migration(migrations.Migration):
    dependencies = [('users', '0003_alter_adminuser_role')]
    operations = [
        migrations.AddField(model_name='adminuser', name='is_active', field=models.BooleanField(default=True, verbose_name='Активен')),
        migrations.RunPython(copy_active_state, migrations.RunPython.noop),
    ]
