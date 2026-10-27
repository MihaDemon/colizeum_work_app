from django.urls import path
from workflows import views as work
from api.downloads import download_device_qr
from rest_framework.routers import DefaultRouter

from api.views import (
    AuthViewSet, CashRegisterViewSet, ExpensePhotoViewSet, ExpensesViewSet, HeadsetViewSet,
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
router.register(r'cash-register', CashRegisterViewSet, basename='cashregister')
router.register(r'report-photos', ReportPhotoViewSet, basename='reportphoto')
router.register(r'expense-photos', ExpensePhotoViewSet, basename='expensephoto')

router.register('shifts', work.ShiftViewSet, basename='shift')
router.register('tasks', work.TaskViewSet, basename='task')
urlpatterns = [
    path('device-qr/<str:ticket>/', download_device_qr, name='device-qr-download'),
    path('workspace/', work.workspace),
    path('shift-expenses/', work.expense),
    path('health/', work.health),
    path('files/<str:kind>/<int:pk>/', work.private_file),
    path('bot/contact/', work.bind_contact),
] + router.urls
