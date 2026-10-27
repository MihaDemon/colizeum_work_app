from django.db.models import ImageField
from django.db.models.fields.files import ImageFieldFile


class EvidenceFile(ImageFieldFile):
    @property
    def url(self):
        self._require_file()
        kinds = {'reportphoto': 'report', 'expensephoto': 'expense', 'task': 'reference', 'tasksubmission': 'submission', 'tasksubmissionphoto': 'submission-photo'}
        kind = kinds[self.instance._meta.model_name]
        return f'/api/files/{kind}/{self.instance.pk}/'


class EvidenceImageField(ImageField):
    """Keep file paths private in API serializers and Django's image widgets alike."""
    attr_class = EvidenceFile

    def deconstruct(self):
        name, path, args, kwargs = super().deconstruct()
        # Storage/schema match ImageField exactly. Historical migrations need
        # no runtime API dependency; only current file URL presentation changes.
        return name, 'django.db.models.ImageField', args, kwargs
