#!/bin/sh
# Disposable integration stack. Requires Docker Compose, frontend dependencies,
# Node, and Playwright Chromium. Never reads or changes the deployment .env.
set -eu
cd "$(dirname "$0")/../.."
repo_dir=$(pwd)
smoke_dir=$(mktemp -d)
export ENV_FILE="$smoke_dir/.env"
export GATEWAY_PORT="${SMOKE_GATEWAY_PORT:-18080}"
stack_project="colizeum-smoke-$$"
cat > "$smoke_dir/compose-test.yaml" <<'OVERRIDE'
services:
  backend:
    ports:
      - "127.0.0.1::8000"
OVERRIDE
cat > "$ENV_FILE" <<'SETTINGS'
DJANGO_SECRET_KEY=docker-integration-test-only-secret
POSTGRES_PASSWORD=integration-test-only-password
BOT_SERVICE_TOKEN=integration-test-only-bot-service
TELEGRAM_BOT_TOKEN=123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
WEBAPP_URL=https://work.invalid
DJANGO_ALLOWED_HOSTS=localhost,127.0.0.1,backend
DJANGO_SECURE_COOKIES=False
OWNER_USERNAME=
SETTINGS
compose() { docker compose --env-file "$ENV_FILE" --project-directory "$repo_dir" -f "$repo_dir/compose.yaml" -f "$smoke_dir/compose-test.yaml" -p "$stack_project" "$@"; }
cleanup() {
    compose down -v --remove-orphans
    rm -rf "$smoke_dir"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
compose up -d --build --wait infra
compose exec -T backend python manage.py shell < frontend/tests/fixtures/seed_stack.py
compose run --rm --no-deps \
    -v "$repo_dir/backend/api:/app/api:ro" \
    -v "$repo_dir/backend/computers:/app/computers:ro" \
    -v "$repo_dir/backend/reports:/app/reports:ro" \
    -v "$repo_dir/backend/workflows:/app/workflows:ro" \
    -v "$repo_dir/backend/users:/app/users:ro" \
    backend python manage.py test api reports computers users workflows --noinput
cd frontend
STACK_BASE_URL="http://127.0.0.1:$GATEWAY_PORT" STACK_BOT_BASE_URL="http://$(compose port backend 8000)" npm run test:e2e -- stack.spec.ts --project=desktop
