from io import BytesIO
from pathlib import Path
from textwrap import wrap

from PIL import Image, ImageDraw, ImageFont

from .models import ScheduleContent


def render_schedule(data, content=ScheduleContent.BOTH):
    font_path = Path(__file__).parent / 'assets' / 'DejaVuSans.ttf'
    font = ImageFont.truetype(str(font_path), 25)
    small = ImageFont.truetype(str(font_path), 21)
    title = ImageFont.truetype(str(font_path), 36)
    days = sorted({key.split('/')[0] for key in data['plan']} | {key.split('/')[0] for key in data['actual']})
    rows = []
    for day in days:
        cells = []
        for kind in ('day', 'night'):
            key = f'{day}/{kind}'
            lines = []
            if content != ScheduleContent.ACTUAL:
                proposed = data['plan'].get(key)
                planned = proposed['name'] if proposed else 'Не назначен'
                lines.extend((text, '#a7a8b2') for text in wrap('План: ' + planned, 40))
            if content != ScheduleContent.PLAN:
                shifts = data['actual'].get(key, [])
                actual = ', '.join(dict.fromkeys(s['adminName'] for s in shifts)) if shifts else 'Нет смены'
                if shifts and any(not s['closedAt'] for s in shifts):
                    actual += ' (открыта)'
                lines.extend((text, 'white') for text in wrap('Факт: ' + actual, 40))
            cells.append(lines)
        rows.append((day, cells, max(75, 24 + max(map(len, cells)) * 27)))
    width, height = 1500, 190 + sum(row[2] for row in rows) + 80
    image = Image.new('RGB', (width, height), '#090a0d')
    draw = ImageDraw.Draw(image)
    draw.text((35, 25), 'COLIZEUM · График смен', font=title, fill='#ffe500')
    mode = ScheduleContent(content).label
    draw.text((35, 80), f'{data["start"]} — {data["end"]} · версия {data["viewVersion"]} · {mode}', font=font, fill='white')
    for x, text in ((35, 'Дата'), (245, 'Дневная смена'), (875, 'Ночная смена')):
        draw.text((x, 135), text, font=font, fill='#a7a8b2')
    y = 180
    for day, cells, row_height in rows:
        draw.line((35, y, width - 35, y), fill='#2b2c34', width=2)
        draw.text((35, y + 18), '.'.join(reversed(day.split('-'))), font=font, fill='white')
        for x, lines in zip((245, 875), cells):
            for index, (text, color) in enumerate(lines):
                draw.text((x, y + 12 + index * 27), text, font=small, fill=color)
        y += row_height
    draw.text((35, height - 50), 'Снимок графика на момент подготовки изображения. Подробности — в Mini App.', font=small, fill='#a7a8b2')
    result = BytesIO()
    image.save(result, format='PNG', optimize=True)
    return result.getvalue()
