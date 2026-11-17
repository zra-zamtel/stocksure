# StockSure backend

Minimal Django + DRF service for the online identity moments: owner
email/password registration, magic-link sign-in, adding staff, a staff member's
first sign-in, changing a staff PIN, and resetting a forgotten owner PIN. The
phone keeps a local PIN hash so counter sign-in works offline.

## Run it

On Windows, the repository root has a one-command setup:

```powershell
.\scripts\setup.ps1          # venv, dependencies, local-demo .env, migrations
.\scripts\start-backend.ps1  # migrate and run on 0.0.0.0:8000
```

The manual steps below do the same thing on any platform.

```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
# source .venv/bin/activate

pip install -r requirements.txt
# Windows PowerShell
Copy-Item .env.example .env
# macOS/Linux
# cp .env.example .env
# Edit backend/.env: set DJANGO_SECRET_KEY, or uncomment the local demo block.
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```

`runserver 0.0.0.0:8000` matters when the app runs on a phone or emulator: the
phone must be able to reach the machine running Django.

`.env` is a local convenience; every setting can also be exported as a real
environment variable, which wins over the file. It is git-ignored and must not
hold production secrets. Real email and Postgres are optional for local work
and are covered below.

The example is safe by default: debug and demo token exposure are off, and
`DJANGO_SECRET_KEY` is empty so the server refuses to start until one is set.
For a throwaway local demo, uncomment the "local demo" block in `.env.example`;
that turns debug on, shows the magic link and reset code in API responses, and
lets debug mode generate a development key. Do not use that block on a
deployed server. Generation for a real key:

```bash
python -c "import secrets; print(secrets.token_urlsafe(50))"
```

## Email

Magic-link sign-in sends one email. With no configuration, Django prints the
message and link to the server console, which is enough for local work. To
deliver real email, fill in the SMTP block in `.env`.

This project uses Gmail with an App Password. Brevo is the fallback if the
Google account is a Workspace account that blocks App Passwords, or if the demo
outgrows Gmail's daily sending limit.

### Gmail (project choice)

1. Turn on 2-Step Verification for the Google account.
2. Open **Google Account → Security → App passwords**.
3. Create an app password for Mail and copy the 16-character value (remove the
   spaces Google shows).
4. Put these values in `.env`:

```dotenv
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USE_TLS=1
EMAIL_USE_SSL=0
EMAIL_HOST_USER=your.address@gmail.com
EMAIL_HOST_PASSWORD=the16characterapppassword
DJANGO_DEFAULT_FROM_EMAIL="StockSure <your.address@gmail.com>"
```

Gmail rewrites the From header to the signed-in account, so keep
`DJANGO_DEFAULT_FROM_EMAIL` on the same address. If **App passwords** is
missing, 2-Step Verification is off or a Workspace administrator disabled it.

### Brevo (alternative)

1. Create a free account at [brevo.com](https://www.brevo.com).
2. Verify the sender address under **Senders**.
3. Create an SMTP key under **SMTP & API**.
4. Put these values in `.env`:

```dotenv
EMAIL_HOST=smtp-relay.brevo.com
EMAIL_PORT=587
EMAIL_USE_TLS=1
EMAIL_USE_SSL=0
EMAIL_HOST_USER=your-brevo-login@example.com
EMAIL_HOST_PASSWORD=your-smtp-key
DJANGO_DEFAULT_FROM_EMAIL="StockSure <the-verified-sender@example.com>"
```

`EMAIL_USE_SSL=1` means implicit TLS on port 465. Use TLS or SSL, never both.
Check the credentials before touching the app:

```bash
python manage.py sendtestemail you@example.com
```

Once real delivery works, set `EXPOSE_EMAIL_TOKEN=0` so the API stops returning
the demo token in its response. Keep it at `1` only when demonstrating without
an inbox.

## Database

SQLite at `backend/db.sqlite3` is the default and is all the prototype needs.
The deployed backend uses Supabase Postgres through `DATABASE_URL`; no code
change is needed:

```dotenv
DATABASE_URL=postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
```

### Supabase

1. Create a free project at [supabase.com](https://supabase.com) and wait for
   the database to finish provisioning.
2. Click **Connect → Session pooler (IPv4)** and copy the URI.
3. Replace `[YOUR-PASSWORD]` with the database password and keep
   `?sslmode=require`. URL-encode characters such as `@`, `#` or `/`.
4. Put the URI in `.env` as `DATABASE_URL`.
5. Run `python manage.py migrate` once.
6. Use the same value in the host's environment settings.

Use the **session pooler on port 5432** for a long-running Django process. It
is IPv4 and supports the session features migrations need. The direct
connection is IPv6-only on the free plan unless the IPv4 add-on is purchased.
The transaction pooler on port 6543 is for serverless functions: if you use it,
set `DB_DISABLE_SERVER_SIDE_CURSORS=1` and still run migrations through the
session pooler.

A free Supabase project pauses after a period of inactivity. Open the dashboard
before the demo to wake it. `DB_CONN_MAX_AGE` defaults to `0`; leave it there
for pooled or serverless Postgres.

Other managed options include Neon, Railway and Render, which use the same
`DATABASE_URL` pattern. To try the Postgres path locally before deploying,
Docker can provide a database:

```bash
# from the repository root
docker compose -f backend/docker-compose.yml up -d
# then in backend/.env
DATABASE_URL=postgresql://stocksure:stocksure-dev@127.0.0.1:5432/stocksure
python manage.py migrate
```

Tests run on SQLite by default even when `.env` points at Postgres, because
`manage.py test` skips the file. Export `DATABASE_URL` in the shell if you
deliberately want to run the suite against Postgres.

## Endpoints

`POST /api/v1/auth/register`

```json
{
  "id": "owner_m...",
  "name": "Elton Chiwala",
  "phone": "0971234567",
  "email": "elton@example.com",
  "password": "at least 8 characters",
  "pinHash": "sha256$<32 hex salt>$<64 hex digest>"
}
```

- `201` owner created. Response: `{"owner": {...}, "deviceToken": "..."}`.
  A verification magic link is emailed immediately. Delivery failure is logged
  but does not fail registration; the owner can request another link later.
- `200` idempotent retry of the same `id` and phone, within 10 minutes of
  creation and only with the same password and PIN hash. After that window the
  account must sign in normally, so this endpoint cannot mint device tokens
  forever.
- `409` `{"code": "phone_taken"}` or `{"code": "email_taken"}`. Only a verified
  email is reserved. An unverified claim is provisional: a later registration
  for that address replaces it, so an inbox address cannot be squatted forever.
  The real owner can then open a magic link to prove the address.
- `409` `{"code": "id_conflict"}` when the same ID is used for another phone.
- `400` field errors for a bad phone, email or password, empty name, or a value
  that is not a PIN hash. The PIN itself is never sent or stored; the password
  is hashed with Django's password hasher. The owner's `pinHash` is kept only
  to check this idempotent retry, never for sign-in; staff rows do not keep a
  copy at all.

`POST /api/v1/auth/login`

```json
{ "email": "elton@example.com", "password": "at least 8 characters" }
```

- `200` `{"owner": {...}, "deviceToken": "..."}`.
- `401` `{"code": "invalid_credentials"}`.
- `403` `{"code": "email_unverified"}` when the password is correct but the
  owner has not yet proved control of the inbox. Registration does not count as
  proof: open a magic link once, then password sign-in works.
- This is the online sign-in for a new phone or after a forgotten PIN. The
  phone then calls `/auth/device-pin` to store its local PIN hash.

`POST /api/v1/auth/magic-link/request`

```json
{ "email": "elton@example.com", "phone": "0971234567" }
```

- `200` with `expiresAt`; in DEBUG also `demoToken` and `demoUrl`.
- The same generic response is returned for an unknown email, so the endpoint
  cannot be used to discover accounts.
- `phone` is required only while the email is unverified. The owner knows the
  phone number on their own account; someone who merely received the email does
  not. Without the matching phone, an unverified address gets the generic
  response and no link, so an inbox owner cannot be signed in to a stranger's
  account. Once the email is verified, email alone is enough.
- The email names the account and phone it signs in to, so a person who did not
  create that account can recognise it and ignore the message.
- The link opens `stocksure://magic-link?token=...`, works once and expires in
  15 minutes. Development prints the email to the console; fill in the SMTP
  block (see [Email](#email)) for real delivery.

`POST /api/v1/auth/magic-link/verify`

```json
{ "token": "<token from the email link>" }
```

- `200` `{"owner": {...}, "deviceToken": "..."}` and marks the email verified.
- `400` `invalid_token`, `410` `expired_token`.

`POST /api/v1/auth/device-pin`

```json
{ "pinHash": "sha256$<32 hex salt>$<64 hex digest>" }
```

- Requires `Authorization: Bearer <deviceToken>`.
- Stores the salted PIN hash for offline sign-in on that phone.
- `401` `unauthorized` when the device token is missing or no longer valid.

`POST /api/v1/auth/logout`

- Requires `Authorization: Bearer <deviceToken>`.
- Revokes that device token. Device tokens expire after 30 days by default.

`POST /api/v1/auth/pin-reset/request`

```json
{ "phone": "0971234567" }
```

- `200` with `expiresAt`, plus `demoCode` while `EXPOSE_RESET_CODE` is on.
- `404` `{"code": "phone_not_found"}` when the number is not registered.

The code is six digits, hashed with Django's password hasher, expires after ten
minutes, and is replaced whenever a new code is requested.

`POST /api/v1/auth/pin-reset/confirm`

```json
{
  "phone": "0971234567",
  "code": "482913",
  "pinHash": "sha256$<32 hex salt>$<64 hex digest>"
}
```

- `200` owner details after the PIN hash is replaced.
- `400` `invalid_code`, `400` field errors, `410` `expired_code`, or `429`
  `too_many_attempts` (five tries).
- The phone stores the same new hash locally, so the next sign-in works offline.

`POST /api/v1/staff`

Requires `Authorization: Bearer <owner deviceToken>`.

```json
{
  "id": "staff_m...",
  "ownerId": "owner_m...",
  "name": "Given Phiri",
  "phone": "0965551122",
  "pin": "7315"
}
```

- `201` staff member created under the owner.
- `200` idempotent retry of the same `id` and phone. The existing PIN is never
  replaced by a retry.
- `401` `unauthorized` without a valid owner device token; `403` `forbidden`
  when the token belongs to another owner.
- `409` `{"code": "phone_taken"}` when the number is already an owner or staff
  account; `409` `{"code": "id_conflict"}` when the ID belongs to someone else.
- `pin` is used once to build a Django password hash for online first sign-in.
  The server does not store the phone's salted offline hash; the phone keeps
  that locally. Never log the PIN. Production must use HTTPS.

`POST /api/v1/staff/<staffId>/pin-reset`

Requires `Authorization: Bearer <owner deviceToken>`. Only the owner that the
staff member belongs to can call this.

```json
{
  "pin": "9042"
}
```

- `200` public staff details after the PIN verifier is replaced.
- `401` `unauthorized` without a valid owner device token.
- `404` `{"code": "staff_not_found"}` when the ID does not belong to this
  owner, so other shops' staff IDs stay private.
- `400` field errors for a bad PIN or a value that is not a PIN hash.
- A reset also clears failed sign-in attempts and any lock, so a locked-out
  staff member can start again with the new PIN.
- The owner's phone stores the same new hash locally, so the new PIN works
  offline there immediately. A phone that already cached the old hash keeps it
  until that person signs in online again; offline-first cannot revoke a hash
  from a disconnected phone.

`POST /api/v1/auth/staff-sign-in/confirm`

```json
{ "phone": "0965551122", "pin": "7315" }
```

- `200` staff and owner public details. The first success stamps
  `first_signed_in_at`.
- `401` `{"code": "invalid_credentials"}` for a wrong phone/PIN.
- `429` `{"code": "too_many_attempts"}` after five wrong tries; the account is
  locked for 15 minutes.
- After the first sign-in, the phone stores its own salted PIN hash, and later
  sign-ins are checked locally with no connection.

Both `EXPOSE_RESET_CODE` and `EXPOSE_EMAIL_TOKEN` are off by default. Set them
to `1` in `.env` for the demo so the app can show the reset code and open the
magic link without an inbox. They must be `0` in a real deployment: the reset
code goes out by SMS and the magic link goes to the owner's email.

`MAGIC_LINK_BASE_URL` controls the deep link in that email. The default,
`stocksure://magic-link`, matches the scheme in `mobile/app.json`; change it if
the scheme changes.

The app derives the backend host from the Expo development server. If that
does not work on your setup (an emulator, a tunnel, or a deployed server), set:

```bash
# macOS/Linux
EXPO_PUBLIC_API_URL=http://192.168.1.10:8000 npx expo start
```

```powershell
# Windows PowerShell
$env:EXPO_PUBLIC_API_URL="http://192.168.1.10:8000"; npx expo start
```

Restart Expo after changing it. Use HTTPS for a real deployment; the local HTTP
address is for development.

## Tests

```bash
cd backend
python manage.py test accounts
```

## Known limits

These are accepted for the MVP. They are listed so a reviewer can see the trade
off rather than discovering it later.

- An unverified email claim is last-come-wins. Registration now emails a
  verification link immediately, so a real owner normally verifies within
  minutes and their claim becomes protected. A later registration can still
  replace an unverified claim; that blocks email sign-in for the earlier owner,
  but the later claimant cannot verify without the earlier account's phone and
  the earlier owner can keep using the local phone account.
- A person who deliberately opens a magic link for an account they did not
  create can still verify it. The email names the account and phone and tells
  them to ignore it, and the unverified-email phone gate blocks the realistic
  path. Removing this fully needs double opt-in at registration plus duplicate
  unverified email rows.
- A phone that already cached a staff PIN keeps accepting it offline until that
  person signs in online again. The owner's phone picks up a reset immediately.
- Registration is idempotent for 10 minutes. A phone that lost the response and
  retries later must sign in normally instead.

## Deployment note

For anything beyond local development set:

- `DJANGO_DEBUG=0`
- `DJANGO_SECRET_KEY` to a long random value. Placeholder values such as
  `change-me` are rejected at startup.
- `DJANGO_ALLOWED_HOSTS` to the public host name. Startup fails when debug is
  off and this is empty.
- `EXPOSE_RESET_CODE=0` and `EXPOSE_EMAIL_TOKEN=0`
- `DATABASE_URL` from the Supabase session pooler, or keep SQLite on a
  persistent disk
- the Gmail SMTP values from [Email](#email), including
  `DJANGO_DEFAULT_FROM_EMAIL`
- HTTPS at the proxy, and an `https://` backend URL in the app

SQLite is sufficient for the prototype when the host keeps its disk; use a
managed Postgres when the host does not or when more than one process writes.
The PIN reset code still needs a real SMS provider in production; the demo flag
only exposes it in the API response.

## Not in this service yet

Owner email/password, magic links, staff identity and device PIN setup are
here. A staff member's shop data on a new phone still waits for sync and restore
(#4 and #6). The sync push/pull endpoints and USSD live in separate backend
issues.
