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
lives in `text` (`1*150*2` means option 1, amount 150, paid by mobile money), so
the server keeps no session.

Menu for a registered owner:

```
CON StockSure
1. Record a sale
2. Check stock
3. Today's summary
4. Tax estimate
5. Save to TaxPot
```

An unregistered number is offered shop registration (shop name, then a 4-digit
PIN). An assistant's number gets options 1 to 3.

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
   `+260970000001` (owner, password `demo1234`) or `+260970000002` (assistant,
   PIN `1234`) after `python manage.py seed_demo --reset`.

The simulator lets you type any MSISDN, so this is also how you demo
registration on a number that has never signed up.

### 4. Smoke-test without Africa's Talking

Before blaming the gateway, call the endpoint directly:

```powershell
curl.exe -X POST "http://127.0.0.1:8000/api/ussd/" `
  -H "X-USSD-Secret: local-demo-ussd-secret" `
  -d "phoneNumber=+260970000001&text="
```

You should get `CON StockSure …`. Then walk a sale:
`text=1`, `text=1*25`, `text=1*25*1` (K25 cash).

## Demo path (scope sheet step 8)

1. Sync the phone once so the shop, products and today's sales are on the
   backend.
2. Dial the sandbox code as the owner.
3. Choose **Check stock**, then **Low stock** (or find an item by barcode), and
   compare it with the Products tab in the app.
4. Choose **Today's summary** and compare it with Home.
5. Choose **Record a sale**, enter an amount, pick cash, and show the `END`
   confirmation.
6. Reopen the app and pull: the USSD sale appears in the sales list.

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
| Number registers a new shop unexpectedly | That MSISDN has no account yet, so the registration flow started. Dial with the seeded owner instead. |
| Works locally, fails on Lambda | Host allow-list, secret parameter, or the 10-second timeout. Check CloudWatch under `JobFunction`/`ApiFunction`. |

## Security and limits

- The token is a shared secret in a URL; it can appear in logs. Rotate it for
  the demo build and do not reuse the production value.
- Rate limiting is already on the endpoint (`ussd` scope, 120/min).
- USSD is not authenticated by PIN on entry, because the caller's MSISDN is the
  identity. Moves that spend simulated money (TaxPot) ask for the account
  password, which is the USSD registration PIN for shops created by USSD.
- Each screen should stay under ~160 characters. Long replies are cut by the
  network, so keep menu text short.

## Notes

- The menu now matches the scope sheet's four options and keeps TaxPot as a
  fifth owner-only option.
- USSD shows only synced data: a product added after the last pull will not
  appear until the phone syncs.
- Low-stock uses each variant's own low-stock level, the same rule as the app.
