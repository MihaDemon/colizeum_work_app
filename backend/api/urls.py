from rest_framework.routers import DefaultRouter

from api.views import AuthViewSet

router = DefaultRouter()

router.register(r'telegram', AuthViewSet, basename='telegram')

urlpatterns = router.urls
