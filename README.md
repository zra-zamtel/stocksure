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
├── app/            React Native app (Android), SQLite as the local source of truth
├── packages/core/  Shared TypeScript logic: pricing, stock, reconciliation, tax
├── backend/        Django + Django REST Framework: auth, sync, USSD, config files
└── docs/           Rules spec, data model and API contract, UX pack, demo script
```

- **Local first.** All reads and writes hit SQLite; screens never wait on the network.
- **Outbox sync.** Every change is queued and replayed when a connection returns.
  Records carry phone-generated IDs, so a replayed change is harmless.
- **Append-only stock.** Stock is a growing list of movements, so two phones
  cannot overwrite each other's counts.
- **Config, not code.** Tax rules and language strings are files the app ships
  with and refreshes from the backend.

See section 9 of the scope sheet for the full app/backend split.

## Status

Early build. The repository is scaffolded, the scope is locked, and the work is
tracked on the project board. Nothing runs yet — see the board for what is in
flight.

## Working agreements

- The demo path in section 12 of the scope sheet is built and polished first.
- Scope additions need a team decision, and something else comes out.
- Tax figures are clearly labelled as estimates, never as a tax return.
