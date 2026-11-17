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

## Running the app

Requires **Node 24 LTS** (Expo 58 does not support odd-numbered releases such as 23.x).

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
needs one online moment so the backend can register the owner; after that,
PIN sign-in and the rest of the app work offline. The shop, products and sales
are stored in SQLite, and the remaining sync work is still being wired up. The
demo-shop seed remains in `mobile/src/db/seed.ts` for #41 and is not loaded
automatically.

### Registration backend

The one online call is a minimal Django + DRF service in `backend/`:

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```

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

See [`backend/README.md`](./backend/README.md).

## Status

The demo path is being built. Owner registration runs against the local Django
API. Onboarding, products, sales, reconciliation and TaxPot run against SQLite.
The rest of sync, USSD and the remaining demo steps are in flight — see the
board for what is next.

## Working agreements

- The demo path in section 12 of the scope sheet is built and polished first.
- Scope additions need a team decision, and something else comes out.
- Tax figures are clearly labelled as estimates, never as a tax return.
