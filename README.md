# StockSure

Offline-first stock, sales and tax companion for small shop owners in Zambia.

Built for the **ZRA–Zamtel Innovation Challenge 2026, Theme 2**.

> A shop owner records a sale on a phone with no signal, stock drops, a low-stock
> alert fires, mobile money takings are checked against the sales book, and the
> turnover tax they are likely to owe is visible — before the bill arrives.

## The problem

Small shops that already write down each sale and count stock by hand cannot see
what is running out, what they really earn after buying costs and discounts, or
whether their mobile money takings match their sales book. Tax then arrives as a
surprise.

## What the MVP does

Eight modules on one offline-first base:

| # | Module | What it covers |
| --- | --- | --- |
| A | Account and onboarding | Account, shop setup, staff, Home screen |
| B | Products and stock | Products, variants, barcodes, prices, discounts, low-stock alerts |
| C | Sales | Sales with discounts, cash or mobile money, void |
| D | Reconciliation (MerchantMatch) | Daily check of sales against mobile money and counted cash |
| E | Tax and TaxPot | Turnover tax estimate, simulated savings wallet, due-date reminders |
| F | USSD simulator | Africa's Talking sandbox menus for basic phones |
| G | Languages | English and Nyanja |
| H | Offline-first sync | Works offline, syncs via an outbox when a connection returns |

**Not in the MVP:** TaxMate assistant, admin analytics, real mobile money or ZRA
integration, multiple shops, supplier orders, receipt printing.

The full single source of truth is
[`StockSure MVP Scope Sheet.md`](./StockSure%20MVP%20Scope%20Sheet.md). Anything
not written there is not in the MVP.

## Architecture

Business logic lives in the app, because a sale must be priced and stock
deducted with no signal. The backend is for identity, backup, sync and USSD.

```
StockSure/
├── mobile/         Expo + React Native app (Android), SQLite as the local source of truth
├── backend/        Django + Django REST Framework: auth, sync, USSD, config files
├── docs/           Rules spec, data model and API contract, UX pack, demo script
└── packages/core/  Shared TypeScript logic: pricing, stock, reconciliation, tax (not created yet)
```

Until `packages/core` exists, the framework-free logic lives in `mobile/src/lib`, `mobile/src/data`
and `mobile/src/theme`, so it can be lifted out without touching screens.

Screens use expo-router with routes in `mobile/src/app`:

- `(tabs)/` Home, Products, Sales, Reconcile, Tax
- `onboarding/` language, account, shop, money, first products
- `product/`, `sale/`, `tax/pot`, `settings`, `staff`

- **Local first.** All reads and writes hit SQLite; screens never wait on the network.
- **Outbox sync.** Every change is queued and replayed when a connection returns.
  Records carry phone-generated IDs, so a replayed change is harmless.
- **Append-only stock.** Stock is a growing list of movements, so two phones
  cannot overwrite each other's counts.
- **Config, not code.** Tax rules and language strings are files the app ships
  with and refreshes from the backend.

See section 9 of the scope sheet for the full app/backend split.

## Team

Five people, one owner per area.

| Person | Role | Owns | GitHub |
| --- | --- | --- | --- |
| Tabo | Backend developer | The API and database, accounts and roles, sync and backup | [@TaboMwewa](https://github.com/TaboMwewa) |
| Elton | Mobile developer | React Native screens; stock, reconciliation and tax logic on the phone; local database and sync; barcode scanning; payment message reading; USSD menus | _handle pending_ |
| Henry | QA and demo data | Testing each piece, the seeded demo shop with one fixed shortfall, checking the tax rules, checking the Nyanja wording | _handle pending_ |
| Given | Designer and storyteller | Colours, logo, fonts, wording sheet, components, MVP screens, clickable demo flow, visual story | _handle pending_ |
| Happy | Pitch lead | Demo script, PowerPoint, video and the live presentation | [@happymukande](https://github.com/happymukande) |

## Quick start (Windows PowerShell)

Prerequisites: **Python 3.10+**, **Node 26 LTS** (see `mobile/.nvmrc`) and npm.

```powershell
# First time only: create backend/.venv, install both sides, create backend/.env
# with local-demo settings, and apply SQLite migrations.
.\scripts\setup.ps1

# Start Django and Expo in two windows.
.\scripts\start.ps1
```

The backend prints its URL (`http://localhost:8000`). In the Expo window, scan
the QR code with Expo Go or press `a` for the Android emulator.

If PowerShell blocks local scripts, either run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1
```

or allow signed local scripts once:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Other entry points:

```powershell
.\scripts\start-backend.ps1          # Django only; -Port 8001 to change the port
.\scripts\start-mobile.ps1           # Expo only
.\scripts\test.ps1                   # backend tests, mobile tests, typecheck, lint
.\scripts\test.ps1 -BackendOnly      # one side only
```

`setup.ps1` only creates `backend/.env` when it is missing. That generated file
uses the **local-demo profile**: debug on, and email codes and PIN reset
codes shown in API responses. Never use it on a deployed server; see
`backend/.env.example` for SMTP, Postgres and safe defaults.

If a physical phone cannot reach Django, allow port 8000 through Windows
Firewall (Private networks), and make sure the phone and laptop are on the same
Wi-Fi. The app normally derives the backend address from Expo; if the network
setup is unusual, start Expo with:

```powershell
$env:EXPO_PUBLIC_API_URL="http://<your-lan-ip>:8000"; npx expo start
```

## Testing on a phone

Every change merged to `main` builds an installable Android APK and publishes it
as the **Latest test build** release. How to install it and how the pipeline
works: [`docs/mobile-releases.md`](./docs/mobile-releases.md).

## Running the app

Requires **Node 26 LTS** (see `mobile/.nvmrc`; Expo 58 does not support
odd-numbered releases such as 23.x or 25.x).

```bash
cd mobile
npm install
npx expo start          # press "a" for the Android emulator or scan the QR code
```

For a development build, which the SMS reader (#36) will need:

```bash
cd mobile
npx expo prebuild --platform android
npx expo run:android
```

A fresh install starts at the language and account screens. Account creation
needs one online moment so the backend can register the owner's email and
password; the phone PIN is then set for fast offline sign-in and the rest of the
app works offline. The owner can sign in on a new phone, or recover a forgotten
PIN, with email and password. Adding staff also needs one online
moment, and so does that staff member's first sign-in on a phone. The shop,
products and sales are stored in SQLite, and the remaining sync work is still
being wired up. The demo-shop seed remains in `mobile/src/db/seed.ts` for #41
and is not loaded automatically.

### Registration backend

The online identity calls are a minimal Django + DRF service in `backend/`:
owner registration, email sign-in with a confirmation code, staff sign-in and PIN resets.
Everything else stays on the phone.

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
# Windows: Copy-Item .env.example .env
# macOS/Linux: cp .env.example .env
# Edit .env: set DJANGO_SECRET_KEY, or uncomment the local demo block.
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```

`.env.example` is safe by default: set `DJANGO_SECRET_KEY`, or uncomment its
local-demo block to turn on `DJANGO_DEBUG`, the email code and the PIN
reset code for a throwaway machine. To send real email, fill in the
Gmail SMTP block; to use Supabase Postgres, set `DATABASE_URL`. Both are
optional for local work; the backend README has the steps.

The app derives the backend host from the Expo development server. If that does
not work on your setup (an emulator, a tunnel or a deployed server), start Expo
with:

```bash
# macOS/Linux
EXPO_PUBLIC_API_URL=http://<host>:8000 npx expo start
```

```powershell
# Windows PowerShell
$env:EXPO_PUBLIC_API_URL="http://<host>:8000"; npx expo start
```

See [`backend/README.md`](./backend/README.md). For the USSD demo, the
Africa's Talking sandbox setup and callback URL are in
[`docs/ussd-africas-talking.md`](./docs/ussd-africas-talking.md).

To host the backend on AWS Lambda for the demo, follow
[the Lambda deployment section](./backend/README.md#deploy-to-aws-lambda).

## Status

The demo path is being built. Owner email/password registration, emailed-code
confirmation, staff registration, a staff member's first sign-in, owner and staff PIN
resets run against the local Django API. Password sign-in requires a verified
email; type the 6-digit code emailed at sign-up (or at the first password
sign-in) to confirm it. Onboarding, products, sales, reconciliation
and TaxPot run against SQLite, with staff roles gated by the same permission
matrix in the app and on the routes. The rest of sync, USSD and the remaining
demo steps are in flight — see the board for what is next.

## Working agreements

- The demo path in section 12 of the scope sheet is built and polished first.
- Scope additions need a team decision, and something else comes out.
- Tax figures are clearly labelled as estimates, never as a tax return.
