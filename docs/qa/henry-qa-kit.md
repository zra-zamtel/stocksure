# StockSure QA kit: can a shopkeeper use it without help?

For Henry. This kit tests the picture-first redesign with real shopkeepers.
Each session takes 20 minutes. You need 3 testers, and at least one should
be someone who reads little.

The question we are answering: **can a first-time user sell, restock and
check money without anyone explaining?** You watch and count. You do not
teach.

---

## 1. Before testing day (once, about 30 minutes)

You need: one Android phone with the latest StockSure test APK, mobile data,
a second phone for the customer's mobile money (optional), a pen, this kit
printed, and some small paper strips with tape (for the cover-the-words test).

Set up the test shop on the test phone, as the owner:

1. Open StockSure and finish setup:
   - Language: the tester's language. (Nyanja is still partly English; note
     any English word a Nyanja tester stumbles on.)
   - Shop: **Chiwala Fashions**, town **Lusaka**, trade **Clothing &
     footwear**, barcodes **Pick from a list**.
   - Money: tick **MTN** and **Airtel**. Tax: **No, not yet**.
2. Add these products (Stock > **Add product**). Take a photo of a real item
   for each if you can; it makes the test closer to real life.

   | Product | Size | Buy | Sell | How many | Low-stock level |
   |---|---|---|---|---|---|
   | Black school shoes | 42 | 180 | 280 | 8 | 3 |
   | Blue shirt | M | 90 | 160 | 2 | 3 |
   | Ladies handbag | | 250 | 450 | 1 | 2 |
   | Canvas sneakers | 41 | 200 | 320 | 2 | 3 |
   | Sports socks | | 25 | 60 | 20 | 5 |

   Blue shirt, Ladies handbag and Canvas sneakers start low. That gives one
   low item per tester for Task 3.
3. Record 3 cash sales of socks (Sell > tap Sports socks > **Pay** > **Cash**),
   so the Tax screen shows an amount.
4. Do the **reset** below once.

## 2. Reset before each tester (2 minutes)

1. If the last tester did not finish Task 4, open **Money** and press
   **Money came** on the old Airtel card first, so only one is waiting.
2. Make one unpaid Airtel sale for Task 4: **Sell** > tap **Sports socks**
   twice (K120) > **Pay** > **Mobile money** > **Already paid? Type the
   code** > network **Airtel**, leave the code empty > **Save sale**.
   Do **not** add a payment message for it. It now waits on **Money** as
   "Sale, no money yet".
3. Go back to **Today** (the first tab).
4. Note which low item is still low (it should be the next one in the table
   above) and write it in the score sheet.
5. Put the phone down, screen on, on the Today tab.

## 3. What to say (read this out, word for word)

> "Thank you for helping. We are testing the app, not you. If something is
> hard, that is the app's fault. I will ask you to do five shop jobs on this
> phone. Please try on your own. I will not help unless you are stuck for a
> long time. Say out loud what you are thinking if you can. There is no
> wrong answer."

Then give each task by reading the line in **Say**. Do not point at the
screen. Do not name buttons.

## 4. The five tasks

Start a timer when you finish reading the task. Stop it when the tester
reaches the **Done when** screen or gives up.

**If they are stuck for 60 seconds**, say once: "What are you looking
for?" If still stuck after another 30 seconds, show them, and mark the task
**Helped**.

### Task 1: Sell shoes for cash (limit 2 minutes)

- **Say:** "A customer wants the black school shoes and pays you cash. Sell them."
- **Expected path:** **Sell** (the blue button in the middle of the bottom bar) >
  tap the **Black school shoes** picture > **Pay · K…** > **Cash**.
- **Done when:** the big green tick appears with the amount.
- **Watch for:** do they find Sell? Do they tap the picture or look for a
  list? Do they understand the total on the bottom button?

### Task 2: Add a dress (limit 4 minutes)

- **Say:** "You bought a new dress for 100 kwacha. You will sell it for 150.
  You have 5 of them. Add it to the shop."
- **Expected path:** **Stock** tab > **Add product** (or **Add product** on
  Today) > photo (take one or **Skip**) > **Next** > name "Dress" > **Next** >
  "You pay" 100, "You sell for" 150 > **Next** > How many 5 (or tap **+5**) >
  **Save product**.
- **Done when:** the new product page opens.
- **Watch for:** do they skip the photo or get stuck? Do they see the green
  "Profit K50 each" line? Do they find the +5 button?

### Task 3: Add 10 to a low item (limit 2 minutes)

- **Say:** "You just got 10 more of the [name the low item from the reset].
  Put them in the shop."
- **Expected path:** either **Today** > the alert card > **Restock**, or
  **Stock** > tap the item. Then **+10** > **Add 10**.
- **Done when:** the sheet closes and the number has gone up by 10.
- **Watch for:** do they tap **+10** more than once by mistake? Do they use
  **−** to fix it? Do they press **Add 10** at the end?

### Task 4: Check the Airtel money came (limit 2 minutes)

- **Say:** "A customer paid you by Airtel earlier. She shows you the message
  on her phone: the money came. Tell the app."
- **Expected path:** **Money** tab > the card "Sale, no money yet" (Airtel,
  K120) > **Money came**.
- **Done when:** the card disappears and the status says **All good**.
- **Watch for:** do they press **No money** by mistake? (It asks first, with
  a red **Cancel sale**. If they confirm it, write that down: it cancels the
  sale.)

### Task 5: See the tax (limit 1 minute)

- **Say:** "How much tax might you have to pay, and by when?"
- **Expected path:** **Tax** tab, read the big amount and the date.
- **Done when:** they say the amount and the date out loud.
- **Watch for:** do they think the app takes the money? Ask afterwards:
  "Does the app send the money to ZRA?" (The right answer is no.)

## 5. Cover-the-words test (4 minutes)

This tests whether the pictures work on their own.

1. On the **Sell** screen, tape paper strips over the product names and over
   the words on the bottom button. Leave the pictures and prices showing.
2. **Say:** "Sell one pair of sports socks for cash."
3. Mark **Yes** if they finish without reading or asking, **No** if not.
4. Remove the paper. Cancel nothing; the sale is fine.

## 6. How to score

For each task, write:

- **Result:** ✔ alone, H with help, ✘ gave up.
- **Time** in seconds.
- **Wrong taps:** each tap that went somewhere they did not want (count
  them).
- **Read aloud:** words they read out or asked about, e.g. "what is Pay?".
  These are the words to fix.
- **Stuck at:** the screen and what they looked for.

**A task passes** when at least 2 of 3 testers do it alone (✔) within the
limit. **Any task the low-reading tester cannot do alone is a priority**,
even if the other two pass.

## 7. Score sheet (one per tester; print it)

Tester: ________  Reads: well / a little / not at all  Language: ______
Phone user for: ______ years  Low item for Task 3: ______________

| Task | Result (✔ / H / ✘) | Time (s) | Wrong taps | Words read aloud or asked | Stuck at |
|---|---|---|---|---|---|
| 1 Sell shoes for cash | | | | | |
| 2 Add a dress | | | | | |
| 3 Add 10 to low item | | | | | |
| 4 Airtel money came | | | | | |
| 5 See the tax | | | | | |
| Cover the words: sell socks | Yes / No | | | | |

After the tasks, ask and write the answers:

1. "What was the hardest part?"
2. "What would you change?"
3. "Does the app send money to ZRA?" (yes / no / not sure)

## 8. How to report

Within a day of testing, post on the agent board thread **#ux-overhaul**
(or send to the team):

1. **The table:** for each task, how many testers passed alone (e.g. "Task 2:
   1 of 3 alone").
2. **Top 3 problems**, each with the screen, what happened, and how many
   testers hit it. Example: "Add product, price step: 2 of 3 typed the sell
   price into 'You pay'."
3. **Words to fix:** every word testers read aloud or asked about.
4. **Photos** of the screen where someone got stuck (screenshot: hold power +
   volume down).
5. **Anything that looked broken** (wrong numbers, a crash, a frozen screen),
   with the time it happened.

The team fixes the top 3 problems, builds a new APK, and you test again.
