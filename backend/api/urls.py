from rest_framework.routers import DefaultRouter

from api.views import (
    AuthViewSet, ExpensePhotoViewSet, ExpensesViewSet, HeadsetViewSet,
    KeyboardViewSet, MonitorViewSet, MouseViewSet, PCViewSet,
    PlayStationViewSet, ReportPhotoViewSet, ReportViewSet, StationViewSet,
)

router = DefaultRouter()

router.register(r'telegram', AuthViewSet, basename='telegram')
router.register(r'mice', MouseViewSet, basename='mouse')
router.register(r'keyboards', KeyboardViewSet, basename='keyboard')
router.register(r'headsets', HeadsetViewSet, basename='headset')
router.register(r'monitors', MonitorViewSet, basename='monitor')
router.register(r'pcs', PCViewSet, basename='pc')
router.register(r'playstations', PlayStationViewSet, basename='playstation')
router.register(r'stations', StationViewSet, basename='station')
router.register(r'reports', ReportViewSet, basename='report')
router.register(r'expenses', ExpensesViewSet, basename='expenses')
router.register(r'report-photos', ReportPhotoViewSet, basename='reportphoto')
router.register(r'expense-photos', ExpensePhotoViewSet, basename='expensephoto')

urlpatterns = router.urls
