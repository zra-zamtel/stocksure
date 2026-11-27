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
python manage.py migrate
python manage.py seed_demo --reset                      # demo shop, users, placeholder tax rules, TaxMate content
python manage.py test tests                             # run the test suite
python manage.py runserver
```

- API docs (try every endpoint): http://localhost:8000/api/docs/
- Django admin (tax rules, TaxMate content, users): http://localhost:8000/admin/
- Demo logins are printed by `seed_demo` (owner `0970000001` / `demo1234`, assistant `0970000002` / `1234`).
- PostgreSQL: `docker compose up -d db`, then `DATABASE_URL=postgres://stocksure:stocksure-dev@localhost:5432/stocksure` in `.env`.

## Deploy to AWS Lambda

The Lambda deployment runs behind an API Gateway HTTP API. The stack is
[`template.yaml`](./template.yaml): Django is wrapped with Mangum, uploads go to
a private S3 bucket, an EventBridge schedule runs `send_reminders` daily, and a
second schedule pings the health endpoint every two minutes to keep the API warm.
Lambda allows SMTP on ports 465 and 587 (only port 25 is blocked), so the Gmail
setup above works unchanged.

**Prerequisites:** AWS CLI v2, AWS SAM CLI, Python 3.12+ (the backend `.venv`
is fine), and a Postgres URL. Docker and Hyper-V are not required: the build
script downloads Linux wheels for Lambda with pip and writes
`backend/build/lambda.zip`. Authenticate the AWS CLI first (`aws login` or your
usual credential setup). The Neon or Supabase free tier is enough; use the
pooled connection string with `sslmode=require`.

```powershell
winget install --id Amazon.SAM-CLI -e

# From the repository root. The first run builds the Lambda zip and is guided;
# it saves samconfig.toml.
.\scripts\deploy-lambda.ps1
```

The guided deploy asks for a stack name (`stocksure-api`), a region, and these
parameters. This AWS account's organization SCP allows Lambda and CloudFormation
only in **`eu-north-1` (Stockholm)**; other regions fail with an explicit
`AccessDenied ... service control policy`. The script defaults to `eu-north-1`
and to the existing artifact bucket
`stocksure-lambda-artifacts-866874944490`, so it does not try to create SAM's
managed artifact stack. The Supabase database is in `eu-west-1`, so expect a
small cross-region hop on each query. The main parameters are:

| Parameter | What to enter |
| --- | --- |
| `DjangoSecretKey` | 32+ random characters |
| `DatabaseUrl` | Pooled Postgres URL with `sslmode=require` |
| `ZamtelWebhookSecret` | 16+ random characters |
| `UssdSharedSecret` | Shared secret, or leave empty for the demo |
| `EmailHost` | `smtp.gmail.com` |
| `EmailPort` | `587` |
| `EmailUseSsl` | `0` for 587; `1` for 465 |
| `EmailHostUser` | Full Gmail address |
| `EmailHostPassword` | Gmail App Password |
| `DefaultFromEmail` | The same Gmail address |
| `AllowedHostsExtra` | Only for a custom domain |
| `CsrfTrustedOriginsExtra` | Only for a custom domain, with `https://` |

Set `EmailHost`, `EmailHostUser`, `EmailHostPassword` and `DefaultFromEmail`
together, or leave `EmailHost` empty to use the console backend. A half-filled
Gmail block makes every email send fail. `samconfig.toml` is
git-ignored and stores the values you enter during the guided deploy, including
secrets; do not commit or share it.

Leave `DbConnMaxAge` at `0`. Set `DbDisableServerSideCursors=1` only when using
Supabase's transaction pooler on port 6543. `ReminderSchedule` defaults to
06:00 UTC, which is 08:00 in Lusaka.

After the deploy the script prints `ApiUrl`, `HealthUrl` and `DocsUrl`.

```powershell
# Apply database migrations (run after every deploy that adds one)
.\scripts\deploy-lambda.ps1 -Migrate -SkipBuild

# Prove SMTP delivery from inside Lambda
.\scripts\deploy-lambda.ps1 -SmtpCheckTo you@example.com -SkipBuild
```

Both invoke the JobFunction directly; they do not redeploy. The same function
also runs the daily reminder schedule, so there is only one background Lambda.

### Deploy pipeline (GitHub Actions)

[`deploy.yml`](../.github/workflows/deploy.yml) deploys the backend on every push
to `main` that touches `backend/`, and on manual dispatch from the Actions tab.
It runs the same checks as `ci.yml`, builds the bundle with
[`build-lambda.sh`](../scripts/build-lambda.sh), packages the template with
`aws cloudformation package`, and updates the `stocksure-api` stack with
`aws cloudformation deploy`.

Authentication uses GitHub OIDC, so no AWS access keys are stored in GitHub.
Create the provider and role once:

```powershell
.\scripts\setup-github-oidc.ps1 -ConfigureRepo
```

The script creates the `token.actions.githubusercontent.com` OIDC provider, the
`GitHubActionsStockSureDeploy` role (trusted only for `zra-zamtel/stocksure` on
`main`), and stores its ARN as the `AWS_DEPLOY_ROLE_ARN` repository variable.
Re-running it is safe.

Stack parameters are deliberately **not** stored in GitHub.
`aws cloudformation deploy` keeps the value already on the stack for every
parameter you omit, so the pipeline never touches `DatabaseUrl`, the SMTP
password, or the other secrets. To change one from CI, add a
`STACK_PARAMETERS_JSON` repository secret containing a JSON array; only the
listed parameters are overridden:

```json
[{ "ParameterKey": "ReminderSchedule", "ParameterValue": "cron(0 5 * * ? *)" }]
```

Migrations do not run automatically. Trigger the workflow manually with
**Run database migrations** checked, or keep using
`.\scripts\deploy-lambda.ps1 -Migrate -SkipBuild`.

### Current demo deployment

- Stack: `stocksure-api` in `eu-north-1`
- API: `https://xrj6hnz51i.execute-api.eu-north-1.amazonaws.com`
- Health: `https://xrj6hnz51i.execute-api.eu-north-1.amazonaws.com/api/health/`
- Docs: `https://xrj6hnz51i.execute-api.eu-north-1.amazonaws.com/api/docs/`
- Media bucket: `stocksure-api-mediabucket-kzeqjuceutco`
- Artifact bucket: `stocksure-lambda-artifacts-866874944490`

Migrations and the SMTP check have been run against this stack. Redeploying
updates the code behind the same URL.

Point the app at the API:

```powershell
$env:EXPO_PUBLIC_API_URL="https://xrj6hnz51i.execute-api.eu-north-1.amazonaws.com"
cd mobile; npx expo start
```

The same URL is already in `mobile/.env.local`.

Create an admin user against the same database from your machine:

```powershell
$env:DATABASE_URL="postgresql://...?sslmode=require"
cd backend
.\.venv\Scripts\python manage.py createsuperuser
```

Useful details:

- `DJANGO_ALLOWED_HOSTS` and `CSRF_TRUSTED_ORIGINS` include the API Gateway
  host automatically; the extra parameters are only for a custom domain.
- `MEDIA_BUCKET` is created by the stack. Files are private, and Django hands
  the app presigned URLs valid for `AWS_QUERYSTRING_EXPIRE` seconds (one hour
  by default).
- There is no VPC. The function reaches Postgres over TLS through its public
  pooler, so keep `DB_CONN_MAX_AGE=0`.
- The HTTP API timeout is 29 seconds and the request body limit is 6 MB. Large
  invoice photos should use presigned S3 uploads rather than a Lambda request.
- `WarmFunction` calls `/api/health/` every two minutes. It keeps the API Lambda
  warm without waking the database, so the demo should not see a cold start.
- `sam logs --stack-name stocksure-api --name ApiFunction --tail --region eu-north-1`
  follows the API logs. Reminder and migration logs are under `JobFunction`.
- At demo traffic this sits in Lambda's always-free tier; S3 and API Gateway
  come to pennies. `sam delete` removes the stack; the media bucket is
  deliberately retained, and the artifact bucket is outside the stack.

## Phone sync (canonical phone store)

`apps/sync` is the store for the data the phone owns. It follows
`docs/sync-contract.md`:

- primary keys are the phone-generated text ids, and every row carries the
  phone's `createdAt`/`updatedAt`;
- money is integer ngwee;
- stock is append-only `stock_movement` rows; quantity is a sum, never a column;
- a sale arrives as one payload with its lines, payments and movements, and the
  server stores the phone's subtotal, discount and final prices instead of
  repricing;
- bad rows come back in `rejected` with a reason and are not repaired;
- a replayed `queueId` is accepted without writing a second pull row.

`POST /api/v1/sync/push` takes `{deviceId, batchId, changes}`, where each change
is `{queueId, entity, entityId, operation, payload, clientCreatedAt}`.
`GET /api/v1/sync/pull?cursor=…&limit=…` returns `{changes, nextCursor,
serverTime}` for the caller's shops. Both need the JWT access token.

The new store is the source of truth for the app, using `apps.sync` for USSD and the
owner dashboard. The older domain write API (`/api/shops`, `/api/items`,
`/api/sales`, …) remains for the server-side demo and is not the phone's store;
its remaining tax/TaxPot endpoints have not yet been repointed.

## Trading Record (prototype: proof of trading for a bank or MFI)

`apps.trading_record`. The owner shares a sealed summary of the shop's sales; a bank officer scans
the QR code (or opens the link) to check it. Built from the phone's synced store (`apps.sync`),
never `apps.ledger`. Not a credit score, audited accounts or a bank statement.

- Three evidence lines, never one blended figure: **mobile money matched** (payment paired with a
  provider confirmation SMS stored on the phone; the server re-checks amount, provider, reference
  and time), **cash balanced close** (cash on days the close counted exactly the expected cash; a
  consistency check), **recorded only** (self-reported). Late-synced (back-filled) sales are shown.
- Margin and a draft tax section are opt-in. Simulated TaxPot payments are never shown as compliance.
- Server computes the payload, seals it with SHA-256 over canonical JSON, and stores only the
  token's hash. Links expire after 14 or 30 days and can be withdrawn. Totals only.
- API (owner only): `GET/POST /api/v1/trading-records/` (`shopId`, `months` 3/6/12,
  `expiresInDays` 14/30, `includeMargin`, `includeTax`), `POST /api/v1/trading-records/<id>/revoke`.
  The POST response is the only time the link (`verifyUrl`, `qrSvg`) is returned.
- Public: `/verify/<token>/` (HTML) and `/verify/<token>/json/`. Set `TRADING_RECORD_PUBLIC_URL`
  when the API sits behind a proxy so QR links use the public host.
- Demo data: `seed_demo --reset --history`, or for the shop a phone created,
  `seed_trading_history --shop <sync shop id>` (`--backfilled` shows the late-sync warning).
- Phone: Settings → Trading Record (owner only) makes the record and shares a PDF or the link.

## USSD (Africa's Talking)

`POST /api/ussd/` is the Module F gateway endpoint. It accepts the standard
Africa's Talking form POST (`sessionId`, `serviceCode`, `phoneNumber`, `text`)
and replies with `CON …` or `END …` in plain text. Because the gateway cannot
send custom headers, `USSD_SHARED_SECRET` is accepted from `X-USSD-Secret` or
from the callback URL's `?token=` parameter. USSD reads and writes `apps.sync`,
so a USSD sale shows up on the phone at the next pull. Setup, the sandbox
callback URL, the demo walk-through and troubleshooting are in
[`docs/ussd-africas-talking.md`](../docs/ussd-africas-talking.md).

## Auth (mobile app and domain clients)

`apps/accounts` is the one account layer. It keeps Tabo's `User` + `Membership`
+ JWT model and adds the mobile-side pieces:

- `POST /api/auth/register` (and `/api/v1/auth/register`) — owner signup, optional
  `shop_name` (a placeholder shop and owner Membership are created when it is
  omitted), phone-generated `id` for safe retries. A 6-digit confirmation
  code is emailed automatically. The phone's PIN hash is validated and discarded.
- `POST /api/auth/login` — email + password for the app (blocked until the email
  is verified) or phone + password for domain clients.
- `POST /api/auth/email-code/request` and `/verify` — single-use, 10-minute
  6-digit code that confirms the email (5 tries); a resend must also name the
  account phone.
- `POST /api/auth/password-reset/request` and `/confirm` — emailed 6-digit code
  to set a new password; only confirmed emails get one.
- `POST /api/v1/smart-invoice/connect` `{shopId, tpin}`, `GET /smart-invoice/status?shopId=`
  and `GET /smart-invoice/sales/<saleId>` — the simulated ZRA Smart Invoice
  bridge. The owner gives a TPIN once; every synced sale (and USSD sale) is then
  sent as a VSDC `saveSales` request (turnover tax `TOT`), a void sends a refund
  receipt, and ZRA's receipt number and signature come back to phones as the
  `smart_invoice_receipt` sync entity. `SMART_INVOICE_BACKEND` defaults to
  `apps.smartinvoice.vsdc.SimulatedVsdc`; a certified VSDC client replaces it.
- Email is used for nothing else except notices of important account changes:
  password changed, app PIN reset, staff added, staff PIN reset.
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
