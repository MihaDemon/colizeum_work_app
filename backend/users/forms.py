from django import forms

from .models import AdminUser
from .phones import matching_staff_numbers, normalize_staff_phone


class AdminUserForm(forms.ModelForm):
    phone_number = forms.CharField(
        label='Номер телефона', max_length=32,
        help_text='Например: 9991234567 или +7 (999) 123-45-67.',
    )
    role = forms.ChoiceField(
        label='Роль', choices=[('admin', 'Администратор'), ('manager', 'Управляющий')],
        initial='admin',
    )

    class Meta:
        model = AdminUser
        fields = ('first_name', 'last_name', 'phone_number', 'role')

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields['first_name'].required = True
        self.fields['last_name'].required = True

    def clean_phone_number(self):
        phone = normalize_staff_phone(self.cleaned_data['phone_number'])
        if any(stored != self.instance.pk for stored in matching_staff_numbers(phone)):
            raise forms.ValidationError('Сотрудник с таким номером уже добавлен.')
        return phone
