import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import bot


class ContactTests(unittest.IsolatedAsyncioTestCase):
    async def test_start_offers_a_single_russian_launch_message(self):
        message = SimpleNamespace(answer=AsyncMock())
        with patch.dict('os.environ', {'WEBAPP_URL': 'https://test.invalid'}):
            await bot.start(message)
        message.answer.assert_awaited_once()
        launch = message.answer.await_args
        keyboard = launch.kwargs['reply_markup'].inline_keyboard
        self.assertEqual(len(keyboard), 1)
        self.assertEqual(len(keyboard[0]), 1)
        self.assertEqual(keyboard[0][0].web_app.url, 'https://test.invalid')
        self.assertIn('смены, задачи и оборудование клуба', launch.args[0])
        self.assertEqual(keyboard[0][0].text, 'Открыть Colizeum Work')

    async def test_forwarded_contact_is_never_attested(self):
        message = SimpleNamespace(from_user=SimpleNamespace(id=101), contact=SimpleNamespace(user_id=102, phone_number='+79991234567'), answer=AsyncMock(), delete=AsyncMock())
        with patch('bot.aiohttp.ClientSession') as session:
            await bot.verify_contact(message)
        session.assert_not_called()
        message.answer.assert_not_awaited()
        message.delete.assert_awaited_once()

    async def test_verified_contact_uses_internal_endpoint_and_service_secret(self):
        message = SimpleNamespace(from_user=SimpleNamespace(id=101), contact=SimpleNamespace(user_id=101, phone_number='+79991234567'), answer=AsyncMock(), delete=AsyncMock())
        response = MagicMock()
        response.__aenter__ = AsyncMock(return_value=SimpleNamespace(status=200))
        response.__aexit__ = AsyncMock(return_value=False)
        session = MagicMock()
        session.post.return_value = response
        context = MagicMock()
        context.__aenter__ = AsyncMock(return_value=session)
        context.__aexit__ = AsyncMock(return_value=False)
        with patch.dict('os.environ', {'BOT_SERVICE_TOKEN': 'test-secret', 'BACKEND_URL': 'http://backend:8000', 'WEBAPP_URL': 'https://test.invalid'}), patch('bot.aiohttp.ClientSession', return_value=context):
            await bot.verify_contact(message)
        session.post.assert_called_once_with('http://backend:8000/api/bot/contact/', json={'telegram_id': '101', 'phone_number': '+79991234567'}, headers={'X-Bot-Service-Token': 'test-secret'})
        message.answer.assert_not_awaited()
        message.delete.assert_awaited_once()

    async def test_verification_connection_failure_is_reported_without_contact_details(self):
        message = SimpleNamespace(from_user=SimpleNamespace(id=101), contact=SimpleNamespace(user_id=101, phone_number='+79991234567'), answer=AsyncMock(), delete=AsyncMock())
        with patch.dict('os.environ', {'BOT_SERVICE_TOKEN': 'test'}), patch('bot.aiohttp.ClientSession', side_effect=bot.aiohttp.ClientError()), self.assertLogs(level='WARNING') as logs:
            await bot.verify_contact(message)
        self.assertNotIn('9991234567', str(logs.output))
        message.answer.assert_not_awaited()
        message.delete.assert_awaited_once()


if __name__ == '__main__':
    unittest.main()
