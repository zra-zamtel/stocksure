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
4. The references agree, **or** neither side has one.

If only one side has a reference, they do not match: that is not evidence.

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

## What this does not change

- The tax estimate still prefers reconciled sales, and unresolved items still
  show as a warning on the Tax screen.
- A payment can never be matched by amount alone with more than one candidate.
- Ignored payments stay in the database for the audit trail.

## Tests

`mobile/src/core/core.test.ts` covers: reference agreement, no-reference single
candidate, one-sided reference refusal, provider mismatch, time window, and the
ambiguous case where two payments fit one sale.

## Decision needed

This deviates from the scope sheet as written. If the team prefers the stricter
rule, the cashier will need the reference typed, and the flow should say so on
the sale screen. The code currently follows the rule above.
