# StockSure user acceptance test (UAT) scripts

UAT is done by people, not code. A shop owner or cashier (or someone playing
one) works through each script on a real Android phone, with no help from the
team, and marks it Pass or Fail. A script passes only if every expected result
happens exactly as written.

## Before you start

| Item | Setup |
| --- | --- |
| Phone | Android phone with the latest StockSure development build installed. Camera works. |
| Backend | The account service is running and reachable (needed for UAT-01 and the first half of UAT-21). |
| Data | Start from a fresh install (uninstall and reinstall) unless the script says otherwise. |
| Money | Print or write out these products: **School shirt** buy K50, sell K80, 10 in stock. **Cap** buy K20, sell K40, 2 in stock, low-stock level 1. |
| Barcode | One real product with a printed barcode (any supermarket item works). |
| Tester | Record your name, phone model, build number and date on the results sheet. |

Write amounts exactly as shown on screen. "K" means Zambian Kwacha.

## Results sheet

| ID | Title | Tester | Date | Pass / Fail | Notes (what you saw if it failed) |
| --- | --- | --- | --- | --- | --- |
| UAT-01 | Create an account | | | | |
| UAT-02 | Account creation without internet | | | | |
| UAT-03 | Set up the shop | | | | |
| UAT-04 | Sign in offline | | | | |
| UAT-05 | Add a product with a barcode | | | | |
| UAT-06 | Add a product without a barcode | | | | |
| UAT-07 | Print a barcode label | | | | |
| UAT-08 | Cash sale by scanning | | | | |
| UAT-09 | Mobile money sale | | | | |
| UAT-10 | Split payment with a discount | | | | |
| UAT-11 | Selling more than is in stock | | | | |
| UAT-12 | Void a sale | | | | |
| UAT-13 | Restock with a new buy price | | | | |
| UAT-14 | Low-stock alert | | | | |
| UAT-15 | Reconcile mobile money | | | | |
| UAT-16 | Confirm a payment by hand | | | | |
| UAT-17 | Close the day: cash count | | | | |
| UAT-18 | Tax estimate and TaxPot | | | | |
| UAT-19 | Works with no internet all day | | | | |
| UAT-20 | Chichewa (Nyanja) language | | | | |
| UAT-21 | Staff add, first sign-in and owner-only screens | | | | |
| UAT-22 | Owner email sign-in and email code on a new phone | | | | |

Sign-off: the build is accepted when every script passes, or when the product
owner has accepted each failure in writing as a known issue.

| Role | Name | Signature | Date |
| --- | --- | --- | --- |
| Product owner | | | |
| Shop owner tester | | | |

---

## UAT-01 Create an account

**Goal:** a new owner can create an account in under two minutes.
**Start:** fresh install, internet on.

| Step | Do this | Expected result |
| --- | --- | --- |
| 1 | Open StockSure. | The language screen appears. |
| 2 | Choose **English**, tap **Next**. | "Create your account" appears. |
| 3 | Enter your name, phone `+260 97 123 4567`, email `elton@example.com`, password `stocksure-demo`, phone PIN `4821` twice. Tap **Create account**. | "Creating account..." shows, then the shop screen opens. |
| 4 | Note the time taken from step 1. | Under two minutes. |

## UAT-02 Account creation without internet

**Start:** fresh install, airplane mode on.

| Step | Do this | Expected result |
| --- | --- | --- |
| 1 | Fill the account form as in UAT-01, tap **Create account**. | Message: connect to the internet once. Your details are still on the screen. |
| 2 | Turn airplane mode off, tap **Create account** again. | The account is created without retyping anything. |
| 3 | Reinstall and try to register the same phone number again with a different name. | Message: "That phone number is already registered." |
| 4 | Type passwords that do not match. | Message: "The two passwords do not match." Nothing is sent. |

## UAT-03 Set up the shop

**Start:** UAT-01 completed.

| Step | Do this | Expected result |
| --- | --- | --- |
| 1 | Enter shop name, choose **Clothes**, town **Lusaka**, turn on "Does your shop use barcodes?". Tap **Next**. | "Money and tax" opens. |
| 2 | Tick MTN and Airtel. Turn on "Registered for turnover tax". Type TPIN `12345`. | Message: a TPIN is 10 digits. You cannot continue. |
| 3 | Clear the TPIN (leave blank). Tap **Next**. | "Add your first products" opens. |
| 4 | Tap **Skip for now**, then **Go to Home**. | Home shows Today, Stock alerts, Quick actions, Reconciliation, Tax. |
| 5 | Close the app fully and reopen it. | You are asked for your PIN, not taken through setup again. |

## UAT-04 Sign in offline

**Start:** UAT-03 completed. Airplane mode on.

| Step | Do this | Expected result |
| --- | --- | --- |
| 1 | Open the app. | "Welcome back" asks for your PIN. |
| 2 | Enter a wrong PIN. | "That PIN is not correct. Try again." |
| 3 | Enter `4821`. | Home opens, with no internet. |

## UAT-05 Add a product with a barcode

| Step | Do this | Expected result |
| --- | --- | --- |
| 1 | Home → **Add product**. Tap the barcode scan button and scan your real product. | The barcode field fills with the code. |
| 2 | Name it, buy price K10, sell price K15, opening quantity 4. **Save product**. | The product appears in Products with 4 in stock. |
| 3 | Add another product and scan the same barcode. | Message: that barcode already belongs to another product. Not saved. |

## UAT-06 Add a product without a barcode

| Step | Do this | Expected result |
| --- | --- | --- |
| 1 | Add **School shirt** (buy K50, sell K80, quantity 10). Leave barcode blank. | Hint says the barcode is added automatically. |
| 2 | Save, then open the product. | It has a 13-digit barcode starting with `20`. |
| 3 | Add **Cap** (buy K20, sell K40, quantity 2, low-stock level 1). | Saved. |

## UAT-07 Print a barcode label

| Step | Do this | Expected result |
| --- | --- | --- |
| 1 | Open School shirt → **Print label**. | A label preview with the name, price and barcode opens. |
| 2 | Print or share it, then scan the printed label with the in-app scanner. | The scanner finds School shirt. |

## UAT-08 Cash sale by scanning

| Step | Do this | Expected result |
| --- | --- | --- |
| 1 | **Record sale** → **Scan barcode**, scan the School shirt label twice. | "Added School shirt". Quantity 2, total K160.00. |
| 2 | Payment method **Cash**. **Confirm sale**. | Sale saved. Home "Sales" shows K160.00 and "Sales made" 1. |
| 3 | Products → School shirt. | 8 in stock. Stock movements shows a Sale of -2. |

## UAT-09 Mobile money sale

| Step | Do this | Expected result |
| --- | --- | --- |
| 1 | Sell 1 Cap. Payment method **Mobile money**, provider **MTN**. Leave the reference blank. | The reference hint says it is optional. |
| 2 | **Confirm sale**. | Saved. The sale shows Reconciliation "unresolved" or "Sale with no payment" until a message arrives. |

## UAT-10 Split payment with a discount

| Step | Do this | Expected result |
| --- | --- | --- |
| 1 | Sell 1 School shirt. Add a K10 discount on the line. | Subtotal K80.00, Discounts K10.00, total K70.00. |
| 2 | Choose **Split**. Cash part K20. | "Remaining on mobile money" shows K50.00. |
| 3 | Provider Airtel. **Confirm sale**. | Saved. The sale detail lists both payments. |
| 4 | Try a discount bigger than the buy price (e.g. K40 on a K80 shirt). | A warning says the sale makes a loss. It still records. |

## UAT-11 Selling more than is in stock

| Step | Do this | Expected result |
| --- | --- | --- |
| 1 | Sell 5 Caps (only 1 left). **Confirm sale**. | "Not enough stock": Cap, 1 on hand, 5 requested. |
| 2 | Change quantity to 4. | The warning clears; confirming asks again. |
| 3 | Tap **Sell anyway**. | Sale saved. Cap shows out of stock. Stock movements note says "Override by ...". |

## UAT-12 Void a sale

| Step | Do this | Expected result |
| --- | --- | --- |
| 1 | Sales → open the sale from UAT-11 → **Void this sale**, reason "Wrong quantity". | The sale stays in the list marked Void. |
| 2 | Check Cap stock and Home totals. | The 4 Caps are back. Home totals no longer include that sale. |
| 3 | Try to void it again. | Not possible, or a message says it is already void. Stock does not change. |

## UAT-13 Restock with a new buy price

| Step | Do this | Expected result |
| --- | --- | --- |
| 1 | School shirt → **Restock**. Quantity 5, buy price K55, note "Supplier A". | "Added 5. 12 now in stock." (adjust if your count differs). |
| 2 | Open an earlier School shirt sale. | Its cost is still K50 per shirt. |
| 3 | Sell another School shirt. | Its cost is K55. |

## UAT-14 Low-stock alert

| Step | Do this | Expected result |
| --- | --- | --- |
| 1 | Sell Caps until 1 is left. | Home Stock alerts shows Cap as Low stock. |
| 2 | Sell the last Cap. | Cap shows Out of stock. |

## UAT-15 Reconcile mobile money

**Start:** at least one mobile money sale today without a reference (UAT-09).

| Step | Do this | Expected result |
| --- | --- | --- |
| 1 | Reconcile tab → **Add demo messages**. | "Demo messages added". |
| 2 | Look at the lists. | The UAT-09 sale is under Matched. A K450.00 Zamtel payment from Grace Phiri is under "Payment with no sale". |
| 3 | On the K450 payment, tap **Not a sale**. | It disappears from the list and does not come back on reopening. |
| 4 | Tap **Add demo messages** again. | No second K450 orphan appears. |

## UAT-16 Confirm a payment by hand

| Step | Do this | Expected result |
| --- | --- | --- |
| 1 | Make a mobile money sale (Zamtel, K40). Do not add demo messages. | It appears under "Sale with no payment". |
| 2 | Tap **Money arrived**. | It moves to Matched. |
| 3 | Leave and reopen the Reconcile tab. | It is still Matched. |
| 4 | Open Tax. | The "unreconciled items" warning no longer counts this sale. |

## UAT-17 Close the day: cash count

| Step | Do this | Expected result |
| --- | --- | --- |
| 1 | Reconcile → Cash count. Note "Expected cash". | It equals opening float plus today's cash payments (voided sales excluded). |
| 2 | Enter K5 less than expected, note "short". **Save cash count**. | "Cash count saved". Difference shows -K5.00. |
| 3 | Enter the exact amount and save again. | Difference K0.00. Only one count is kept for today. |

## UAT-18 Tax estimate and TaxPot

| Step | Do this | Expected result |
| --- | --- | --- |
| 1 | Open Tax. | Turnover this period equals the sum of today's active sales. Estimate = turnover × rate shown. The "This is an estimate" warning is visible. |
| 2 | TaxPot → **Top up** with the estimated amount. | "Set aside K..." and the pot shows Covered. |
| 3 | **Pay ZRA (simulated)**. | "{amount} marked as paid to ZRA. No money moved." Pot balance K0.00. Entries list keeps both rows. |
| 4 | Tap Pay again. | Refused: nothing set aside to pay. |

## UAT-19 Works with no internet all day

| Step | Do this | Expected result |
| --- | --- | --- |
| 1 | Turn on airplane mode. Repeat UAT-08, UAT-10, UAT-12, UAT-13, UAT-17. | Everything works. Nothing says an action failed for lack of internet. |
| 2 | Settings → Sync and backup. | "Changes waiting to upload" is above zero. |
| 3 | Force-close the app and reopen it, still offline. | Every sale, void and restock is still there. |

## UAT-20 Chichewa (Nyanja) language

| Step | Do this | Expected result |
| --- | --- | --- |
| 1 | Settings → Language → Nyanja. | Every screen switches language. No English is left on Home, Record sale, Reconcile and Tax. |
| 2 | Record a sale in Nyanja. | The sale saves and amounts are still shown as K with two decimals. |
| 3 | Switch back to English. | Everything returns to English; no data is lost. |

## UAT-21 Staff add, first sign-in and owner-only screens

**Start:** UAT-03 completed, internet on, and the backend running.

| Step | Do this | Expected result |
| --- | --- | --- |
| 1 | Settings → Staff → **Add staff**. Enter name `Given`, phone `096 555 1122`, PIN `7315` twice. Save. | Given appears under Staff with "First sign-in pending". Settings still shows the owner row. |
| 2 | Sign out, then sign in with `7315` while online. | Home opens as Given, with no gross profit, discounts or Tax card. The Tax tab is gone. |
| 3 | Try Settings, Staff, Add product, Restock, Void sale and Tax. | None of those controls are visible. |
| 4 | While signed in as Given, open a deep link such as `stocksure://settings`, `stocksure://staff` or `stocksure://tax`. | None of the owner-only screens opens; the app falls back to an available screen. Confirm and note the exact fallback on this device. |
| 5 | Record a sale as Given. Open Sales. | The sale is listed with "Recorded by Given". Given cannot see cost or discount totals. |
| 6 | Sign out, sign in as the owner, and open the sale. | The owner sees cost, discounts and "Recorded by Given", and can void it. |
| 7 | On a second phone with no shop data, sign in as Given with phone `096 555 1122` and PIN `7315`. | The first sign-in needs internet and completes; the app says shop data is not on this phone yet. |
| 8 | Turn airplane mode on, force-close and reopen the second phone. | Given signs in with `7315` offline, and still sees the waiting screen. |
| 9 | On the owner's phone, with internet on, open Settings → Staff, tap **Change PIN** next to Given, enter `9042` twice and save. | "Given's PIN was changed." appears. |
| 10 | Sign out. Try `7315`, then sign in with `9042`. | `7315` is rejected. `9042` opens Home as Given. The owner's phone now uses the new PIN offline too. |

## UAT-22 Owner email sign-in and email code on a new phone

**Start:** UAT-03 completed on the owner's phone, a second phone with the app installed, internet on, and the backend running.

| Step | Do this | Expected result |
| --- | --- | --- |
| 1 | On the second phone, choose English. On "Create your account", tap **Already registered? Sign in with email**. | The email sign-in screen opens. |
| 2 | Enter `elton@example.com` and password `stocksure-demo`. Tap **Sign in**. | The app says the email isn't confirmed yet and that a 6-digit code was sent. A code box appears (a demo code card shows it in a development build). |
| 3 | Type a wrong code, e.g. `000000`. Tap **Confirm and sign in**. | "That code is not correct." The app stays on the code step. |
| 4 | Type the real code. Tap **Confirm and sign in**. | The "Set your phone PIN" screen opens; the email is now confirmed. |
| 5 | Enter PIN `4821` twice and save. | The app says shop data is not on this phone yet. |
| 6 | Turn airplane mode on, force-close and reopen. Enter `4821`. | The waiting screen opens offline. |
| 7 | Try the same code again from another sign-in. | It is rejected; each code works once. |
| 8 | Check the inbox. | Only code emails arrived; no email contains a sign-in link. |

**Note:** in a real deployment the code arrives by email and the demo card is hidden.
