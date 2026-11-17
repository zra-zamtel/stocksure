import math
from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.core.utils import money

from .models import SavingsTarget, SuggestionLog, TaxPotTransaction, Wallet

SIM_NOTE = "Simulated: no real money was moved."


def get_wallet(shop):
    wallet, _ = Wallet.objects.get_or_create(shop=shop)
    return wallet


def progress(target):
    saved = target.saved_amount()
    remaining = max(target.target_amount - saved, Decimal("0"))
    pct = Decimal("100") if target.target_amount <= 0 else min(saved / target.target_amount * 100, Decimal("100"))
    return {"saved": saved, "remaining": remaining, "percent": pct.quantize(Decimal("0.1"))}


def suggestion(target, today=None):
    """Suggested contribution for the owner's chosen approach. The owner can accept, change or skip it."""
    today = today or timezone.localdate()
    p = progress(target)
    out = {"target_id": target.id, "approach": target.approach, "remaining": p["remaining"], "amount": None, "message": ""}
    if p["remaining"] <= 0:
        out["message"] = "Target reached."
        out["amount"] = Decimal("0.00")
        return out
    if target.approach == SavingsTarget.Approach.MANUAL:
        out["message"] = "You save whenever you choose."
        return out
    if not target.due_date:
        out["message"] = "Set a due date to get a suggested amount."
        return out
    days_left = (target.due_date - today).days
    out["overdue"] = days_left < 0
    days_left = max(days_left, 1)
    periods = {
        SavingsTarget.Approach.DAILY: days_left,
        SavingsTarget.Approach.WEEKLY: math.ceil(days_left / 7),
        SavingsTarget.Approach.MONTHLY: math.ceil(days_left / 30),
    }[target.approach]
    out["amount"] = money(p["remaining"] / periods)
    out["periods_left"] = periods
    out["message"] = f"Save about K{out['amount']:.2f} {target.get_approach_display().lower()} to be ready by the due date."
    return out


@transaction.atomic
def contribute(*, shop, target, amount, source, user=None):
    amount = money(amount)
    if amount <= 0:
        raise ValidationError({"amount": "Amount must be more than zero."})
    wallet = Wallet.objects.select_for_update().get(pk=get_wallet(shop).pk)
    suggested = suggestion(target)["amount"] if target else None
    wallet.balance += amount
    wallet.save(update_fields=["balance", "updated_at"])
    tx = TaxPotTransaction.objects.create(
        wallet=wallet, target=target, kind=TaxPotTransaction.Kind.DEPOSIT, source=source,
        amount=amount, balance_after=wallet.balance, note=SIM_NOTE, created_by=user,
    )
    if target and source == TaxPotTransaction.Source.SUGGESTED:
        SuggestionLog.objects.create(
            target=target, suggested_amount=suggested, actual_amount=amount,
            action=SuggestionLog.Action.ACCEPTED if suggested == amount else SuggestionLog.Action.CHANGED,
        )
    return tx


def skip_suggestion(target):
    s = suggestion(target)
    return SuggestionLog.objects.create(target=target, suggested_amount=s["amount"], action=SuggestionLog.Action.SKIPPED)


@transaction.atomic
def simulate_payment(*, shop, target, amount, user=None):
    amount = money(amount)
    wallet = Wallet.objects.select_for_update().get(pk=get_wallet(shop).pk)
    if amount <= 0:
        raise ValidationError({"amount": "Amount must be more than zero."})
    if amount > wallet.balance:
        raise ValidationError({"amount": f"Your TaxPot balance is only K{wallet.balance:.2f}."})
    wallet.balance -= amount
    wallet.save(update_fields=["balance", "updated_at"])
    return TaxPotTransaction.objects.create(
        wallet=wallet, target=target, kind=TaxPotTransaction.Kind.TAX_PAYMENT, source=TaxPotTransaction.Source.VOLUNTARY,
        amount=amount, balance_after=wallet.balance, note=SIM_NOTE + " Pay ZRA through official channels.", created_by=user,
    )


def prepare_payment(shop, target):
    wallet = get_wallet(shop)
    p = progress(target)
    shortfall = max(target.target_amount - wallet.balance, Decimal("0"))
    return {
        "target": target.name,
        "target_amount": target.target_amount,
        "due_date": target.due_date,
        "wallet_balance": wallet.balance,
        "shortfall": shortfall,
        "ready": shortfall == 0,
        "estimate_id": target.estimate_id,
        "checklist": [
            "Confirm the amount and the due date with ZRA - the figure here is only an estimate.",
            "Have your TPIN ready.",
            "Pay through ZRA's official channels. StockSure does not pay ZRA for you.",
            "Keep the payment confirmation with your records.",
        ],
        "disclaimer": "Simulated wallet. Estimates are not official assessments.",
        **{"saved_towards_target": p["saved"]},
    }
