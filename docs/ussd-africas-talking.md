# USSD through Africa's Talking

USSD is Module F: it proves StockSure works on a basic phone with no app. The
menu logic and endpoint already live in `backend/apps/ussd/`; this page covers
what to point Africa's Talking at, how to run the sandbox, and what to check
when a session fails.

## What is already built

| Piece | Where |
| --- | --- |
| Callback endpoint | `POST /api/ussd/` (`apps/ussd/views.py`) |
| Menu logic | `apps/ussd/services.py` |
| Data source | `apps.sync` — the same tables the phone pushes to |
| Gateway mocks | none needed; Africa's Talking calls us |

The endpoint accepts Africa's Talking's `application/x-www-form-urlencoded`
POST (`sessionId`, `serviceCode`, `phoneNumber`, `text`) and replies in plain
text. A reply starting with `CON` keeps the session open; `END` closes it. State
lives in `text` (`4821*1*150*2` means PIN 4821, option 1, amount 150, paid by
mobile money), so the server keeps no session.

### Sign-in

Every session signs in first:

1. The caller's number picks the account. A number with no StockSure account
   is told to sign up in the app; USSD no longer creates accounts.
2. The first screen asks for that person's **USSD PIN** (4 digits). It is
   separate from the app PIN, which never leaves the phone.
3. The PIN is checked again on every step, because each step repeats it in
   `text`. Five wrong PINs in a row lock dial-in for that number for 15 minutes
   and email the owner.

The owner sets the PINs in the app: **Settings > USSD PIN**. That screen lists
the owner and every staff member. Staff sign in on the owner's connected phone
and have no server session, so the owner sets their PINs too. App endpoints:

| Call | Does |
| --- | --- |
| `GET /api/v1/ussd/pins` | Owner only: who has a PIN, and who is locked |
| `POST /api/v1/ussd/pin {pin, userId?}` | Set or replace a PIN (no `userId` = the owner's own); clears a lock |
| `DELETE /api/v1/ussd/pin?userId=` | Turn USSD off for that person |

Menu for a signed-in owner (the first line is the shop name):

```
CON Kabwe Shoe Palace
1. Record a sale
2. Check stock
3. Today's summary
4. Tax estimate
5. Save to TaxPot
6. Payment requests
```

An assistant's number gets 1. Record a sale, 2. Check stock, 3. Today's
summary and 4. Payment requests. An owner whose shop has staff does not see
option 1, because staff record the sales.

### Mobile money (request to pay)

After the amount, **2. Mobile money** asks for the network (MTN, Airtel,
Zamtel), then:

- **1. Send payment request:** type the customer's number and confirm. The
  server sends a request to pay through `apps.collections` (simulated, or
  Lipila), and the customer approves it with their PIN on their own phone. A
  number on a different network from the one chosen is refused. Requests are
  capped at K50,000, the same as the app, and any fee passed on to the
  customer is shown before sending.
- **2. Customer already paid:** the customer sent money on their own. The sale
  is recorded with the network and is matched later against the payment
  message on the shop phone.

USSD cannot wait while the customer types their PIN, so the session ends once
the request is sent. The **sale is written only when the provider says the
customer paid**, the same rule as the app, so a declined or unanswered request
never becomes turnover. That check (`apps.ussd.momo.settle_pending`) runs:

- at the start of any USSD session for the shop (3 requests, 3 seconds at most,
  to stay inside the gateway's 10 seconds);
- on every sync pull, so the owner's phone gets the new sale;
- when someone opens **Payment requests** (staff see their own, the owner
  sees the whole shop's): `K150.00 0961234567: paid, sale saved`, `waiting`,
  `declined` or `no answer`.

When a request is paid, the sale and payment carry the provider and reference,
and a received payment with the same reference is filed (as the app does), so
the phone matches it at once. The request id is derived from the gateway's
`sessionId`, so a retried last step never prompts the customer twice.

With the simulated provider a request is approved after
`COLLECTIONS_SIMULATED_DELAY_SECONDS` (6 by default). Numbers ending in `000`
decline and numbers ending in `111` never answer.

Option 2 opens a stock submenu: **Low stock** lists up to four items at or
below their low-stock level (with the total and out-of-stock count) and
**Find by barcode** returns one item's quantity and selling price.

A sale or TaxPot top-up made by USSD is written to `apps.sync` and logged as a
`SyncChange`, so it appears on the phone at the next pull. Only data already
synced is visible over USSD.

## Sandbox setup

### 1. Start the backend and a public tunnel

Africa's Talking cannot reach `localhost`. The repo already has a Cloudflare
quick-tunnel script:

```powershell
# Window 1 — Django on 127.0.0.1:8000
.\scripts\start-backend.ps1

# Window 2 — public HTTPS URL, also written to mobile\.env.local
.\scripts\start-tunnel.ps1
```

Copy the `https://….trycloudflare.com` URL it prints. The URL changes every
time the tunnel restarts, so update Africa's Talking after each restart.

### 2. Set the shared secret

Africa's Talking's callback cannot send custom headers, so the secret travels
on the callback URL as a query parameter. In `backend/.env`:

```dotenv
USSD_SHARED_SECRET=local-demo-ussd-secret
```

Restart the backend after changing it. When `DJANGO_DEBUG=0` the endpoint
refuses every call unless this is set; leaving it empty is only tolerated in
local debug mode.

### 3. Register the callback in Africa's Talking

1. Sign in at <https://account.africastalking.com> and switch to the
   **Sandbox** app (a live short code needs a separate approval and a paid
   account; the sandbox is enough for the demo).
2. Open **USSD**, create a channel/service code, and set its callback URL to:

   ```
   https://<your-tunnel-host>/api/ussd/?token=local-demo-ussd-secret
   ```

3. Use the service code Africa's Talking gives you. Sandbox codes look like
   `*384*<number>#` and differ per account.
4. Open the simulator, enter the phone number you want to call as, and dial the
   code. Use the seeded demo owner so the shop already exists:
   `+260970000001` (owner) or `+260970000002` (assistant) after
   `python manage.py seed_demo --reset`. Both have the USSD PIN `2468`.

The simulator lets you type any MSISDN. That is why the PIN matters: a number
alone no longer opens a shop.

### 4. Smoke-test without Africa's Talking

Before blaming the gateway, call the endpoint directly:

```powershell
curl.exe -X POST "http://127.0.0.1:8000/api/ussd/" `
  -H "X-USSD-Secret: local-demo-ussd-secret" `
  -d "phoneNumber=+260970000001&text="
```

You should get `CON StockSure / Enter your USSD PIN`. Then sign in and walk a
sale as the assistant (`+260970000002`): `text=2468`, `text=2468*1`,
`text=2468*1*25`, `text=2468*1*25*1` (K25 cash).

## Demo path (scope sheet step 8)

1. Sync the phone once so the shop, products and today's sales are on the
   backend.
2. Dial the sandbox code as the owner and type the USSD PIN.
3. Choose **Check stock**, then **Low stock** (or find an item by barcode), and
   compare it with the Products tab in the app.
4. Choose **Today's summary** and compare it with Home.
5. Dial again as the assistant, choose **Record a sale**, enter an amount,
   pick cash, and show the `END` confirmation.
6. Reopen the app and pull: the USSD sale appears in the sales list.
7. Mobile money: as the assistant, **Record a sale**, an amount, **Mobile
   money**, **MTN**, **Send payment request**, a customer number such as
   `0961234567`, then **Send**. Wait about 6 seconds, dial again and choose
   **4. Payment requests**: it shows `paid, sale saved`. Pull in the app and
   the sale is there, already matched.

## Deploying the callback on Lambda

The stack already takes a `UssdSharedSecret` parameter and passes it through as
`USSD_SHARED_SECRET`. After deploying, the callback is:

```
https://<api-id>.execute-api.<region>.amazonaws.com/api/ussd/?token=<secret>
```

Two things to watch:

- **Cold starts.** Africa's Talking gives the callback 10 seconds. A cold Lambda
  plus a database round trip is usually fine, but warm it with one dial before
  the demo, or set provisioned concurrency if it is slow.
- **`DJANGO_ALLOWED_HOSTS`** must include the API Gateway host. The SAM template
  adds it automatically; a custom domain has to be passed in as
  `AllowedHostsExtra`.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `403 Bad gateway secret` | The `?token=` value and `USSD_SHARED_SECRET` differ, or the env change was not picked up by a restart. |
| `403` and no secret set | `DJANGO_DEBUG=0` requires `USSD_SHARED_SECRET`; set it. |
| Africa's Talking reports a timeout | Callback not publicly reachable, tunnel died, cold start over 10s, or a DB stall. Check the tunnel window and `runserver` output first. |
| Simulator shows a generic error | The reply must be plain text starting exactly `CON ` or `END `; check the response with the curl smoke test. |
| `END You are not linked to a shop` | The number is a staff account with no membership, or the owner's phone number differs from the registered one. |
| Shop looks empty over USSD | USSD only reads synced data. Pull/push from the app first. |
| `END This number has no StockSure account` | That MSISDN has no account. Sign up in the app, or dial as a seeded number. |
| `END Set your USSD PIN first` / `Ask the shop owner` | No USSD PIN for that person. Set it in the app: Settings > USSD PIN. |
| `END Too many wrong PINs` | Five wrong PINs locked dial-in for 15 minutes. Wait, or set a new PIN in the app (that clears the lock). |
| Works locally, fails on Lambda | Host allow-list, secret parameter, or the 10-second timeout. Check CloudWatch under `JobFunction`/`ApiFunction`. |

## Security and limits

- The token is a shared secret in a URL; it can appear in logs. Rotate it for
  the demo build and do not reuse the production value.
- Rate limiting is already on the endpoint (`ussd` scope, 120/min).
- Every session needs the caller's number **and** their USSD PIN. Only a
  Django password hash of the PIN is stored (`apps.ussd.models.UssdPin`).
- The PIN travels in `text` on every step, as is normal for USSD, so it can
  appear in gateway logs. That is one reason it is separate from the app PIN.
- TaxPot asks for a confirm (1/2) instead of a password: the caller has
  already signed in.
- Each screen should stay under ~160 characters. Long replies are cut by the
  network, so keep menu text short.

## Notes

- The menu now matches the scope sheet's four options and keeps TaxPot as a
  fifth owner-only option.
- USSD shows only synced data: a product added after the last pull will not
  appear until the phone syncs.
- Low-stock uses each variant's own low-stock level, the same rule as the app.
