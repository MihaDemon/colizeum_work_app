from django.core.exceptions import ValidationError


class InsufficientCash(ValidationError):
    def __init__(self, balance):
        super().__init__(
            'Недостаточно наличных в кассе. Доступно: %(balance)s ₽. '
            'Изменение нельзя сохранить: остаток станет отрицательным.',
            code='insufficient_cash', params={'balance': f'{balance:.2f}'},
        )
