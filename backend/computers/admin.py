from django.contrib import admin

from computers.models import Keyboard, Monitor, Mouse, Gamepad, PC, Station, PlayStation, PlayStationGamepad


class DeviceAdmin(admin.ModelAdmin):
    list_display = ('model', 'serial_number', 'warranty_until')
    search_fields = ('model', 'serial_number')
    ordering = ('model',)


@admin.register(Mouse)
class MouseAdmin(DeviceAdmin):
    pass


@admin.register(Keyboard)
class KeyboardAdmin(DeviceAdmin):
    pass


@admin.register(Monitor)
class MonitorAdmin(DeviceAdmin):
    pass


@admin.register(Gamepad)
class GamepadAdmin(DeviceAdmin):
    pass


class PlayStationGamepadInline(admin.TabularInline):
    model = PlayStationGamepad
    autocomplete_fields = ['gamepad']
    extra = 0


@admin.register(PlayStation)
class PlayStationAdmin(admin.ModelAdmin):
    list_display = ['club_number', 'serial_number', 'warranty_until']
    search_fields = ['serial_number']
    inlines = [PlayStationGamepadInline]


@admin.register(PC)
class PCAdmin(admin.ModelAdmin):
    list_display = (
        'serial_number', 'cpu', 'gpu', 'ram', 'storage', 'warranty_until'
    )
    search_fields = ('serial_number', 'cpu', 'gpu', 'ram', 'storage')
    ordering = ('serial_number',)


@admin.register(Station)
class StationAdmin(admin.ModelAdmin):
    list_display = ('club_number', 'pc', 'monitor', 'keyboard', 'mouse')
    search_fields = (
        '=club_number',
        'pc__serial_number',
        'monitor__serial_number',
        'keyboard__serial_number',
        'mouse__serial_number',
    )
    ordering = ('club_number',)
    list_select_related = ('pc', 'monitor', 'keyboard', 'mouse')
    autocomplete_fields = ('pc', 'monitor', 'keyboard', 'mouse')
