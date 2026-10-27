# Colizeum Work

Telegram Mini App for administrator shifts, cash expenses, task assignment and moderation, and club equipment. The app uses authenticated Django APIs. Managers see tasks they assigned or received; superusers can assign and review tasks across the team.

## Production setup

Use one root `.env` and the single nginx configuration at `infra/nginx.conf`.

1. Create the root `.env` from `.env.example` if you do not already have one. Fill in `DJANGO_SECRET_KEY`, PostgreSQL credentials, `TELEGRAM_BOT_TOKEN`, `BOT_SERVICE_TOKEN`, and your public `WEBAPP_URL`. Use independent random secrets, for example:

   ```sh
   python -c 'import secrets; print(secrets.token_urlsafe(48))'
   ```

2. Set `DJANGO_ALLOWED_HOSTS` to include your domain, `localhost`, `127.0.0.1`, and `backend`. Set `DJANGO_CSRF_TRUSTED_ORIGINS=https://your-domain`. Keep `DJANGO_SECURE_COOKIES=True` for HTTPS production.
3. Configure your host nginx to terminate HTTPS and proxy to `127.0.0.1:8000` (`GATEWAY_PORT` overrides this port). Forward the original `Host`, client IP headers, and `X-Forwarded-Proto=$scheme`. The internal gateway preserves that trusted protocol header.
4. Start the services:

   ```sh
   docker compose up -d --build
   docker compose ps -a
   docker compose logs migrate backend scheduler telegram_bot infra
   ```

5. Set the bot's Mini App URL in BotFather to `WEBAPP_URL`. Start a private chat with the bot before expecting notifications. Run one polling bot per token; remove an old webhook intentionally before switching a bot to polling.

| Service | Purpose |
| --- | --- |
| `db` | PostgreSQL 16 |
| `migrate` | Apply migrations, collect Django static files, optionally create the initial owner |
| `backend` | Django/Gunicorn, internal port 8000 |
| `scheduler` | Deliver queued Telegram task notifications |
| `frontend` | Publish compiled React assets to the shared volume |
| `telegram_bot` | Launch the Mini App and process contacts requested inside it |
| `infra` | nginx gateway, bound to localhost only |

`migrate` and `frontend` are one-time jobs; **Exited (0)** is their normal state. The gateway waits for the backend and frontend assets. Rebuild after source changes with `docker compose up -d --build --force-recreate`.

The frontend runtime contains compiled assets only. Backend and bot images exclude tests, development artifacts, local databases, credentials, and uploads. There is no demo route or development-token login. For local frontend development, Vite also reads the root `.env`; only `VITE_*` variables are exposed to the browser. Never use that prefix for secrets.

## Owner and staff access

Set `OWNER_USERNAME`, a strong `OWNER_PASSWORD`, and optionally `OWNER_TELEGRAM_ID` before the first startup. Initialization creates this superuser only if the username does not already exist. Subsequent starts do not overwrite its access or password. Alternatively:

```sh
docker compose exec backend python manage.py createsuperuser
```

The superuser opens `/admin/` → **Администраторы** and creates an `AdminUser` with the person's first name, surname, phone number, and role: **Администратор** (`admin`) or **Управляющий** (`manager`). Phone numbers may be entered as 10 digits, with `+7`, or with `8`; new records store 10 digits. No Telegram ID, username, or password is needed at this step, and no `User` account is created yet.

The person sends `/start` to the bot, opens the Mini App, and shares their own contact using **Подтвердить телефон Telegram**. The verified phone must match the staff record. The person chooses a username and completes registration, which creates a normal `User` linked to that `AdminUser`, copying the name, surname, and selected role. Administrator accounts have `is_staff=False`; manager accounts have `is_staff=True`. Neither gets superuser permissions. There is no bot contact keyboard, manual phone entry, or password step. Telegram 6.9 or newer is required for the contact popup. Existing accounts sign in automatically.

The Telegram ID on `AdminUser` is filled automatically and is read-only in Django administration. Changing an existing staff record's role updates its linked account's administrator/manager permissions; changing names updates the linked account's names. The phone key is read-only after creation to preserve account links. Set `User.is_active=False` to revoke access. A superuser using the Mini App needs their numeric Telegram ID linked to their Django `User`.

## Shift, task, and cash behavior

- Only one shift can be open. Its administrator chooses day/night at opening, and that stored type is used at closing.
- Closing requires cash, card, SBP, an administrator desk photo, and a closing receipt photo. Cash means **revenue collected during the shift**. Only that cash revenue increases the register; card and SBP do not.
- Expenses require a positive amount and description, optionally a receipt photo. They reduce cash and cannot overdraw the register.
- Managers assign the current shift administrator. Superusers can assign administrators or managers, including personal tasks without an active shift. Superusers cannot receive tasks.
- Administrators complete tasks during their own shift; managers may complete personal tasks without one. Required completion photos are enforced by Django.
- Submitted tasks remain **On moderation** until the assigning manager or a superuser accepts them. Rejection requires a reason and returns the task for rework. Submission and review history is retained.
- Shift history, including cash + card + SBP totals, is under **More**. The active shift and cash balance remain visible on the management task screen. Imported reports show their recorded dates without invented shift times.
- Device lookup uses Telegram's native camera QR scanner. Inventory browsing and staff editing remain available.
- QR downloads use Telegram's native download dialog (version 8.0+) or an external browser on older clients. Each click creates a fresh link valid for five minutes and limited to one QR PNG; the link contains no API token. The server sends attachment and Telegram Web CORS headers. Inventory APIs still require authentication.

Photos accept validated JPG, PNG, or WebP files up to 5 MB each. Evidence is served through authenticated `/api/files/` requests. nginx blocks direct `/media/` and public `/api/bot/` access.

Cash commands use transactions and retry keys to avoid duplicate charges. Task submission queues a Telegram notification in the same transaction. The worker retries delivery failures with backoff, up to ten attempts. An interruption after Telegram accepts a message can produce a duplicate notification; it does not duplicate the task submission or cash operation.

Inspect notification failures in Django administration. After fixing chat access or bot configuration, a superuser can retry failed jobs there or run:

```sh
docker compose exec backend python manage.py dispatch_notifications --retry-failed
```

## Operations and existing data

Persistent volumes are `postgres_data`, `django_media`, `django_static`, and `frontend_build`. Back up both the database and uploaded media:

```sh
docker compose exec db sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > backup.sql
docker compose exec backend python manage.py check
docker compose logs -f backend scheduler telegram_bot
```

`docker compose down` preserves data. `docker compose down -v` deletes the project's volumes.

Existing local SQLite files, backups, and uploaded media are preserved and excluded from images. Compose uses a separate PostgreSQL database. To import old data, stop writes, back up SQLite/media, migrate a backup copy with the updated code, export it with `dumpdata` excluding content types, auth permissions, sessions, and auth tokens, and import into an empty initialized PostgreSQL database with `OWNER_USERNAME=`. Copy uploads into `django_media` with ownership `10001:10001` and verify balances/counts/photos before switching traffic. Financial corrections belong in Django administration, which records an audit log.

An earlier PostgreSQL 17 deployment's volumes are not automatically reused by this PostgreSQL 16 setup. Use dump/restore and copy media before switching; PostgreSQL 17 data directories cannot be attached directly to PostgreSQL 16.

## Tests

Tests remain in the repository for maintenance and are excluded from production images. Install backend and bot requirements in their own virtual environments and run:

```sh
cd backend
python manage.py test api reports computers workflows
cd ../bot
python -m unittest tests
cd ../frontend
npm ci
npm test
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
```

The optional `frontend/tests/run-stack.sh` creates a disposable Docker stack with temporary dummy settings outside the repository, seeds test staff, runs the backend and real browser workflow, and removes that test project's containers and volumes. It mounts backend test sources only into the test container. Port 18080 must be free (`SMOKE_GATEWAY_PORT` overrides it). The real bot and notification worker are not started. Concurrency tests run on PostgreSQL and are skipped on SQLite.

Local Vite development uses `npm run dev` from `frontend` and the root `API_PROXY_TARGET` setting. Authentication uses Telegram, including locally via an HTTPS tunnel. Verify real phone camera permissions and live Telegram delivery against your configured bot and public HTTPS domain.
