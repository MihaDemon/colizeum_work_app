import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import bot


class ContactTests(unittest.IsolatedAsyncioTestCase):
    async def test_forwarded_contact_is_never_attested(self):
        message = SimpleNamespace(from_user=SimpleNamespace(id=101), contact=SimpleNamespace(user_id=102, phone_number='+79991234567'), answer=AsyncMock())
        with patch('bot.aiohttp.ClientSession') as session:
            await bot.verify_contact(message)
        session.assert_not_called()
        self.assertIn('own contact', message.answer.await_args.args[0])

    async def test_verified_contact_uses_internal_endpoint_and_service_secret(self):
        message = SimpleNamespace(from_user=SimpleNamespace(id=101), contact=SimpleNamespace(user_id=101, phone_number='+79991234567'), answer=AsyncMock())
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
        self.assertEqual(message.answer.await_count, 2)

    async def test_verification_connection_failure_is_reported_without_contact_details(self):
        message = SimpleNamespace(from_user=SimpleNamespace(id=101), contact=SimpleNamespace(user_id=101, phone_number='+79991234567'), answer=AsyncMock())
        with patch.dict('os.environ', {'BOT_SERVICE_TOKEN': 'test'}), patch('bot.aiohttp.ClientSession', side_effect=bot.aiohttp.ClientError()):
            await bot.verify_contact(message)
        self.assertIn('Cannot reach', message.answer.await_args.args[0])


if __name__ == '__main__':
    unittest.main()
