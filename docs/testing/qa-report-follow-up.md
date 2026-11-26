# Follow-up to the QA report (22-25 Nov 2026)

Response to "StockSure Quality Assurance Report (Revised)" by Henry Mate. The
fixes below are in the build published after the merge of this change. Please
record the **build number** (on the release page and in the APK file name) and the
**phone, Android version and navigation mode** with every retest.

| ID | Result | What changed | Retest |
| --- | --- | --- | --- |
| QA-01 | Fixed | The PIN row now always spans the full width and each box asks for 44 px, may shrink to 36 px and grow to 52 px, so six boxes fit a 320 px screen and cannot collapse. The cause on your phone could not be reproduced in a browser, so please confirm on that phone. | Type 6 digits on Login, Staff sign-in, Set PIN and PIN reset. Try a 7th digit. |
| QA-02 | Fixed | The first two wrong PINs cost nothing. The 3rd and 4th wait 30 s, the 5th and 6th 1 min, the 7th and 8th 5 min, the 9th 15 min. After 10 the PIN is refused until the owner signs in with email and password. The count survives closing the app. Waits use the phone's uptime clock, so moving the date forward does not shorten them; a restart starts the wait again. A right PIN, an email sign-in or a PIN reset clears the count. Clearing the app's data deletes the shop from the phone, so it unlocks nothing. | Enter wrong PINs 1 to 11. Change the phone's clock forward. Restart the phone during a wait. |
| QA-03 | Fixed, needs a phone check | Every screen now makes room for the keyboard: the field being edited and the main button stay above it. | Add product (Sell price, Opening quantity), Sales checkout (quantity, split cash), Reconcile (Cash counted, Note), Staff, Settings. |
| QA-04 | Fixed in the build after yours, needs a phone check | The footer adds the live height of the system bar to its padding, so buttons clear a 3-button bar of any height. Earlier builds did not clear it reliably. | 3-button and gesture navigation: Login, Create account, Confirm email, Add product, Checkout, Reconcile. |
| QA-05 | Fixed | The sale could not be completed past stock before (it needed the owner's approval at the last step), but nothing said so while choosing. Now staff (and an owner who has staff) cannot raise a quantity above what is on hand, and the "+" greys out. An owner without staff can go over but sees "Only N in stock. Selling more needs your approval." on the line straight away. | Stock of 9: press "+" ten times as staff and as a solo owner. |
| QA-06 | Fixed | "Add sample messages (demo)" is gone from release builds. It appears only in development builds, or in a build made with the repository variable `MOBILE_DEMO_TOOLS=1`. Payment rows now wrap so the sender and reference can be read. | Open Reconcile on a release build: no demo link. |
| QA-06 note | Needs your input | "Cash counted" only shows a number after a count has been saved for that day (the code never fills it with the expected amount, and Difference only appears once a count exists). Please check whether a count was saved earlier in that test, and send the steps if it was empty before you typed. | Reconcile on a day with no saved count. |
| QA-07 | Fixed | A minus sign, letters and a second decimal separator are dropped as you type. Saving rejects empty, zero, three decimals and amounts above K10,000,000, with a message naming the field. `350,50` is read as 350.50. A sell price below the buy price is allowed and shows "you lose K x on every item sold" while typing. The same rules apply to the restock buy price. Quantity fields accept digits only. | `-50`, `0`, `1.2.3`, `350,50`, `12.345`, a sell price below the buy price. |

## Not changed

- The PIN is stored as a salted SHA-256, not a slow hash. With the lockout above,
  guessing on the phone is no longer practical, but someone who copies the
  phone's private database (a rooted phone) could still guess offline. A slow
  hash (PBKDF2 or Argon2) needs a native module and a one-time upgrade of stored
  PINs; it is a separate piece of work.
- A 6-digit minimum PIN is a policy choice for the owner; the app still allows
  4 to 6 digits.
