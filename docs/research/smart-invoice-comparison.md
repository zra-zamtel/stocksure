# ZRA Smart Invoice vs StockSure

Nov 23, 2026. Desk research from public sources (listed at the end). ZRA's own
pages could not be opened directly from the research environment, so some
points come from search summaries of them and from third-party guides. Items
marked **unconfirmed** need checking in the app itself or with ZRA
(smartinvoice@zra.org.zm, 4111).

## 1. What Smart Invoice is

Smart Invoice is ZRA's e-invoicing system: each invoice a business issues is
recorded with ZRA. It has four channels:

| Channel | Who it is for | Notes |
| --- | --- | --- |
| Mobile app | Turnover Tax (TOT) businesses only, not VAT-registered | Android 8+; an iOS listing also exists. ZRA's FAQ says it is downloaded from the taxpayer's Smart Invoice profile; guides point to Google Play. |
| Desktop / tablet app | Businesses without their own system | Works offline and uploads offline invoices when the connection returns. Has a full stock module. |
| Online portal | Any registered business with internet | Stock inventory with Excel export, stock by item, client or supplier, movements, opening and closing stock. |
| VSDC API | Businesses with their own accounting, ERP or POS software | Certified systems connect through ZRA's VSDC. The spec has a TOT tax category for non-VAT businesses. API access is free; integration work is not. |

**Obligation.** The compulsory deadline (30 Sep 2024, penalties from
1 Oct 2024) was set for VAT-registered businesses. For TOT-only businesses,
use of the mobile app is offered, but I found no official notice making it
compulsory in 2025–2026. **Unconfirmed.**

## 2. What the mobile app does

From the App Store listing and third-party summaries:

- Issue invoices and receipts that are recorded with ZRA.
- Customer management and item (product) management.
- Works without internet and syncs later.
- Shows remaining stock levels per item, searchable by code or name
  (third-party description only: **unconfirmed** for the mobile app; the stock
  module is documented for desktop/tablet and portal).

Not found in any source for the mobile app (absent from listings, **unconfirmed**):
mobile-money reconciliation, staff accounts with their own PINs, profit (buy
price and discounts), low-stock alerts, barcode scanning, tax savings,
Nyanja or other local languages, USSD.

## 3. Problems traders report with Smart Invoice

- **Power and speed at the counter.** An IGC policy brief (Oct 2025) found
  load-shedding was the main barrier, and that some shops stopped issuing
  Smart Invoices when the store was busy because each one takes too long.
- **Cost and burden.** ActionAid (2024) reported SMEs see it as expensive and
  another layer of fees and compliance.
- **Glitches.** The Zambia Association of Manufacturers reported system
  glitches disrupting daily work.
- **Support and language.** Calls for low-cost training for micro and small
  businesses; one guide cites language barriers in training materials and
  rural internet gaps (secondary source).
- **Wrong channel.** The most common setup error is VAT businesses signing up
  for the TOT-only mobile app.

## 4. Side by side

| Need of a small shop | Smart Invoice mobile app | StockSure |
| --- | --- | --- |
| Record a sale that ZRA can trust | **Yes, this is its purpose** | Records every sale, never deletes (void keeps reason and who) — but is **not** a ZRA-recognised invoice |
| Works offline | Yes, syncs later | Yes, a full day offline; USSD for basic phones |
| Fast at a busy counter | Reported as slow when busy | Sale in a few taps; staff each on their own PIN |
| Products and stock | Item management; stock levels **unconfirmed** on mobile | Products, barcodes, stock drops on every sale, low-stock alerts |
| Profit | Not mentioned | Buy price, sell price and discount on every sale |
| Mobile money vs sales | Not mentioned | MerchantMatch reconciles mobile money and cash daily |
| Staff | Not mentioned | Owner and staff roles, own PINs, staff-only selling |
| Turnover tax | Records turnover; filing is separate | Estimated 5% TOT, TaxPot savings, reminders before the 14th |
| Languages | English (not seen otherwise) | English and Nyanja |
| Cost | Free from ZRA | Free prototype |

## 5. What this means for StockSure

1. **Do not compete on invoicing.** Smart Invoice is the legal record ZRA
   wants. StockSure should never call its receipts "invoices" or suggest it
   replaces Smart Invoice.
2. **Pitch StockSure as the shop's daily tool that makes Smart Invoice easy.**
   The reported pain points (slow when busy, power, training, language) are
   exactly where StockSure is strong: fast offline sales, Nyanja, USSD,
   stock and mobile money in one place.
3. **The bridge is the VSDC API.** It is the official route for third-party
   software, it has a TOT category, and access is free. A certified
   StockSure could send each sale to ZRA automatically, so the trader records
   a sale once and it counts for both their shop and ZRA. That directly answers
   "how can Smart Invoice be improved?".
4. **For the challenge demo:** add a mock "Sent to Smart Invoice" status on
   each sale and a day-close summary laid out like a VSDC submission, clearly
   labelled as a simulation. Real certification stays out of the MVP.
5. **Questions to put to ZRA:** Is Smart Invoice compulsory for TOT-only
   traders, and from when? Can a non-VAT app become a certified VSDC system?
   Does the mobile app's stock data come from the same records as the portal?

## Sources

- [ZRA Smart Invoice — App Store (UK)](https://apps.apple.com/gb/app/zra-smart-invoice/id6758915176)
- [ZRA Smart Invoice Mobile — App Store (Zambia)](https://apps.apple.com/zm/app/zra-smart-invoice-mobile/id6749771707)
- [ZRA Smart Invoice — mwm.ai listing](https://mwm.ai/apps/zra-smart-invoice-ipad-mac/6758915176)
- [ZRA: Smart Invoice Learn More](https://www.zra.org.zm/smart-invoice-learn-more/)
- [ZRA: Smart Invoice FAQs (PDF)](https://www.zra.org.zm/wp-content/uploads/2024/08/Smart-Invoice-FAQs.pdf)
- [ZRA: Smart Invoice Desktop and Tablet User Manual (PDF)](https://www.zra.org.zm/wp-content/uploads/2024/01/Smart-Invoice-Desktop-Laptop-Tablet-User-Manual.pdf)
- [ZRA: Smart Invoice Online Portal User Manual (PDF)](https://www.zra.org.zm/wp-content/uploads/2024/01/Smart-Invoice-Online-Portal-User-Manual.pdf)
- [ZRA: VSDC API Documentation (PDF)](https://www.zra.org.zm/wp-content/uploads/2024/02/ZRA-VSDC-API-Documentation.pdf)
- [ZRA: Specification of CIS for VSDC (PDF)](https://www.zra.org.zm/wp-content/uploads/2024/04/Smart-Invoice-Specification-of-CIS-for-VSDC.pdf)
- [ZRA: Smart Invoice Deadline](https://www.zra.org.zm/smart-invoice-deadline/)
- [Zambia Monitor: no extension to 30 Sept deadline](https://www.zambiamonitor.com/zra-insists-no-extension-in-september-30-deadline-for-implementation-of-smart-invoice-system/)
- [IGC policy brief, Oct 2025 (PDF)](https://www.theigc.org/sites/default/files/2025-11/Quarti-Policy-Brief-October-2025.pdf)
- [ActionAid Zambia: address Smart Invoicing challenges](https://zambia.actionaid.org/news/2024/press-statement-address-smart-invoicing-challenges-urgently)
- [Diggers: ZAM on Smart Invoicing](https://diggers.news/local/2024/11/10/zam-urges-zra-to-ensure-all-govt-depts-adopt-smart-invoicing/)
- [PayeZambia: Smart Invoice setup guide (2026)](https://payezambia.com/blog/zra-smart-invoice-setup-guide-zambia/)
- [VATupdate: Zambia e-invoicing country booklet](https://www.vatupdate.com/2026/08/31/zambia-e-invoicing-e-reporting-country-booklet/)
- [M&J Consultants: ZRA late filing penalties 2026](https://mjconsultants.co.zm/insights/zra-late-filing-penalties-by-tax-type-in-2026/)
