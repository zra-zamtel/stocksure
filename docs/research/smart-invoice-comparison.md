# ZRA Smart Invoice vs StockSure

Nov 23, 2026; mobile app manual added Nov 26, 2026. Desk research from public
sources (listed at the end). ZRA's own pages could not be opened directly from
the research environment, so some points come from search summaries of them and
from third-party guides. The **Smart Invoice Mobile Application User Manual**
(PDF, linked below) was read in full on 26 Nov 2026, and section 2 now uses it
as the primary source for the mobile app. The **VSDC Service Sign-Up Guide**
was also read on 26 Nov 2026 and is used in section 6. Both documents are dated
early 2024, so newer versions may differ. Items still marked **unconfirmed** need checking
in the app itself or with ZRA (smartinvoice@zra.org.zm, 4111).

## 1. What Smart Invoice is

Smart Invoice is ZRA's e-invoicing system: each invoice a business issues is
recorded with ZRA. It has four channels:

| Channel | Who it is for | Notes |
| --- | --- | --- |
| Mobile app | Turnover Tax (TOT) businesses only, not VAT-registered (ZRA FAQ; the manual itself does not say) | Android 8+ phone, tablet or PDA; an iOS listing also exists. ZRA's FAQ says it is downloaded from the taxpayer's Smart Invoice profile; guides point to Google Play. |
| Desktop / tablet app | Businesses without their own system | Works offline and uploads offline invoices when the connection returns. Has a full stock module. |
| Online portal | Any registered business with internet | Stock inventory with Excel export, stock by item, client or supplier, movements, opening and closing stock. |
| VSDC API | Businesses with their own accounting, ERP or POS software | Certified systems connect through ZRA's VSDC. The spec has a TOT tax category for non-VAT businesses. API access is free; integration work is not. |

**Obligation.** The compulsory deadline (30 Sep 2024, penalties from
1 Oct 2024) was set for VAT-registered businesses. For TOT-only businesses,
use of the mobile app is offered, but I found no official notice making it
compulsory in 2025–2026. **Unconfirmed.**

## 2. What the mobile app does

Read from the **Smart Invoice Mobile Application User Manual** (30 pages, linked
below; the PDF is dated early 2024). The app runs on Android 8+ phones, tablets
and PDAs, and has three menus signed in with the same TPIN and password:

- **Admin.** System settings (shop email, phone, address, 80 mm printer); user
  management (user code, username, password, telephone, permission); item
  management; customer management; device settings (printer port, 19,200 baud,
  80 mm).
- **POS.** Intermediate deposit, sales report by date and item, float, end of
  day, and a Z-report for the day or shift.
- **Sales.** Barcode scan, barcode entry or item search; quantity (the sale
  screen refuses more than the stock on hand); percentage discount; price
  override; item and transaction cancellation; customer search by TPIN;
  payment by cash, mobile money, credit card or debit card; receipt by SMS,
  e-receipt or 80 mm print.

**Item management** records item name, sale price, opening stock, ZRA class
code (five levels), package unit, unit of measure, tax category, country of
origin and item type, and generates an item code. The sale screen checks each
quantity against the stock on hand. The manual documents no restock flow, stock
movement history, stock report or low-stock alert.

**Customers** are business or consumer, with TPIN, name, phone and email.

**Credit notes** are the refund path: search the original receipt, pick a
reason, choose the refund payment method, confirm and print or issue an
e-receipt.

**Sending and receiving** is a manual sync with the ZRA server. The Send screen
shows the number of transactions waiting, sends them, and can resend a range of
invoice numbers; Receive pulls data back from ZRA. The app can therefore keep
selling while offline and upload invoices later, but the sync is a manual step,
not a background outbox.

**Not documented in the manual** (treat as absent until seen in the app): buy
price, cost of goods or profit; mobile-money reconciliation against money
actually received (mobile money is only a payment method with a phone number
and an "Approved" button); a turnover tax estimate or savings pot; low-stock
alerts; USSD or any feature-phone path; Nyanja or other local languages;
multiple shops per taxpayer.

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

| Need of a small shop | Smart Invoice mobile app (manual) | StockSure |
| --- | --- | --- |
| Record a sale that ZRA can trust | **Yes, this is its purpose** | Records every sale, never deletes (void keeps reason and who) — but is **not** a ZRA-recognised invoice |
| Works offline | Yes: sales queue locally, then a manual Send uploads them | Yes: a full day offline, automatic outbox; USSD for basic phones |
| Fast at a busy counter | Reported as slow when busy; barcode, search or PLU entry | Sale in a few taps; staff each on their own PIN |
| Products and stock | Item list with sale price, opening stock and a sale-time stock check; no restock, movement history, stock report or low-stock alert in the manual | Products, variants, barcodes, append-only stock movements, restock, low-stock alerts |
| Profit | Sale price only; no buy price or profit | Buy price, sell price and discount saved on every sale line |
| Mobile money vs sales | Mobile money is a payment method typed in with a phone number; no check that the money arrived | MerchantMatch reads the confirmation message and reconciles mobile money and cash daily |
| Staff | User accounts with permissions; per-sale attribution not shown | Owner and staff roles, own PINs, every sale records who made it |
| Cash-up and shift close | Z-report, float, intermediate deposit, end of day | Cash count at closing with variance; no Z-report or float yet |
| Customers | Business or consumer profiles with TPIN | No customer records in the MVP |
| Turnover tax | Sends invoices to ZRA; filing is separate | Estimated 5% TOT, TaxPot savings, reminders before the 14th |
| Setup effort | ZRA class codes (five levels), unit of measure, package unit, tax category, origin per item | Three onboarding screens; name, prices and stock per product |
| Hardware | 80 mm printer and scanner/PDA assumed; Android 8+ | Any Android phone; camera barcode scan; no printer needed |
| Languages | English | English and Nyanja |
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
4. **For the challenge demo (built):** each sale can show a "Sent to Smart
   Invoice" status through the simulated VSDC bridge in
   `backend/apps/smartinvoice`, and every screen labels it as practice mode.
   Real certification stays out of the MVP.
5. **Questions to put to ZRA:** Is Smart Invoice compulsory for TOT-only
   traders, and from when? Can a non-VAT app become a certified VSDC system?
   Does the mobile app's stock data come from the same records as the portal?
   Can a vendor host one certified VSDC for many taxpayers, or must every shop
   run its own WAR? What is accepted as the commitment letter? Is the sandbox
   sign-up path the same as production?

## 6. The VSDC API in detail (from ZRA_VSDC_DOC v1.0.2, 28 Jan 2024)

Read from the PDF the team supplied. ZRA has published later versions
(1.0.7/1.0.8 seen online); fields may have changed since.

### How it works

- **It is not a cloud API.** After registering on the Smart Invoice portal and
  applying for a VSDC service, ZRA verifies the applicant and hands over the
  VSDC as a **WAR file** that the taxpayer runs on their own server. The
  business's software talks to that local VSDC; the VSDC talks to ZRA.
- **One device per taxpayer branch.** `POST /initializer/selectInitInfo` with
  `tpin`, `bhfId` (branch, e.g. `000`) and `dvcSrlNo` registers the device and
  creates its security key. Every later call carries the TPIN and branch.
- Every call is `POST` with JSON. Responses carry `resultCd` (`000` = success)
  and a message; codes like `901` (invalid device) and `994` (duplicate data)
  are listed in section 4.14.
- Eight service groups: device setup, code lists, branch (customers, users),
  items, imports, **sales**, purchases, **stock**.

### How StockSure's data maps onto it

| StockSure | VSDC call | Key fields and codes |
| --- | --- | --- |
| Shop | `initializer/selectInitInfo` | Shop's TPIN, branch `000`, a device serial |
| Product / variant | `items/saveItems` | `itemCd` (format `ZM` + product type + packaging + unit + running number, e.g. `ZM2NTU0000012`), `itemClsCd` (ZRA classification code), `bcd` barcode, units, price |
| Sale | `trnsSales/saveSales` | `invcNo` (a **number**), `salesTyCd` `N`, `rcptTyCd` `S`, line items, `taxTyCd` **`TOT`** ("all transactions for taxpayers registered under Turnover Tax", no tax charged on the invoice) |
| Payment method | inside the sale, `pmtTyCd` | `01` cash, **`06` mobile money**, `07` other |
| Voided sale | `saveSales` with `rcptTyCd` `R` (refund after sale) | `orgInvcNo` = the original, `rfdRsnCd` e.g. `09` wrong amount, `11` wrong items, `13` other |
| Stock received / adjusted | `stock/saveStockItems` | `sarTyCd` `02` purchase, `06` adjustment in, `16` adjustment out, `15` discarded, `11` sale out |
| Stock level after a change | `stockMaster/saveStockMaster` | `itemCd`, `rsdQty` (quantity left) |
| Staff member | `branches/saveBrancheUsers` (optional) | Every sale also carries `regrId`/`regrNm` (who recorded it) |

**What ZRA returns for each sale:** `rcptNo`, `totRcptNo`, `intrlData`,
`rcptSign`, `sdcId`, `mrcNo` and a publish date. These are what make a receipt
a Smart Invoice; StockSure would print or show them on the receipt (the
desktop app turns them into a QR code; the exact receipt layout is in ZRA's
separate CIS specification).

### What StockSure would need to change

1. **Shop TPIN and branch.** Not captured today. Add to shop setup.
2. **Sequential invoice numbers.** VSDC wants a numeric `invcNo` per branch;
   StockSure uses text ids. Add a per-shop counter assigned when a sale is
   recorded (works offline, since each phone owns its shop's sequence, but two
   staff phones would need separate ranges or branch ids).
3. **Item codes and classifications.** Each product needs a ZRA `itemCd` and
   `itemClsCd` (fetched from `itemClass/selectItemsClass`), plus packaging and
   quantity unit codes. A default "finished product, each" covers most shops.
4. **Kwacha with two decimals.** StockSure stores ngwee as integers; convert
   when sending.
5. **Voids become refund receipts.** StockSure already keeps voided sales with
   a reason; map its reasons to ZRA refund codes.
6. **Stock adjustments by type.** StockSure's movement reasons map cleanly to
   the in/out codes above.

### Signing up for VSDC (from the March 2024 guide)

The guide is for the **sandbox** portal, and it is written for the taxpayer,
not the software vendor. The path is:

1. Create an account at `https://sandboxportal.zra.org.zm/` with the shop's
   TPIN; the portal verifies the TPIN and auto-fills the taxpayer details.
2. Set a password, confirm an OTP sent to the taxpayer's registered phone, and
   sign in.
3. Apply → Smart Invoice → choose **VSDC** and attach a **commitment letter**
   (PDF or JPG).
4. ZRA processes the request and sends approval or rejection by SMS.
5. After approval, download the **VSDC WAR package** from the taxpayer portal.

Running it needs a local server with **Java 8** and a servlet container
(Apache Tomcat, Jetty or Apache HTTP Server). The WAR is copied into the
container's deployment directory, the container is started, and the software
talks to `http://<server_ip>:<port>/<app_context>`. The PDF ends mid-sentence
there, so the rest of the run steps are not covered.

Three things this confirms for StockSure:

- **Third-party invoicing systems are the intended use case.** The guide opens
  by saying it is for "taxpayers wanting to integrate their client invoicing
  systems with Smart Invoice via the VSDC".
- **The taxpayer must own the application and the approval.** The TPIN, OTP and
  commitment letter are the shop's, not the vendor's.
- **The current path assumes a server administrator.** Java 8 plus Tomcat on a
  local machine is a heavy ask for a market stall. That is the gap a managed,
  certified bridge fills.

### The big open question

The VSDC is designed as **one installed device per taxpayer**. The sign-up
guide confirms the taxpayer deploys the WAR on **their own local server** (Java
8 plus a servlet container). StockSure serves many small shops from one
backend. Either StockSure runs one VSDC instance per shop (heavy), or ZRA
allows a certified multi-taxpayer intermediary. This is the first thing to ask
ZRA, alongside the questions in section 5. It is also a strong pitch point: a
shared, certified bridge would let thousands of small traders reach Smart
Invoice without installing anything.

## Sources

- [ZRA Smart Invoice — App Store (UK)](https://apps.apple.com/gb/app/zra-smart-invoice/id6758915176)
- [ZRA Smart Invoice Mobile — App Store (Zambia)](https://apps.apple.com/zm/app/zra-smart-invoice-mobile/id6749771707)
- [ZRA Smart Invoice — mwm.ai listing](https://mwm.ai/apps/zra-smart-invoice-ipad-mac/6758915176)
- [ZRA: Smart Invoice Learn More](https://www.zra.org.zm/smart-invoice-learn-more/)
- [ZRA: Smart Invoice FAQs (PDF)](https://www.zra.org.zm/wp-content/uploads/2024/08/Smart-Invoice-FAQs.pdf)
- [ZRA: Smart Invoice Mobile Application User Manual (PDF)](https://www.zra.org.zm/wp-content/uploads/2024/01/Smart-Invoice-Mobile-Application-User-Manual.pdf) — read in full 26 Nov 2026
- [ZRA: Smart Invoice Desktop and Tablet User Manual (PDF)](https://www.zra.org.zm/wp-content/uploads/2024/01/Smart-Invoice-Desktop-Laptop-Tablet-User-Manual.pdf)
- [ZRA: Smart Invoice VSDC Service Sign-Up Guide (PDF)](https://www.zra.org.zm/wp-content/uploads/2024/03/Smart-Invoice-VSDC-Service-Sign-Up-Guide.pdf) — sandbox guide, read 26 Nov 2026
- [ZRA: Smart Invoice Online Portal User Manual (PDF)](https://www.zra.org.zm/wp-content/uploads/2024/01/Smart-Invoice-Online-Portal-User-Manual.pdf)
- [ZRA: VSDC API Documentation v1.0.2 (PDF)](https://www.zra.org.zm/wp-content/uploads/2024/02/ZRA-VSDC-API-Documentation.pdf) — read in full from the copy supplied by the team
- [ZRA: Specification of CIS for VSDC (PDF)](https://www.zra.org.zm/wp-content/uploads/2024/04/Smart-Invoice-Specification-of-CIS-for-VSDC.pdf)
- [ZRA: Smart Invoice Deadline](https://www.zra.org.zm/smart-invoice-deadline/)
- [Zambia Monitor: no extension to 30 Sept deadline](https://www.zambiamonitor.com/zra-insists-no-extension-in-september-30-deadline-for-implementation-of-smart-invoice-system/)
- [IGC policy brief, Oct 2025 (PDF)](https://www.theigc.org/sites/default/files/2025-11/Quarti-Policy-Brief-October-2025.pdf)
- [ActionAid Zambia: address Smart Invoicing challenges](https://zambia.actionaid.org/news/2024/press-statement-address-smart-invoicing-challenges-urgently)
- [Diggers: ZAM on Smart Invoicing](https://diggers.news/local/2024/11/10/zam-urges-zra-to-ensure-all-govt-depts-adopt-smart-invoicing/)
- [PayeZambia: Smart Invoice setup guide (2026)](https://payezambia.com/blog/zra-smart-invoice-setup-guide-zambia/)
- [VATupdate: Zambia e-invoicing country booklet](https://www.vatupdate.com/2026/08/31/zambia-e-invoicing-e-reporting-country-booklet/)
- [M&J Consultants: ZRA late filing penalties 2026](https://mjconsultants.co.zm/insights/zra-late-filing-penalties-by-tax-type-in-2026/)
