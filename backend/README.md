# StockSure backend

Django 5.2 + DRF. Offline-first: the phone keeps its own SQLite and business logic.
This backend does five things: accounts, sync, config delivery, USSD data layer, CI.

## Run it (Windows PowerShell)

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install --default-timeout=120 --retries 10 -r requirements.txt
copy .env.example .env
python manage.py makemigrations accounts sync configs
python manage.py migrate
python manage.py seed_config        # publishes placeholder tax rules + en/ny language files
python manage.py createsuperuser    # for /admin (publish config versions)
python manage.py test
python manage.py runserver
```

Docs: http://127.0.0.1:8000/api/v1/docs/ . Commit the generated `migrations/` folders (CI checks them).

## Endpoints (all under /api/v1)

| Area | Endpoint |
|---|---|
| Health | `GET health` |
| Accounts | `POST auth/register`, `POST auth/login`, `POST auth/refresh`, `GET auth/me`, `POST auth/change-pin`, `POST auth/pin-reset/request`, `POST auth/pin-reset/confirm` |
| Staff (owner only) | `GET/POST staff`, `POST staff/<id>/reset-pin`, `POST staff/<id>/deactivate` |
| Sync | `POST sync/push`, `GET sync/pull?cursor=&limit=&excludeDevice=` |
| Config | `GET config`, `GET config/<tax_rules|lang_en|lang_ny>?have=<version>` (ETag / 304) |
| USSD | `POST ussd` (Africa's Talking style: `phoneNumber`, `text`) |

## How sync is stored

- One generic store (`SyncRecord`) for the 13 contract tables, keyed by (tenant, entity, entity_id). Tenant = the owner account behind the token; the contract has no shop id.
- `ChangeLog` is append-only; its `seq` is the pull cursor. Push takes a per-tenant lock so cursors are ordered.
- Push returns `accepted` and `rejected` (with a reason per `queueId`). Bad records are rejected, never repaired. Replays are no-ops.
- Server never recomputes money (integer ngwee), except USSD sales.
- Rules live in `apps/sync/schemas.py` (`ENTITIES`, immutable set, staff restrictions).

## Decisions to confirm with Elton

1. Contract says "only `sale` updates"; scope sheet says latest edit wins. Implemented: latest `updated_at` wins for ordinary tables; `sale_line`, `payment`, `stock_movement`, `tax_pot_entry` immutable. Change in `schemas.ENTITIES`.
2. Staff PINs: server needs a verifiable PIN, so owners register staff via `POST staff`. The phone's `pin_hash` is opaque to the server and is not sent to staff devices (phone must tolerate empty).
3. `sale_line.final_price` assumed to be the line total. USSD sales use list price, no discount.
4. `reconciliation.day` is unique per tenant: two phones making different ids for one day get the second rejected.
5. Staff pull includes buy prices (hide in UI only).
6. Tax rules are placeholders (`validatedWithZra: false`) until ZRA confirms.
7. USSD menus (`apps/ussd/menus.py`) are Elton's; the data layer is `apps/ussd/data.py`.

## Dropping into the repo

On branch `backend-django`: `git rm -r backend/apps backend/tests`, copy these files over `backend/`, move `.github/` to the repo root, then `git add backend .github`.

Dev-only settings: `PIN_RESET_RETURN_CODE` returns the OTP in the response and SMS prints to the console. Turn both off in production and set `USSD_SHARED_SECRET`.
