from io import BytesIO
from tempfile import TemporaryDirectory

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from PIL import Image

from reports.models import ExpensePhoto, Expenses, Report, ReportPhoto


class PhotoUploadTests(TestCase):
    def setUp(self):
        media_root = self.enterContext(TemporaryDirectory())
        self.enterContext(override_settings(MEDIA_ROOT=media_root))
        user = get_user_model().objects.create_superuser(
            username='photo-admin',
            email='photo-admin@example.com',
            password='test-password',
        )
        self.client.force_login(user)

    def image_upload(self, name):
        buffer = BytesIO()
        Image.new('RGB', (2, 2)).save(buffer, format='PNG')
        return SimpleUploadedFile(name, buffer.getvalue(), content_type='image/png')

    def form_data(self, model, count):
        data = {
            'admin': '',
            'info': '',
            'photos-TOTAL_FORMS': str(max(count, 1)),
            'photos-INITIAL_FORMS': '0',
            'photos-MIN_NUM_FORMS': '1',
            'photos-MAX_NUM_FORMS': '1000',
            '_save': 'Save',
        }
        if model is Report:
            data.update(
                shift=Report.Shift.DAY,
                cards='0', spb='0', cash='0', remaining_cash='0', encashment='0',
            )
        else:
            data['amount'] = '10.00'
        for index in range(count):
            data[f'photos-{index}-image'] = self.image_upload(f'photo-{index}.png')
        return data

    def admin_url(self, model, action, *args):
        return reverse(f'admin:reports_{model._meta.model_name}_{action}', args=args)

    def test_save_with_one_or_multiple_photos(self):
        for model in (Report, Expenses):
            for count in (1, 2):
                with self.subTest(model=model.__name__, count=count):
                    response = self.client.post(
                        self.admin_url(model, 'add'), self.form_data(model, count),
                    )
                    self.assertEqual(response.status_code, 302)
                    obj = model.objects.latest('pk')
                    self.assertEqual(obj.photos.count(), count)
                    for photo in obj.photos.all():
                        self.assertTrue(photo.image.storage.exists(photo.image.name))
                        with photo.image.open('rb') as uploaded_image:
                            self.assertEqual(Image.open(uploaded_image).format, 'PNG')

    def test_report_requires_photos_but_expenses_allow_zero(self):
        for model in (Report, Expenses):
            with self.subTest(model=model.__name__):
                response = self.client.post(
                    self.admin_url(model, 'add'), self.form_data(model, 0),
                )
                if model is Report:
                    self.assertEqual(response.status_code, 200)
                    formset = response.context['inline_admin_formsets'][0].formset
                    self.assertTrue(formset.non_form_errors())
                    self.assertFalse(model.objects.exists())
                else:
                    self.assertEqual(response.status_code, 302)
                    self.assertEqual(model.objects.count(), 1)
                    self.assertEqual(model.objects.get().photos.count(), 0)

    def test_invalid_image_is_rejected(self):
        data = self.form_data(Report, 1)
        data['photos-0-image'] = SimpleUploadedFile(
            'invalid.png', b'not an image', content_type='image/png',
        )
        response = self.client.post(self.admin_url(Report, 'add'), data)
        self.assertEqual(response.status_code, 200)
        formset = response.context['inline_admin_formsets'][0].formset
        self.assertIn('image', formset.forms[0].errors)
        self.assertFalse(Report.objects.exists())
        self.assertFalse(ReportPhoto.objects.exists())

    def test_last_photo_is_required_only_for_reports(self):
        for model, photo_model, parent_field in (
            (Report, ReportPhoto, 'report'),
            (Expenses, ExpensePhoto, 'expense'),
        ):
            with self.subTest(model=model.__name__):
                obj = model.objects.create()
                photo = photo_model.objects.create(
                    **{parent_field: obj}, image=self.image_upload('existing.png'),
                )
                data = self.form_data(model, 0)
                data.update({
                    'photos-INITIAL_FORMS': '1',
                    'photos-0-id': str(photo.pk),
                    f'photos-0-{parent_field}': str(obj.pk),
                })
                url = self.admin_url(model, 'change', obj.pk)
                self.assertEqual(self.client.post(url, data).status_code, 302)

                data['photos-0-DELETE'] = 'on'
                response = self.client.post(url, data)
                if model is Report:
                    self.assertEqual(response.status_code, 200)
                    formset = response.context['inline_admin_formsets'][0].formset
                    self.assertTrue(formset.non_form_errors())
                    self.assertEqual(obj.photos.count(), 1)
                else:
                    self.assertEqual(response.status_code, 302)
                    self.assertEqual(obj.photos.count(), 0)

    def test_filtered_totals_do_not_count_each_photo_as_another_report(self):
        report = Report.objects.create(
            shift=Report.Shift.DAY, cards='10.10', spb='2.20', cash='3.30',
        )
        Report.objects.create(shift=Report.Shift.NIGHT, cards='100.00')
        for index in range(2):
            ReportPhoto.objects.create(
                report=report, image=self.image_upload(f'receipt-{index}.png'),
            )
        response = self.client.get(
            self.admin_url(Report, 'changelist'), {'shift__exact': 'day'},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.context['cl'].result_count, 1)
        self.assertEqual(response.context['selection_totals'][0]['value'], '15,60')
        self.assertEqual(response.context['cl'].result_list[0]._photo_count, 2)

    def test_navigation_and_readonly_photo_view_respect_model_permissions(self):
        user = get_user_model().objects.get(username='photo-admin')
        user.is_superuser = False
        user.user_permissions.add(
            Permission.objects.get(codename='view_expenses', content_type__app_label='reports'),
            Permission.objects.get(codename='view_expensephoto', content_type__app_label='reports'),
        )
        user.save()
        expense = Expenses.objects.create(amount='5.00')
        ExpensePhoto.objects.create(expense=expense, image=self.image_upload('receipt.png'))
        response = self.client.get(self.admin_url(Expenses, 'changelist'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual([item['label'] for item in response.context['reports_navigation']], ['Расходы'])
        response = self.client.get(self.admin_url(Expenses, 'change', expense.pk))
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'reports-photo-preview')
        self.assertNotContains(response, 'type="file"')
        self.assertNotContains(response, 'name="photos-0-DELETE"')
