from io import BytesIO
from pathlib import Path
from textwrap import wrap

from PIL import Image, ImageDraw, ImageFont


def render_schedule(data):
    font_path = Path(__file__).parent / 'assets' / 'DejaVuSans.ttf'
    font = ImageFont.truetype(str(font_path), 25)
    small = ImageFont.truetype(str(font_path), 21)
    title = ImageFont.truetype(str(font_path), 36)
    rows = sorted({key.split('/')[0] for key in data['plan']})
    width, height = 1500, 190 + len(rows) * 130 + 120
    image = Image.new('RGB', (width, height), '#090a0d')
    draw = ImageDraw.Draw(image)
    draw.text((35, 25), 'COLIZEUM · Итоговый график смен', font=title, fill='#ffe500')
    draw.text((35, 80), f'{data["start"]} — {data["end"]} · версия {data["version"]}', font=font, fill='white')
    for x, text in ((35, 'Дата'), (245, 'Дневная смена'), (875, 'Ночная смена')):
        draw.text((x, 135), text, font=font, fill='#a7a8b2')
    for index, day in enumerate(rows):
        y = 180 + index * 130
        draw.line((35, y, width - 35, y), fill='#2b2c34', width=2)
        draw.text((35, y + 18), '.'.join(reversed(day.split('-'))), font=font, fill='white')
        for kind, x in (('day', 245), ('night', 875)):
            key = f'{day}/{kind}'
            proposed = data['plan'][key]
            planned = proposed['name'] if proposed else 'Не назначен'
            shifts = data['actual'].get(key, [])
            actual = ', '.join(dict.fromkeys(s['adminName'] for s in shifts)) if shifts else 'Нет отчёта'
            if shifts and any(not s['closedAt'] for s in shifts):
                actual += ' (открыта)'
            for line, text in enumerate(wrap('План: ' + planned, 40)[:2]):
                draw.text((x, y + 8 + line * 25), text, font=small, fill='#a7a8b2')
            actual_lines = wrap('Факт: ' + actual, 40)
            if len(actual_lines) > 2:
                actual_lines[1] += '…'
            for line, text in enumerate(actual_lines[:2]):
                draw.text((x, y + 63 + line * 25), text, font=small, fill='white')
    draw.text((35, height - 85), 'В календаре отображены фактические смены и сохранённые назначения.', font=small, fill='#a7a8b2')
    draw.text((35, height - 50), 'Подробности и назначения при открытии смены доступны в Mini App.', font=small, fill='#a7a8b2')
    result = BytesIO()
    image.save(result, format='PNG', optimize=True)
    return result.getvalue()
