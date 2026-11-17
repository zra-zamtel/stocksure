# Testing StockSure

Four levels. Each one catches mistakes the level below it cannot.

| Level | What it tests | Where | Runs |
| --- | --- | --- | --- |
| Unit | One function on its own: money, pricing, stock, matching, tax, barcodes, PIN hashing, the API client. No database. | `mobile/src/**/*.test.ts` | `npm run test:unit` |
| Integration | The data layer (`db/repos.ts`) against a real SQLite database with the real migrations. Checks the tables and the sync outbox, not just return values. Also the backend API against its test database. | `mobile/src/**/*.integration.test.ts`, `backend/accounts/tests.py` | `npm run test:integration`, `python manage.py test` |
| System | Whole journeys end to end: first run to ready-to-sell, a full trading day, stock history, offline outbox, upgrading an old install, the demo shop. | `mobile/src/system/*.system.test.ts` | `npm run test:system` |
| UAT | People using the real app on a real phone against written scripts. | [uat.md](uat.md) | By hand, before each release |

## Running

From `mobile/`:

```bash
npm test
```

```bash
npm run test:unit
```

```bash
npm run test:integration
```

```bash
npm run test:system
```

From `backend/`:

```bash
python manage.py test
```

Integration and system tests use `node:sqlite` (built into Node 22.13+) through
the adapter in `mobile/src/test/sqlite.ts`, which gives repos.ts the same calls
expo-sqlite does. Every test gets a fresh in-memory database. Tests run on
Lusaka time (`src/test/setup.ts`) so day boundaries are the same on every
machine.

## Test IDs

Test names start with an ID, so a failure can be traced to a requirement and a
UAT script: `UT-` unit, `IT-` integration, `ST-` system, `UAT-` acceptance.

| Area | Unit | Integration | System | UAT |
| --- | --- | --- | --- | --- |
| Account and sign-in | UT-PIN, UT-API, identity tests | IT-ONB-08, backend tests | ST-01 | UAT-01, 02, 04 |
| Onboarding | identity tests | IT-ONB | ST-01, ST-05 | UAT-03 |
| Products and barcodes | UT-BAR | IT-PROD | ST-01 | UAT-05, 06, 07 |
| Sales, discounts, payments | UT-PRICE, UT-PAY, UT-MONEY | IT-SALE | ST-02, ST-07 | UAT-08 to 11 |
| Stock, voids, restock | UT-STOCK | IT-SALE-08, IT-PROD-09 | ST-03 | UAT-12 to 14 |
| Reconciliation | UT-REC | IT-REC | ST-02 | UAT-15 to 17 |
| Tax and TaxPot | UT-TAX | IT-TAX | ST-02 | UAT-18 |
| Offline and sync outbox | | IT-SALE-01, IT-REC-08 | ST-04 | UAT-19 |
| Upgrades and demo data | seed data tests | IT-DB | ST-05, ST-06 | |
| Language | | | | UAT-20 |

## Known defects

A test can describe a real defect before it is fixed by using `it.fails`: it
passes while the defect is there and starts failing once it is fixed, which is
the signal to remove `.fails`. There are none at the moment.

Fixed defects found by these tests:

| Test | Defect |
| --- | --- |
| IT-REC-07b to 07e | Reconciling the day after a cross-midnight match reset the match. Matches are now stored as pairs (schema v5). |
| seed data: valid EAN-13 | Every demo barcode had an invalid check digit, so demo labels could not be printed. |
