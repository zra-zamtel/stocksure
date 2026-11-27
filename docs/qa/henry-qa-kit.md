# StockSure QA kit for Henry

Henry, use this to test the new picture-first StockSure on your own, then
write a short report. Pretend you have never seen the app: do each job,
check what you see against what should happen, and write down anything
slow, confusing or wrong. About 45 minutes.

The same kit is in Claude Docs as "StockSure QA kit for Henry", with a
results sheet you can fill in on the phone or print.

## Set up the test shop (once, about 20 minutes)

A new install starts with an empty shop, so set one up first. You need an
Android phone with the latest StockSure test APK, mobile data, and this
sheet.

1. Open StockSure and finish setup as the owner, in **English**:
   - Shop: **Chiwala Fashions**, town **Lusaka**, trade **Clothing &
     footwear**, barcodes **Pick from a list**.
   - Money: tick **MTN** and **Airtel**. Tax: **No, not yet**.
2. Add these products (**Stock** > **Add product**). Take a photo of a real
   item for at least two of them, so you also test photos.
3. Record 3 cash sales of socks (**Sell** > tap **Sports socks** > **Pay** >
   **Cash**) so the Tax screen shows an amount.

| Product | Size | Buy (K) | Sell (K) | How many | Low-stock level |
|---|---|---|---|---|---|
| Black school shoes | 42 | 180 | 280 | 8 | 3 |
| Blue shirt | M | 90 | 160 | 2 | 3 |
| Ladies handbag | | 250 | 450 | 1 | 2 |
| Canvas sneakers | 41 | 200 | 320 | 2 | 3 |
| Sports socks | | 25 | 60 | 20 | 5 |

Blue shirt, Ladies handbag and Canvas sneakers start low, so you have a low
item for each round.

## Reset before each round (2 minutes)

Do one round of the five jobs in English, then a second round in Nyanja (see
Extra checks). Before each round:

1. If an old Airtel card is still waiting on **Money**, press **Money came**
   on it.
2. Make one unpaid Airtel sale for job 4: **Sell** > tap **Sports socks**
   twice (K120) > **Pay** > **Mobile money** > **Already paid? Type the code**
   > network **Airtel**, leave the code empty > **Save sale**. Do not add a
   payment message.
3. Go back to **Today**, the first tab.

## How to test

The app is meant for a shopkeeper who reads little and has never used it.
Act like that person.

- Look for the picture first, then the words. Note any step where you had to
  read to know what to do.
- Use one thumb, holding the phone in one hand, like at a counter.
- Time each job with your phone's stopwatch.
- Each time you hesitate, tap the wrong thing, or the screen surprises you,
  write it down straight away, with a screenshot (hold power and volume
  down).
- Compare what you see with the **You should see** column. Anything
  different is a problem, even if small.

## The five jobs

| Job | Do | Expected path | You should see | Target time |
|---|---|---|---|---|
| 1 Sell shoes for cash | Sell the black school shoes, paid in cash | **Sell** (blue, middle of the bottom bar) > tap the shoes picture > **Pay · K…** > **Cash** | A big green tick with K280; shoes stock goes down by 1 | 1 min |
| 2 Add a dress | Add a dress: buy 100, sell 150, 5 in stock | **Stock** > **Add product** > photo or **Skip** > **Next** > name > **Next** > You pay 100, You sell for 150 > **Next** > 5 (or **+5**) > **Save product** | "Profit K50 each" with a green up arrow on the price step; then the dress page with 5 in stock | 3 min |
| 3 Add 10 to a low item | Add 10 to the next low item | **Today** alert card > **Restock** (or **Stock** > tap the item) > **+10** > **Add 10** | "Now N" goes up by 10 before you save; nothing saved if you close the sheet; after saving, the card no longer shows it as low | 1 min |
| 4 Airtel money came | Mark the K120 Airtel sale as paid | **Money** > the "Sale, no money yet" card > **Money came** | The card goes; the status turns green **All good**; **No money** first asks "Cancel this sale?" | 1 min |
| 5 See the tax | Find how much tax you may owe and by when | **Tax** tab | "You may owe K…" with a date; the jar; "An estimate, not a tax return"; **I put aside K…** on the next screen does not move money | 30 s |

## Extra checks

- [ ] **No internet:** turn on airplane mode and do job 1 again. The sale
  must save and show the green tick.
- [ ] **Nyanja:** Settings > language **Nyanja**, then do the five jobs
  again. The Nyanja is a first-pass machine translation: write down every
  line that is wrong, sounds unnatural, or is too long for its button.
- [ ] **Dark mode:** Settings > theme **Dark**. Look at Today, Sell, Stock,
  Money and Tax. Note anything hard to read.
- [ ] **Numbers add up:** the Today total equals the sales you made; stock
  numbers match what you sold and added; the profit shown for the dress is
  K50.
- [ ] **Pictures only:** on Sell, Stock and Money, check that every button
  has a picture or icon next to its word, and that no status is shown by
  colour alone.
- [ ] **Photos:** a product with a photo shows the photo on Sell and Stock;
  one without shows a coloured tile with an icon.
- [ ] **Backup cloud:** the cloud at the top of Today opens a sheet that says
  what to do.

## Results sheet

Fill one row per job and round. Pass = done without reading the words,
matching **You should see**, within the target time.

| Job | Round | Pass / Fail | Time | What went wrong or slowed you | Screenshot |
|---|---|---|---|---|---|
| 1 Sell shoes for cash | English | | | | |
| 2 Add a dress | English | | | | |
| 3 Add 10 to a low item | English | | | | |
| 4 Airtel money came | English | | | | |
| 5 See the tax | English | | | | |
| 1 Sell shoes for cash | Nyanja | | | | |
| 2 Add a dress | Nyanja | | | | |
| 3 Add 10 to a low item | Nyanja | | | | |
| 4 Airtel money came | Nyanja | | | | |
| 5 See the tax | Nyanja | | | | |

## Write your report

When you have finished, write a short report and send it to Elton, with your
screenshots. Use these headings:

1. **Summary:** how many jobs passed, e.g. "English 4 of 5, Nyanja 3 of 5",
   and the APK version you tested.
2. **Problems:** one line each, worst first. For each: the screen, what you
   did, what happened, what you expected, and how bad it is: **blocks**
   (cannot finish the job), **slows** (finished but hard), or **looks wrong**
   (a wrong number, word or picture).
3. **Words to change:** every word you had to read to understand, and every
   Nyanja word that is wrong or still in English.
4. **Extra checks:** which ones failed, and what you saw.
5. **Ideas:** anything that would make it easier for a shopkeeper who reads
   little.

Keep it short. A list of clear problems with screenshots is more useful than
long paragraphs.
