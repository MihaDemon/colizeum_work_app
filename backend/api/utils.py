import hashlib
import hmac
from urllib.parse import parse_qsl


def validate_telegram_data(init_data: str, bot_token: str) -> bool:
    """
    Validates the Telegram WebApp initData string using HMAC-SHA-256.
    """
    # Parse the query string into a dictionary
    parsed_data = dict(parse_qsl(init_data))

    # Extract the hash and remove it from the dictionary
    received_hash = parsed_data.pop('hash', None)
    if not received_hash:
        return False

    # Sort the remaining key-value pairs alphabetically by key
    data_check_string = '\n'.join(
        f"{k}={v}" for k, v in sorted(parsed_data.items())
    )

    # Generate the secret key (HMAC of bot token using 'WebAppData' as the key)
    secret_key = hmac.new(
        b"WebAppData", bot_token.encode(), hashlib.sha256
    ).digest()

    # Calculate the final hash
    calculated_hash = hmac.new(
        secret_key, data_check_string.encode(), hashlib.sha256
    ).hexdigest()

    # Compare securely
    return hmac.compare_digest(calculated_hash, received_hash)
