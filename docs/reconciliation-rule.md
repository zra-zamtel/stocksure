# Reconciliation matching rule

This note records a deliberate change from section 6 of the scope sheet, so the
team can accept or reject it knowingly.

## What the scope sheet says

> A recorded sale and a payment are matched when the amount and the reference
> agree and the times are close.

## Why that does not survive the counter

The reference only exists in the provider's confirmation message, and that
message arrives on the **shop's phone** after the customer pays. At the moment
the cashier records the sale, nobody has the reference yet. Requiring one means
asking the cashier to read a 20-character code from a customer's phone while a
queue forms. In practice that means either invented references or skipped sales,
and both are worse than an imperfect match.

## The rule we use instead

A sale and a received payment match when all of these hold:

1. The amount is identical.
2. The provider is identical, when both sides record one.
3. The times are within the window (30 minutes by default).
4. **If both sides have a reference, they agree.** The reference only decides
   when the customer read it out and the cashier typed it at the counter.

The provider's message always carries a reference and the cashier usually types
none, so a reference on one side only is the normal case and is no reason to
refuse a match: amount, provider and time decide. (An earlier version refused
one-sided pairs; in practice that left almost every real sale unmatched.)
A typed reference that disagrees with the message rules that message out, which
also lets the cashier settle a tie by typing the reference.

If a sale has **more than one** payment that fits, it is reported as
**needs review** and nothing is matched. A human chooses, because a wrong match
moves money into the turnover tax estimate.

## Consequences

- `payment.mobile_money_reference` is optional at the counter.
- `matchPayments()` returns `ambiguousSales` alongside matched and unmatched.
- `sale.reconcile_status` uses `unresolved` for a needs-review sale, so the Tax
  screen keeps warning about it.
- Matching stays one-to-one and deterministic. Ambiguity is judged from both
  sides: a payment that fits more than one sale is also **needs review**, so
  the older sale never takes it just for being first.
- A sale the owner confirms by hand ("money arrived") is stored on its payment
  and is not re-matched, so it stays resolved and cannot claim a message.
- A sale near midnight is matched against messages up to the window either side
  of the day, so a payment that lands after midnight still finds its sale.
- A match, once made, is stored as a pair on the payment (`matched_txn_id`) and
  is not re-decided. A later run may not see the other half (it fell on the
  neighbouring day), and a sale recorded later must not turn a settled match
  into needs review. Voiding the sale releases the message, because only
  active sales hold a pair.

## What this does not change

- The tax estimate still prefers reconciled sales, and unresolved items still
  show as a warning on the Tax screen.
- A payment can never be matched by amount alone with more than one candidate.
- Ignored payments stay in the database for the audit trail.

## Tests

`mobile/src/core/core.test.ts` covers: reference agreement, no-reference single
candidate, one-sided references (both directions), a typed reference breaking a tie, provider mismatch, time window, and the
ambiguous case where two payments fit one sale. `mobile/src/db/repos.integration.test.ts`
(IT-REC) covers the stored decisions: hand confirmation, ignored messages,
cross-midnight pairs in both directions, and release on void.

## Getting the messages in

The app cannot read the shop phone's SMS inbox (not possible in Expo Go, and
Google Play restricts the SMS permission). The owner copies the provider's
"you have received" message and pastes it under Reconcile, "Paste a payment
message". `core/momo-message.ts` reads the amount, reference, sender, time and
provider; the owner checks them and types anything it could not read. The same
reference cannot be added twice, so one payment never settles two sales.

## Decision needed

This deviates from the scope sheet as written. If the team prefers the stricter
rule, the cashier will need the reference typed, and the flow should say so on
the sale screen. The code currently follows the rule above.
