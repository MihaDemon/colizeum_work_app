from django.apps import AppConfig


class UsersConfig(AppConfig):
    name = 'users'
    verbose_name = 'Пользователи'

    def ready(self):
        from . import signals  # noqa: F401
