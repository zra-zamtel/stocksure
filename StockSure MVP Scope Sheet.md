# StockSure MVP Scope Sheet

Nov 17, 2026 · @Elton Chiwala

## 1. Purpose and users

StockSure is an offline-first mobile app (React Native) that lets a small shop owner track stock and sales, reconcile cash and mobile money, and see the turnover tax they are likely to owe. It is the working prototype for the ZRA–Zamtel Innovation Challenge 2026, Theme 2. It is one app: MerchantMatch (reconciliation) and TaxPot (tax savings) are features inside StockSure, not separate systems. This sheet is the single source of truth for what the MVP does; anything not written here is not in the MVP.

**Problem.** Small shops that already write down each sale and count stock by hand cannot see what is running out, what they really earn after buying costs and discounts, or whether their mobile money takings match their sales book. Tax then arrives as a surprise.

**Primary user.** The shop owner (clothes, shoes and similar retail), on an Android phone, with patchy or expensive data, working in English or Nyanja.

**MVP goals**

- An owner can set up the shop and add products in a few minutes, including by scanning barcodes.
- Stock drops automatically with every sale, and the owner is warned before an item runs out.
- Every sale carries its buy price, sell price and discount, so profit is visible.
- Mobile money and cash takings can be checked against recorded sales each day.
- The owner always sees an estimated turnover tax figure and can set money aside for it.
- All of the above works with no internet.

## 2. Scope at a glance

The MVP is eight modules on one offline-first base; the TaxMate assistant and admin analytics wait for phase 2.

| # | Module | In the MVP |
| --- | --- | --- |
| A | Account and onboarding | Owner creates an account, sets up the shop, adds staff, lands on Home |
| B | Products and stock | Add products, scan or generate barcodes, buy and sell prices, discounts, stock levels, low-stock alerts |
| C | Sales | Record sales with discounts, cash or mobile money, void a sale |
| D | Reconciliation (MerchantMatch) | Daily check of recorded sales against mobile money payments and counted cash |
| E | Tax and TaxPot | Turnover tax estimate, simulated savings wallet, due-date reminders |
| F | USSD simulator | USSD menus through the Africa's Talking sandbox and simulator, to show it works on a basic phone |
| G | Languages | English and Nyanja |
| H | Offline-first sync | Everything works offline; data syncs to the backend when a connection returns |

**Out of scope for the MVP (phase 2 roadmap)**

- TaxMate assistant (AI explanations of tax and stock questions)
- Admin and analytics dashboards
- Direct mobile money provider integration (payments are read from messages instead) and real ZRA filing or payment (simulated)
- Multiple shops, supplier ordering, receipt printing

## 3. Account,h onboarding and Home (Module A)

The owner goes from sign-up to a working Home screen in three steps, and sees the first useful screen before being asked for anything optional.

**Step 1: Create account**

- Fields: owner name, phone number, PIN (4 to 6 digits). Language is chosen on the first screen (English or Nyanja).
- Sign-in afterwards uses the PIN, with no internet needed.
- Decided: the first account creation needs one online moment so the backend can register the owner. After that the app is fully offline.

**Step 2: Onboarding (3 short screens, skippable where marked)**

1. Shop details: shop name, shop type (clothes, shoes, general goods, other), town, and whether the shop uses barcodes.
2. Money and tax set-up: currency (ZMW), mobile money providers used (MTN, Airtel, Zamtel), turnover tax registered or not, TPIN (optional, can skip).
3. First products: choose Add now, Scan a product, or Skip for now.

**Step 3: Home**

| Home element | What it shows |
| --- | --- |
| Today's summary | Sales total, number of sales, gross profit, discounts given |
| Stock alerts | Items low or out of stock, tap to restock |
| Quick actions | Record sale, Add product, Scan barcode |
| Reconciliation card | Today's matched and unmatched mobile money and cash variance |
| Tax card | Estimated turnover tax this period, TaxPot balance, next due date |
| Sync status | Offline, syncing, or all synced, with time of last sync |

Bottom navigation: Home, Products, Sales, Reconcile, Tax. Settings (language, shop details, PIN, sync) sits behind the profile icon.

**Staff and roles.** The owner can add staff in Settings (name, phone, PIN). Each person signs in with their own PIN, and every sale records who made it. There are two roles; this split is proposed and can be changed.

| Action | Owner | Staff |
| --- | --- | --- |
| Record sales, view stock and selling prices | Yes | Yes |
| Count cash at closing | Yes | Yes |
| See buy prices, profit and discounts given | Yes | No |
| Add or edit products, prices, discounts; restock | Yes | No |
| Void a sale | Yes | No |
| Resolve reconciliation items, Tax, TaxPot, Settings, staff list | Yes | No |

## 4. Products and stock (Module B)

Every product records what it cost, what it sells for, how many are in stock and whether a discount applies, and the app warns the owner before it runs out.

**Product fields**

| Field | Required | Notes |
| --- | --- | --- |
| Name | Yes | Example: Black school shoes, size 42 |
| Barcode | If barcodes are used | Only when Use barcodes is on: scanned from the item, or generated by the app |
| Category | No | Shoes, clothes, accessories, or the owner's own |
| Buy price (cost per unit) | Yes | Used for profit; the buy price at the time of each sale is saved on that sale |
| Sell price | Yes | The normal price before any discount |
| Opening quantity | Yes | Total stock on hand when the product is added |
| Low-stock level | No | The quantity that triggers a warning; defaults to a shop-wide level |
| Discount | No | On or off, type (percent or fixed amount), value, optional start and end date |
| Photo | No | One photo from the camera |

Variants: each size or colour is its own product variant, grouped under one product. The owner adds a product once (for example, Black school shoes), then adds its sizes and colours. Barcode, buy price, sell price, quantity and low-stock level are kept per variant, defaulting to the product's values; a product with no sizes or colours has a single variant. When the owner taps the product while selling or restocking, a size and colour picker appears, and the choice tells the system exactly which stock to reduce, which price to use and which low-stock level to check. Scanning a variant's barcode jumps straight to it.

**Adding a product by barcode**

This applies when the shop's Use barcodes setting is on (chosen in onboarding, changeable in Settings). The scanner then pops up when adding or selling a product. When the setting is off, the Scan and Generate buttons are hidden and products are added by typing, and sold by searching by name.

1. Owner taps Scan and points the camera at the barcode.
2. If the code already belongs to a product in the shop, the app opens that product (to view, restock or sell).
3. If not, the app tries an online product catalogue lookup when there is a connection, and pre-fills the name if it finds one. With no connection, or no match, the owner fills the form by hand. The scanned code is kept either way.
4. If an item has no barcode, the owner taps Generate barcode. The app creates a unique in-store code that cannot clash with commercial barcodes, shows it as a scannable barcode, and the owner can save or share the label image to print or stick on the item.

**Stock rules**

- Stock is never edited directly. Every change is a stock movement: opening stock, restock, sale, void, or manual correction with a reason. The quantity shown is the sum of the movements, which keeps counts correct when data syncs from more than one phone.
- Restock lets the owner add a quantity and update the buy price in one step.
- A sale cannot take stock below zero without the owner confirming an override.
- Low-stock alert: when the quantity falls to the low-stock level, the app shows the item on Home and sends a notification on the phone. At zero it shows Out of stock. Notifications are created on the phone, so they work offline.

**Discount rules**

- A product discount is applied automatically at sale time while it is active, and the sell screen shows the original price, the discount and the final price.
- The owner can also give a one-off discount on a single line or the whole sale, at the counter.
- If a discount takes the final price below the buy price, the app warns the owner that this sale makes a loss. It does not block the sale.

## 5. Sales (Module C)

Recording a sale takes a scan or a search, a quantity and a payment method, and it updates stock, profit and the tax estimate at once.

1. Owner starts a sale from Home or the Sales tab.
2. Adds items by scanning a barcode or searching by name, and sets the quantity.
3. The app shows each line with list price, discount and final price, and the sale total.
4. Owner picks the payment: Cash, Mobile money (MTN, Airtel or Zamtel, with the transaction reference), or Split between the two.
5. Owner confirms. The sale is saved on the phone, stock goes down, and any low-stock alert fires.

**Each sale saves:** time, items and quantities, buy price and sell price per line, discount per line, total, payment method(s), mobile money reference, and a reconciliation status.

**Void.** The owner can void a sale with a reason. Stock is restored by a reversing movement and the sale is kept in the history marked Void, never deleted.

**Daily summary.** Sales total, cost of goods, gross profit, discounts given, and totals by cash and by mobile money provider.

## 6. Reconciliation (the MerchantMatch feature, Module D)

Reconciliation checks every day that what the owner recorded matches the money that actually arrived, and it feeds the tax estimate only with sales it can stand behind.

**Mobile money.** The app compares recorded mobile money sales with a list of received payments. Received payments are picked up automatically: when the owner is paid, the provider's confirmation message arrives on the phone, and the app reads it (with the owner's permission), pulls out the amount, sender, reference and time, and stores it as a received payment. This works offline because the message is already on the phone. Real confirmation messages from MTN, Airtel and Zamtel are needed to build the readers. For the demo, a test button adds sample confirmation messages, because real ones cannot be triggered on cue. A recorded sale and a payment are matched when the amount and the reference agree and the times are close; the allowed time gap is a setting, tuned during testing.

| Result | Meaning | What the owner does |
| --- | --- | --- |
| Matched | Sale and payment agree | Nothing |
| Sale with no payment | A mobile money sale was recorded but no money arrived | Check with the customer or correct the sale |
| Payment with no sale | Money arrived with no sale recorded | Record the missing sale or mark it as not a sale |

**Cash.** At closing time the owner types the cash counted. The app compares it with the expected cash (opening float plus recorded cash sales) and shows the difference, with a note field to explain it.

**Tie to tax.** The reconciled daily totals are what the tax estimate in Module E is built from, and unresolved items are shown as a warning on the Tax screen.

## 7. Tax and TaxPot (Module E)

The app turns reconciled sales into an estimated turnover tax figure, helps the owner set that money aside, and reminds them before the due date. Everything involving real ZRA systems or real money is simulated in the MVP.

**Turnover tax estimate**

- Estimate = taxable turnover for the tax period × the turnover tax rate.
- The rate, the turnover threshold, the filing period and the due date live in a tax rules file, not in the code, so they can be changed without a new app release. The values must be checked against ZRA's published rules before the demo (see open question 3). Until then the file holds placeholder values.
- The Tax screen shows turnover so far this period, the estimated tax, the next due date, and any unreconciled items that could change the figure.
- The screen states clearly that this is an estimate and not a tax return.

**TaxPot (simulated savings wallet)**

- The owner chooses to set aside the estimated tax rate automatically from each sale, or to top up by hand.
- The balance is shown against the current estimate: covered, short by an amount, or over.
- A Pay ZRA button runs a simulated payment and produces a demo confirmation screen. No money moves.

**Reminders**

- Local phone notifications before the due date, using days-before values from the tax rules file, and a second one on the due date if the estimate is not covered.
- They work offline because the phone schedules them itself.

## 8. USSD simulator and languages (Modules F and G)

**USSD simulator.** USSD runs through Africa's Talking, using its sandbox and phone simulator. Dialling the short code sends the request to our backend, which replies with numbered text menus. It exists to show judges that the system also works for owners without smartphones. A basic phone has no app, so this is the one feature that runs on the backend and not on the phone. It reads the shop's synced data and applies the same rules (stock movements, the tax rules file), so its figures match the app. A sale recorded by USSD is saved on the backend and syncs down to the owner's phone. It needs internet, and only shows data that has already synced.

1. Record a sale
2. Check stock
3. Today's summary
4. Tax estimate

**Languages.** English and Nyanja at launch. The owner picks one on the first screen and can change it in Settings. All text is held in language files, with no text typed directly into screens, so a language can be added without changing code. The Nyanja strings need a review by a native speaker before the demo.

## 9. Offline-first and the app/backend split (Module H)

Yes, move the business logic into the app: on a phone with no signal the app must price a sale, change stock, estimate tax and raise an alert by itself. The phone holds the shop's working data and rules; the backend is for identity, backup, sync and anything that needs a server.

| Logic or feature | Where it runs | Why |
| --- | --- | --- |
| Pricing, discounts, loss warning | App | Needed at the counter with no signal |
| Stock movements and quantities | App | Every sale must update stock instantly |
| Low-stock detection and notifications | App | Notifications are scheduled by the phone |
| Barcode scan and barcode generation | App | Camera and local code generator |
| Profit and daily summary | App | Pure calculation on local data |
| Reconciliation matching | App | Runs on local sales and the payments read from messages |
| Turnover tax estimate, TaxPot balance, reminders | App | Uses the tax rules file stored on the phone |
| USSD menus (Africa's Talking) | Backend | A basic phone has no app, so the server answers from synced data |
| Local data store | App (SQLite) | Source of truth for day-to-day work |
| Account registration, PIN reset | Backend | Identity needs a server |
| Sync, backup and restore | Backend | Keeps data safe if the phone is lost |
| Tax rules and language file updates | Backend | Published once, pulled by the app when online |
| Reading mobile money confirmation messages | App | The message is already on the phone; works offline |
| Online barcode catalogue lookup | Backend or third party | Needs internet, optional |

**How offline-first works**

- **One shared logic module.** Pricing, stock, reconciliation and tax calculation are written once as a plain TypeScript module with no screens in it. The app calls it. The backend does not repeat the calculations; it stores what the app sends and checks that it is well formed. The one exception is USSD, where the backend works out stock, today's total and the tax estimate from the same rules.
- **Local database.** All reads and writes go to SQLite on the phone first. Screens never wait for the network.
- **Outbox sync.** Each change is also written to a queue. When a connection returns, the app sends the queue to the backend and pulls anything new. Each record gets an ID created on the phone, so sending the same change twice does no harm.
- **Conflicts.** Stock is a list of movements that only ever grow, so two phones cannot overwrite each other's counts. For ordinary fields such as a product name, the latest edit wins.
- **Always visible.** A sync indicator shows offline, syncing or synced, and the app never blocks work because it is offline.
- **Config, not code.** Tax rules and language text are files the app ships with and can refresh from the backend.

**Needs internet (everything else does not):** first account creation, a staff member's first sign-in on a phone, restore from backup, USSD menus, and the online barcode lookup.

&#91;embedded content: app and backend split · 4 phone parts, 4 backend parts\]

Screens call the shared logic module, which reads and writes the local database; only the outbox talks to the backend, and only when a connection exists.

## 10. Data model overview

Thirteen record types cover the whole MVP; the detailed fields and the API go in the data model and API contract that follows this sheet. Every record has an ID created on the phone, a created time and an updated time.

| Record | Holds |
| --- | --- |
| Owner, Staff and Shop | Owner and staff names, phones, PIN checks, roles; shop name, type, town, currency, language, barcode use, tax settings |
| Product | Name, category, photo, default buy and sell price, discount settings; its variants (size, colour, barcode, buy price, sell price, low-stock level) |
| StockMovement | Product variant, quantity change, reason (opening, restock, sale, void, correction), time |
| Sale | Time, recorded by, totals, discount total, status (Active or Void), reconciliation status |
| SaleLine | Sale, product variant, quantity, buy price, list price, discount, final price |
| Payment | Sale, method (cash or provider), amount, mobile money reference |
| MobileMoneyTxn | Received payment read from a confirmation message: provider, amount, sender, reference, time, message text |
| Reconciliation | Day, matches, unmatched items, counted cash, expected cash, difference |
| TaxPeriod | Period dates, turnover, rate used, estimated tax, due date |
| TaxPotEntry | Amount set aside or paid (simulated), time, linked period |
| SyncQueue | Pending changes waiting to be sent |

## 11. Quality needs, assumptions, risks and open questions

**Quality needs**

- Records a sale, changes stock and shows alerts with no internet at all.
- Runs on low-end Android phones and stays responsive at the counter.
- Simple wording, large touch targets, amounts shown as Kwacha (K 1,250.00).
- Data is behind the owner's PIN, and a lost phone can be restored from the backend backup.

**Assumptions**

- One shop per owner; the owner and staff can use more than one phone, synced through the backend.
- ZRA connections are simulated; mobile money payments come from reading confirmation messages, and the demo uses sample messages.
- Android is the target platform for the prototype.

**Risks**

| Risk | Mitigation |
| --- | --- |
| Scope grows again, as the five-module version did | This sheet is the limit; any addition needs a team decision and something else comes out |
| Tax figures are wrong in front of ZRA judges | Rules held in a file, checked against ZRA's published rules, estimate clearly labelled |
| Barcode scanning struggles in poor light or on cheap cameras | Manual entry always available; test on real low-end phones early |
| Sync loses or duplicates data | Phone-made IDs, append-only stock movements, test with the phone toggled offline and online |
| Nyanja wording is unclear | Native-speaker review before the video is recorded |
| Time runs out before the demo | Build and polish the demo path (section 12) first; edge cases after |
| Mobile money message formats differ or change, and the SMS permission is restricted outside a prototype | Collect real sample messages early, keep one reader per provider, let the owner enter a payment by hand, and share the prototype as an APK |
| USSD needs a public server address and already-synced data; a live short code needs separate approval | Use the Africa's Talking sandbox for the demo, deploy the backend early, and sync before demonstrating USSD |

**Open questions**

1. Settled: account creation needs internet once; after that everything works offline.
2. Which online barcode catalogue, if any? Barcode use is now a shop setting (scanner on, manual entry off), so this only affects the optional online lookup; clothes and shoes are poorly covered.
3. What are the exact turnover tax rate, threshold, filing period and due date to put in the tax rules file?
4. Which backend: Django with Django REST Framework (settled), because the business logic lives in the app.
5. How does mobile money payments reach the app? Settled: read automatically from the provider's confirmation messages on the phone. Still needed: sample messages from MTN, Airtel and Zamtel to build the readers.

## 12. Demo path and phase 2

**Demo path.** The video and live demo follow one shop owner's day. Build and polish these steps first, with prepared sample data, because they decide how the project is judged.

1. Create an account in Nyanja and finish onboarding; land on Home.
2. Scan a products barcode, add the buy price, sell price and stock, and turn on a discount.
3. Generate a barcode for an item that has none.
4. Switch the phone to airplane mode and record three sales: one cash, one mobile money, one with a discount.
5. Watch stock fall and a low-stock alert fire.
6. Go to the Reconcile tab: one matched payment, one sale with no payment, one payment with no sale; resolve them and count the cash.
7. Go to the Tax tab: the estimate updates from the reconciled sales; set money aside in the tax wallet (TaxPot) and see a due-date reminder.
8. Dial the USSD code in the Africa's Talking simulator and check stock and today's total as on a basic phone.
9. Reconnect and show the sync indicator move to synced.

**Phase 2 roadmap**

- TaxMate assistant for plain-language tax and stock questions in English and Nyanja
- Admin and analytics dashboards
- Direct mobile money provider integration and real ZRA filing and payment
- Multiple shops, supplier orders, receipt printing
- Data encrypted on the phone

## 13. Documents that follow this sheet

1. Tax and reconciliation rules spec (settles open question 3)
2. Architecture and tech decisions, one page (settles open questions 2 and 5)
3. Data model and API contract
4. UX pack: user flows, wireframes, Nyanja and English text list
5. Demo script and storyboard, then the pitch deck outline
6. Work breakdown, timeline and team roles
