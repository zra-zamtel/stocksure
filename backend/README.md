# StockSure backend

Minimal Django + DRF service for the online identity moments: owner
email/password registration, magic-link sign-in, adding staff, a staff member's
first sign-in, and resetting a forgotten phone PIN. The phone keeps a local PIN
hash so counter sign-in works offline.

## Run it

```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
# source .venv/bin/activate

pip install -r requirements.txt
python manage.py migrate
# Demo only: turn on DEBUG and the token exposure flags.
# PowerShell:
$env:DJANGO_DEBUG="1"; $env:EXPOSE_EMAIL_TOKEN="1"; $env:EXPOSE_RESET_CODE="1"
python manage.py runserver 0.0.0.0:8000
```

`runserver 0.0.0.0:8000` matters when the app runs on a phone or emulator: the
phone must be able to reach the machine running Django.

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
- `200` idempotent retry of the same `id` and phone. The details may be
  corrected until the owner signs in on the phone.
- `409` `{"code": "phone_taken"}` or `{"code": "email_taken"}`.
- `409` `{"code": "id_conflict"}` when the same ID is used for another phone.
- `400` field errors for a bad phone, email or password, empty name, or a value
  that is not a PIN hash. The PIN itself is never sent or stored; the password
  is hashed with Django's password hasher.

`POST /api/v1/auth/login`

```json
{ "email": "elton@example.com", "password": "at least 8 characters" }
```

- `200` `{"owner": {...}, "deviceToken": "..."}`.
- `401` `{"code": "invalid_credentials"}`.
- This is the online sign-in for a new phone or after a forgotten PIN. The
  phone then calls `/auth/device-pin` to store its local PIN hash.

`POST /api/v1/auth/magic-link/request`

```json
{ "email": "elton@example.com" }
```

- `200` with `expiresAt`; in DEBUG also `demoToken` and `demoUrl`.
- The same generic response is returned for an unknown email, so the endpoint
  cannot be used to discover accounts.
- The link opens `stocksure://magic-link?token=...`, works once and expires in
  15 minutes. Development prints the email to the console; set
  `DJANGO_EMAIL_BACKEND` and `DJANGO_DEFAULT_FROM_EMAIL` for real delivery.

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
  "pin": "7315",
  "pinHash": "sha256$<32 hex salt>$<64 hex digest>"
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
  Never log it. Production must use HTTPS.

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

`EXPOSE_RESET_CODE` defaults to on in `DEBUG` so the demo can display the code.
Set it to `0` for a real deployment, where the code must go out through an SMS
provider instead.

`EXPOSE_EMAIL_TOKEN` defaults to on in `DEBUG` so the demo can open the magic
link without an inbox. Set it to `0` for a real deployment. The development
email backend prints messages to the server console; set `DJANGO_EMAIL_BACKEND`,
`DJANGO_DEFAULT_FROM_EMAIL` and `MAGIC_LINK_BASE_URL` for a deployed service.

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

## Deployment note

For anything beyond local development set `DJANGO_DEBUG=0`,
`DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS`, `EXPOSE_RESET_CODE=0`,
`EXPOSE_EMAIL_TOKEN=0`, a real email backend and serve the API over HTTPS.
SQLite is sufficient for the prototype.

## Not in this service yet

Owner email/password, magic links, staff identity and device PIN setup are
here. A staff member's shop data on a new phone still waits for sync and restore
(#4 and #6). The sync push/pull endpoints and USSD live in separate backend
issues.
