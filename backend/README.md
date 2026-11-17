# StockSure backend

Minimal Django + DRF service. For now it exists for the one online moment in
account creation: registering an owner. The phone keeps its own copy and signs
in with the PIN offline.

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
python manage.py runserver 0.0.0.0:8000
```

`runserver 0.0.0.0:8000` matters when the app runs on a phone or emulator: the
phone must be able to reach the machine running Django.

## Endpoint

`POST /api/v1/auth/register`

```json
{
  "id": "owner_m...",
  "name": "Elton Chiwala",
  "phone": "0971234567",
  "pinHash": "sha256$<32 hex salt>$<64 hex digest>"
}
```

- `201` owner created.
- `200` idempotent retry of the same `id` and phone. The name and PIN hash may
  be corrected until the owner signs in on the phone.
- `409` `{"code": "phone_taken"}` for a duplicate phone number.
- `409` `{"code": "id_conflict"}` when the same ID is used for another phone.
- `400` field errors for a bad phone, empty name, or a value that is not a PIN
  hash. The PIN itself is never sent or stored.

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
`DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS`, and serve the API over HTTPS.
SQLite is sufficient for the prototype.

## Not in this service yet

PIN reset, staff sign-in, the sync push/pull endpoints and USSD live in the
separate backend issues. This service is only the registration moment.
