#!/bin/sh
set -eu
if [ "${1:-}" = "init" ]; then
    python manage.py migrate --noinput
    python manage.py collectstatic --noinput
    python manage.py bootstrap_owner
else
    exec "$@"
fi
