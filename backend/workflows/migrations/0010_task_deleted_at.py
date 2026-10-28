from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('workflows', '0009_task_notifications_preferences')]
    operations = [migrations.AddField(model_name='task', name='deleted_at', field=models.DateTimeField(null=True, blank=True, editable=False, verbose_name='Удалена'))]
