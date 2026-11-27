# Nyanja review list

Generated from mobile/src/i18n/en.json and ny.json on the ux/words branch. Henry: please translate or fix these in ny.json. Keep every {placeholder} exactly as it is.

Plain-word rules for the app: say check money (not reconcile), tax on sales (not turnover tax), difference (not variance), sale (not transaction), payment code (not reference), type (not variant), backup (not sync), tax number (not TPIN), starting cash (not float).

## 1. Nyanja text that still uses the old English words (16)

| Key | English now | Nyanja now |
|---|---|---|
| onboarding.money.tpin | Tax number | TPIN |
| onboarding.money.tpinInvalid | A tax number has 10 digits. Leave it empty to skip. | TPIN ndi manambala 10. Siyani popanda kanthu kuti mudumphe. |
| tax.estimate | Estimated tax on sales | Msonkho woyerekeza wa turnover tax |
| tax.incomeTax | Sales this year have reached {amount}. Above this, income tax applies instead of the tax on sales, so no figure is shown. Speak to ZRA about income tax. | Malonda a chaka chino afika {amount}. Kuchokera pamenepa mumalipira income tax m'malo mwa turnover tax, choncho sitikuonetsa msonkho wa turnover tax. Lankhulani ndi ZRA za income tax. |
| insights.payments.takeaway | {percent}% came by mobile money. Check it on Money. | {percent}% yabwera kudzera pa mobile money. Fananitsani pa Reconcile. |
| payMsg.waiting | Saved. No sale matches it yet: it shows on Money as money with no sale. | Yasungidwa. Palibe malonda ogwirizana nayo: ikuoneka pa Reconcile ngati malipiro opanda malonda. |
| rtp.paid | Paid: {amount} received. Code {reference}. | Zalipidwa: {amount} zalandiridwa. Ref {reference}. |
| si.step1 | Type your tax number once. | Lembani TPIN yanu kamodzi. |
| si.tpin | Tax number | TPIN |
| si.error.tpin | A tax number has 10 digits. | TPIN ili ndi manambala 10. |
| si.card.turnoverTax | Tax on sales | Turnover tax |
| product.new.variants | Types | Variants |
| product.new.variantN | Type {n} | Variant {n} |
| product.new.error.noAxisValue | Enter a {axis} for each type so they can be told apart. | Enter a {axis} so each variant can be told apart. |
| product.new.error.duplicateVariant | Types {a} and {b} are the same. Change one or remove it. | Variants {a} and {b} are the same. Change one or remove it. |
| product.new.error.duplicateBarcode | Types {a} and {b} have the same barcode. Each needs its own. | Variants {a} and {b} have the same barcode. Each needs its own. |

## 2. Still in English (190)

| Key | English |
|---|---|
| app.name | StockSure |
| auth.signIn.pin | PIN |
| product.new.barcode | Barcode |
| sale.new.mobileMoney | Mobile money |
| tax.pot.title | TaxPot |
| insights.payments.MTN | MTN MoMo |
| insights.payments.Airtel | Airtel Money |
| insights.payments.Zamtel | Zamtel Kwacha |
| settings.mobileMoney | Mobile money |
| si.title | ZRA Smart Invoice |
| si.card.title | ZRA Smart Invoice |
| sales.method.mobileMoney | Mobile money |
| profile.fashion | Clothing & footwear |
| profile.fashion.caption | Dresses, shirts, chitenge, shoes |
| profile.salaula | Salaula (second-hand) |
| profile.salaula.caption | Bales sorted into top and down pieces |
| profile.health_beauty | Health & beauty |
| profile.health_beauty.caption | Cosmetics, pharmacy, personal care |
| profile.bar | Bar & bottle store |
| profile.bar.caption | Beer, spirits, soft drinks, snacks |
| profile.grocery | Grocery & mini-mart |
| profile.grocery.caption | Food, drinks, household goods |
| profile.electronics | Electronics & accessories |
| profile.electronics.caption | Phones, chargers, earphones, cables |
| profile.general | General goods |
| profile.general.caption | Anything else you sell |
| field.size | Size |
| field.colour | Colour |
| field.variant | Shade / strength |
| field.pack | Pack |
| field.packSize | Size / pack |
| field.storage | Storage |
| field.grade | Grade |
| settings.profileHint | Changing this changes the labels and defaults. It does not change products you already added. |
| product.new.unit | Unit |
| product.new.expiry | Expiry date |
| product.new.expiryHint | Year-month-day, for example 2027-06-30. Leave empty if it does not expire. |
| product.new.batch | Batch number |
| product.new.saleWarning | Sale warning |
| product.new.saleWarning.none | None |
| product.new.saleWarning.rx | Rx only |
| product.new.saleWarning.age | 18+ |
| product.new.error.expiry | Enter a real expiry date as year-month-day, for example 2027-06-30. |
| sale.warning.title | Check before selling |
| sale.warning.rx | Prescription-only: confirm the customer has a prescription. |
| sale.warning.age | Age-restricted: confirm the customer is 18 or older. |
| sale.warning.expired | This stock has expired. |
| sale.warning.continue | Sell anyway |
| products.unit | Unit |
| products.expiry | Expiry date |
| products.batch | Batch |
| products.saleWarning | Sale warning |
| products.expired | Expired |
| product.new.addVariant | Add another {axis} |
| product.new.removeVariant | Remove |
| products.restockExpiryHint | The new stock's expiry date. Leave empty to keep the current one. |
| home.expiring.title | Expiring soon |
| home.expiring.empty | Nothing expiring in the next 30 days |
| home.expiring.left | {count} in stock |
| products.filter.expiring | Expiring |
| products.expiresSoon | Expires soon |
| products.category.all | All categories |
| settings.profile | Shop profile |
| nav.today | Today |
| nav.stock | Stock |
| nav.money | Money |
| nav.sell | Sell |
| home.ask | What do you want to do? |
| home.today.seeSales | Opens today’s sales |
| home.tiles.add | Add product |
| home.tiles.sales | Sales |
| home.alert.restock | Restock |
| home.alert.expires | Expires {date} |
| home.alert.more | {count} more |
| home.alert.allGood | All stocked |
| home.alert.noProducts | Add your first product |
| home.backup.title | Backup |
| home.backup.ok | Backup is up to date |
| home.backup.attention | Backup is off. Tap to turn on |
| home.backup.problem | Backup has a problem. Tap to see |
| home.backup.okLong | Your sales and stock are saved online. |
| home.alert.seeProduct | See product |
| home.alert.seeStock | See stock |
| home.today.profitShort | Profit |
| sale.ask | Tap what the customer buys |
| sale.pick.removeOne | Remove one |
| sale.pick.inBasket | {count} in basket |
| sale.pick.addHint | Adds one to the sale |
| sale.pay | Pay |
| sale.pay.title | How did they pay? |
| sale.pay.cash | Cash |
| sale.pay.mobile | Mobile money |
| sale.pay.more | Cash and mobile money |
| sale.pay.continue | Continue |
| sale.done.title | Sale saved |
| sale.done.cash | Paid with cash |
| sale.done.mobile | Paid by mobile money |
| sale.done.split | Paid with cash and mobile money |
| sale.done.newSale | New sale |
| sale.done.finish | Done |
| sale.done.receipt | See receipt |
| sale.noAccess | Only someone who can record sales can use this screen. |
| sale.pay.alreadyPaid | Already paid: {amount}. Payment code {code}. |
| stock.ask | Tap a product to add stock |
| stock.restock.title | Add stock |
| stock.restock.pick | Which one? |
| stock.restock.now | Now {count} |
| stock.restock.add | Add {count} |
| stock.restock.less | One less |
| stock.restock.details | Product details |
| stock.restock.saved | Added {count}. Now {total}. |
| stock.state.ok | In stock |
| stock.state.low | Running low |
| stock.state.out | Out of stock |
| product.photo.take | Take photo |
| product.photo.retake | New photo |
| product.photo.gallery | From phone |
| product.photo.denied | The camera is blocked. Allow it in the phone settings. |
| product.step | Step {current} of {count} |
| product.ask.photo | Take a photo of it |
| product.ask.name | What is it called? |
| product.ask.price | What does it cost? |
| product.ask.count | How many do you have? |
| product.next | Next |
| product.previous | Back |
| product.skip | Skip |
| product.more | More details |
| product.buy | You pay |
| product.sell | You sell for |
| product.profit.good | Profit {amount} each |
| product.profit.even | No profit |
| product.profit.bad | Loss {amount} each |
| product.photo.failed | Could not take the photo. Try again. |
| products.showAll | Show all |
| keypad.delete | Delete |
| keypad.point | Point |
| money.ask | Does the money match? |
| money.allGood | All good |
| money.allGoodHint | Every mobile money sale has its money. |
| money.nothingYet | No mobile money yet today |
| money.toCheck | {count} to check |
| money.sales | Sales |
| money.moneyIn | Money in |
| money.came | Money came |
| money.none | No money |
| money.makeSale | Make sale |
| money.notSale | Not a sale |
| money.sellNoMoney | Sale, no money yet |
| money.moneyNoSale | Money, no sale |
| money.twoMatch | Check with customer |
| money.voidTitle | Cancel this sale? |
| money.voidBody | No money came for this {amount} sale. Cancelling puts the stock back. |
| money.voidConfirm | Cancel sale |
| money.keep | Keep it |
| money.cash.title | Count your cash |
| money.cash.start | Starting cash |
| money.cash.expected | Should be |
| money.cash.counted | Cash counted |
| money.cash.balanced | Balanced |
| money.cash.over | Over {amount} |
| money.cash.short | Short {amount} |
| money.cash.save | Save count |
| tax.ask | How much tax to put aside? |
| tax.owe | You may owe |
| tax.by | by {date} |
| tax.noDate | No due date yet |
| tax.estimateNote | An estimate, not a tax return. |
| tax.putAside | Put money aside |
| tax.how | How we got this |
| tax.jar.label | {saved} set aside of {owed} |
| tax.jar.of | set aside of {owed} |
| tax.jar.covered | Covered |
| tax.jar.short | Short {amount} |
| tax.jar.over | {amount} extra |
| tax.pot.putAsideAmount | I put aside {amount} |
| tax.pot.confirmPayTitle | Record ZRA payment? |
| tax.pot.confirmPayBody | Only do this after you have paid ZRA. It empties the pot ({amount}). |
| tax.pot.confirmPay | Record payment |
| connect.forRequest | Connect this phone to ask for mobile money |
| connect.forSmartInvoice | Connect this phone to use Smart Invoice |
| connect.forRecord | Connect this phone to make a trading record |
| tax.pot.recordOnly | StockSure doesn't move money. Keep this amount somewhere safe, then record it here. |
| onboarding.money.networksAsk | Which mobile money do your customers use? |
| onboarding.money.taxAsk | Do you pay ZRA tax on your sales? |
| onboarding.money.taxYes | Yes, I pay |
| onboarding.money.taxNo | No, not yet |
| onboarding.money.taxNumber | Tax number |
| onboarding.money.taxNumberHint | 10 digits. You can add it later. |
| onboarding.products.ask | Add the things you sell |
| onboarding.products.yours | Your products |
