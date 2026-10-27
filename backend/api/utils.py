import hashlib
import hmac
import time
from urllib.parse import parse_qsl
from django.conf import settings


def validate_telegram_data(init_data: str, bot_token: str) -> bool:
    if not isinstance(init_data, str) or not bot_token or len(init_data) > 16384:
        return False
    try:
        pairs = parse_qsl(init_data, strict_parsing=True)
        parsed = dict(pairs)
        if len(pairs) != len(parsed):
            return False
        received = parsed.pop('hash', '')
        age = time.time() - int(parsed['auth_date'])
        if age < -60 or age > settings.TELEGRAM_INIT_DATA_MAX_AGE:
            return False
        check = '\n'.join(f'{k}={v}' for k, v in sorted(parsed.items()))
        secret = hmac.new(b'WebAppData', bot_token.encode(), hashlib.sha256).digest()
        expected = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, received)
    except (ValueError, TypeError, KeyError, UnicodeError):
        return False
