# StockSure backend (Django + Django REST Framework)

One API behind both views (owner and assistant). Every feature reuses the same sales data, so a sale
is entered once and feeds stock, money matching, the ledger, tax estimate, TaxPot and TaxMate.

**Stack:** Django 5.2, DRF, SimpleJWT (phone + password/PIN), PostgreSQL (SQLite in dev), drf-spectacular (API docs).
**Mocked behind interfaces:** Zamtel payments, SMS, USSD gateway, AI invoice reading, ZRA. Swap a dotted path in `.env` to go live.

---

## Setup (do this after reading)

```bash
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                    # SQLite by default; set DATABASE_URL for PostgreSQL
python manage.py makemigrations accounts shops inventory sales reconciliation ledger tax taxpot taxmate notifications
python manage.py migrate
python manage.py seed_demo --reset                      # demo shop, users, placeholder tax rules, TaxMate content
python manage.py test tests                             # run the test suite
python manage.py runserver
```

- API docs (try every endpoint): http://localhost:8000/api/docs/
- Django admin (tax rules, TaxMate content, users): http://localhost:8000/admin/
- Demo logins are printed by `seed_demo` (owner `0970000001` / `demo1234`, assistant `0970000002` / `1234`).
- Migrations are not committed yet: `makemigrations` creates them on your machine. Commit them afterwards.
- PostgreSQL: `docker compose up -d db`, then `DATABASE_URL=postgres://stocksure:stocksure-dev@localhost:5432/stocksure` in `.env`.

> The code was written without being able to run Django in the authoring environment, so it has been
> syntax-checked and linted but **not executed**. Run the tests first; expect a few small fixes.

## Auth (mobile app and domain clients)

`apps/accounts` is the one account layer. It keeps Tabo's `User` + `Membership`
+ JWT model and adds the mobile-side pieces:

- `POST /api/auth/register` (and `/api/v1/auth/register`) — owner signup, optional
  `shop_name` (a placeholder shop and owner Membership are created when it is
  omitted), phone-generated `id` for safe retries. A verification magic link
  is emailed automatically. The phone's PIN hash is validated and discarded.
- `POST /api/auth/login` — email + password for the app (blocked until the email
  is verified) or phone + password for domain clients.
- `POST /api/auth/magic-link/request` and `/verify` — single-use, 15-minute link;
  while the email is unverified the request must also name the account phone.
- `POST /api/auth/refresh`, `/logout` — JWT rotation and refresh-token blacklist.
- `POST /api/auth/device-pin` — accepts the JWT after an email login; the server
  does not store the phone PIN hash.
- `POST /api/auth/pin-reset/request` and `/confirm` — 6-digit code, hashed and
  single-use; the new PIN hash is never stored.
- `POST /api/auth/staff` — owner-authenticated staff User + assistant Membership
  + Django PIN verifier.
- `POST /api/auth/staff-sign-in/confirm` — first sign-in by phone + PIN, with a
  5-try / 15-minute lockout.
- `POST /api/auth/staff/<id>/pin-reset` — owner-only replacement of a staff PIN.

The phone PIN remains the offline unlock. The server keeps only a Django
`make_password` verifier for staff first sign-in; it never stores the phone's
salted SHA-256 PIN hash.

---

## Phases (build order from the proposal: each module works end to end before the next)

### Phase 1: Foundation (`accounts`, `shops`, `core`)
Phone-number login, JWT, owner registration with first shop, assistants added by the owner (they get a PIN).
Roles live on `Membership` (owner / assistant). Every shop-level endpoint is scoped to one shop via the
`X-Shop-ID` header (optional when the user has a single shop, which is always true for assistants).
`core/shop_scope.py` enforces this and the role rules in one place.
- `POST /api/auth/register/` `POST /api/auth/login/` `POST /api/auth/refresh/` `GET /api/auth/me/`
- `GET/POST /api/shops/`, `GET/POST /api/shops/{id}/assistants/`
- Shop `mode`: **lite** (sales and money only) or **full** (adds stock, the complete three-way match).

### Phase 2: Core three-way match (`inventory`, `sales`, `reconciliation`), the heart of the product
- **Stock register:** `/api/items/` (+ `lookup/?code=`, `bulk/`, `{id}/receive/`, `{id}/adjust/`, `{id}/label/`, `{id}/movements/`).
  Quantity only changes through `StockMovement` rows (append-only), so stock-taking can audit every change.
  Bulk entry takes `"sizes": "40-44"`. Each item gets a `label_code` for QR/barcode labels (photo-to-label); factory barcodes are supported too.
- **Supplier invoice photo (the MVP AI feature):** `POST /api/invoice-scans/` (image) returns suggested lines;
  `POST /api/invoice-scans/{id}/confirm/` adds them to stock. Nothing touches stock until a person confirms.
  Uses a mock reader by default; set `AI_INVOICE_READER=apps.integrations.ai.AnthropicInvoiceReader` and `ANTHROPIC_API_KEY` for real reading.
- **Quick sale entry:** `POST /api/sales/` with items (Full) or an `amount` (Lite). Send a phone-generated `client_id`
  so retries and offline syncing never double-record; `POST /api/sales/sync/` takes a batch. Only the owner can void.
- **Money matching:** `POST /api/payments/simulate/` pretends Zamtel notified a payment. A mobile-money sale and a payment
  match on shop + amount + time window (payer phone breaks ties), in either order. `POST /api/webhooks/zamtel/` is the placeholder real endpoint.
- **Daily close:** `GET /api/daily-closes/preview/` then `POST /api/daily-closes/` with `declared_cash`. Gap beyond the
  shop's tolerance flags the day and SMS-alerts the owner. A closed day is locked; only the owner can reopen it.
- **Stock-taking:** `POST /api/stock-takes/`, `POST .../{id}/count/` (scan a code or set a number), `GET .../{id}/report/`
  (exactly which items are missing and what they are worth), `POST .../{id}/close/`.

### Phase 3: Ledger and tax estimation (`ledger`, `tax`)
- Sales write ledger entries automatically. Owners add other income/expenses (`/api/ledger/`, always *trader-reported*).
- `GET /api/ledger/summary/?period=daily|weekly|monthly`, `GET /api/ledger/monthly-statement/?month=2026-11[&export=csv]`.
- **Verified vs trader-reported:** a sale entry becomes *verified* only when the money side is confirmed:
  mobile money matched to a payment, or cash confirmed by a balanced daily close.
- **Tax rules are data, not code:** `TaxRuleSet` (versioned, effective dates, `is_validated`, source) is edited in the admin.
  `POST /api/tax/estimates/ {"month": "2026-11"}` stores an estimate with its assumptions, period, rule version and warnings.
  Unvalidated rules produce a loud warning. **`seed_tax_rules` creates a placeholder rate; replace it with ZRA-confirmed figures.**

### Phase 4: TaxPot (`taxpot`), simulated wallet
Target (can be the estimate: `POST /api/taxpot/targets/from-estimate/`), suggested contribution for the chosen approach
(`GET .../{id}/suggestion/`), accept/change/voluntary (`POST .../{id}/contribute/`), skip, history (`/api/taxpot/transactions/`),
payment preparation checklist and a simulated payment. No real money moves; every response says so.

### Phase 5: TaxMate (`taxmate`)
Answers come only from `ReviewedAnswer` rows that a person has marked reviewed in the admin; there is no free-text generation,
so it cannot invent a tax rule. `POST /api/taxmate/ask/`, `GET /api/taxmate/topics/`, `GET /api/taxmate/explain-estimate/{id}/`.
Every answer carries "general guidance, not official tax advice" and the ZRA pointer. Unanswered questions are logged so the team
knows what to write next. Nyanja is served only once `answer_ny` is filled in and reviewed. `seed_taxmate` loads starter text (unreviewed).

### Phase 6: Reminders, USSD, dashboards (`notifications`, `ussd`, `analytics`)
- SMS log doubles as the SMS preview (`/api/notifications/`). `python manage.py send_reminders` (run daily) sends missing-close, savings and due-date reminders.
- `POST /api/ussd/` (Africa's Talking style `phoneNumber` + `text`, replies `CON`/`END`): register, record a sale, today's summary, tax estimate, save to TaxPot (PIN required).
- `GET /api/dashboard/` (owner: sales, gaps, stock, best sellers, tax position; assistant: own day only).
- `GET /api/admin-overview/` (staff only): aggregates only; towns with fewer than 3 shops are folded into "Other".

### Phase 7: Before real users
Replace mocks (SMS, Zamtel, USSD gateway), set `DJANGO_DEBUG=False`, `ALLOW_PAYMENT_SIMULATION=False`, `USSD_SHARED_SECRET`, real secret key,
HTTPS, object storage for photos, and validate tax rules and TaxMate content with ZRA.

---

## Decisions worth knowing (change any of them)
1. **Lite vs Full:** Lite accepts amount-only sales; Full requires stock items (amount-only only via USSD, flagged in the note).
2. **Negative stock is allowed with a warning** rather than blocking the till; the warning tells the owner the register is missing a delivery.
3. **Assistants can't set prices, void sales, reopen days, adjust stock or see cost prices, tax, ledger or TaxPot.**
4. **A closed day is locked** (409 on new or voided sales for that date). Offline sales for a closed day come back as errors from `/sales/sync/` for the owner to resolve.
5. **Expected cash = recorded cash sales.** Cash expenses taken from the till are not modelled; add an owner "cash out" entry later if shops need it.
6. **Stock-take assumes the shop is quiet while counting;** lines flag `activity_during_count` if stock moved.
7. **Soft delete** for shops, items, targets (history must survive).
8. **JSON clients:** send JSON bodies (boolean defaults behave differently with form posts).

## Not built (Phase 2 slides in the proposal)
Live Zamtel/ZRA/Smart Invoice integration, real USSD/SMS gateways, reorder suggestions, unusual-gap alerts, real savings custody, offline queue (that is the mobile app: it uses `client_id` + `/sales/sync/`), Nyanja content.

## Layout
```
config/            settings, urls
apps/core          shop scoping, role permission, helpers, seed_demo
apps/accounts      phone-login user, JWT views
apps/shops         shop, membership (owner/assistant)
apps/inventory     items, movements, invoice scans, stock-takes
apps/sales         sales, mobile payments, matching engine, Zamtel webhook
apps/reconciliation daily close
apps/ledger        ledger, summaries, CSV
apps/tax           versioned tax rules, estimates
apps/taxpot        simulated wallet, targets, suggestions
apps/taxmate       reviewed Q&A, estimate explainer
apps/notifications SMS log + reminders
apps/ussd          menu logic + endpoint
apps/analytics     owner dashboard, admin overview
apps/integrations  SMS + AI interfaces (mocks)
tests/             end-to-end API tests
```
