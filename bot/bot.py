"""Private staff bot: verified contact registration and a Telegram Mini App launch button."""
import asyncio
import logging
import os
from pathlib import Path

import aiohttp
from aiogram import Bot, Dispatcher, F, types
from aiogram.enums import ChatType
from aiogram.filters import CommandStart
from aiogram.types import (BotCommand, InlineKeyboardButton, InlineKeyboardMarkup,
                           KeyboardButton, MenuButtonWebApp, ReplyKeyboardMarkup,
                           ReplyKeyboardRemove, WebAppInfo)
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / '.env')
dp = Dispatcher()


def launch_keyboard():
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text='Open Colizeum Work', web_app=WebAppInfo(url=os.environ['WEBAPP_URL']))
    ]])


@dp.message(CommandStart(), F.chat.type == ChatType.PRIVATE)
async def start(message: types.Message):
    await message.answer('Colizeum Work — shifts, tasks, and equipment.\n'
                         'For first-time registration, verify your own phone number below. Your manager must first add you to the staff list.',
                         reply_markup=ReplyKeyboardMarkup(keyboard=[[
                             KeyboardButton(text='Verify my phone number', request_contact=True)
                         ]], resize_keyboard=True, one_time_keyboard=True))
    await message.answer('Open your work app:', reply_markup=launch_keyboard())


@dp.message(F.contact, F.chat.type == ChatType.PRIVATE)
async def verify_contact(message: types.Message):
    if not message.from_user or message.contact.user_id != message.from_user.id:
        await message.answer('Please use “Verify my phone number” to share your own contact.')
        return
    headers = {'X-Bot-Service-Token': os.environ['BOT_SERVICE_TOKEN']}
    payload = {'telegram_id': str(message.from_user.id), 'phone_number': message.contact.phone_number}
    try:
        timeout = aiohttp.ClientTimeout(total=15)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(os.getenv('BACKEND_URL', 'http://backend:8000') + '/api/bot/contact/', json=payload, headers=headers) as response:
                status = response.status
        if status == 200:
            await message.answer('Phone verified. Open the app to finish registration.', reply_markup=ReplyKeyboardRemove())
            await message.answer('Your work app:', reply_markup=launch_keyboard())
        elif status in (400, 403, 404):
            await message.answer('Your number is not available for registration. Ask your manager to check the staff list and account link.')
        else:
            await message.answer('Verification is temporarily unavailable. Please try again shortly.')
    except (aiohttp.ClientError, asyncio.TimeoutError):
        await message.answer('Cannot reach the work app. Please try again shortly.')


async def main():
    for key in ['TELEGRAM_BOT_TOKEN', 'WEBAPP_URL', 'BOT_SERVICE_TOKEN']:
        if not os.getenv(key):
            raise RuntimeError(f'{key} must be configured.')
    if not os.environ['WEBAPP_URL'].startswith('https://'):
        raise RuntimeError('WEBAPP_URL must be a public HTTPS URL.')
    async with Bot(token=os.environ['TELEGRAM_BOT_TOKEN']) as bot:
        await bot.set_my_commands([BotCommand(command='start', description='Open Colizeum Work')])
        await bot.set_chat_menu_button(menu_button=MenuButtonWebApp(text='Work', web_app=WebAppInfo(url=os.environ['WEBAPP_URL'])))
        # Polling intentionally preserves updates; only run one bot process per token.
        await dp.start_polling(bot)


if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
