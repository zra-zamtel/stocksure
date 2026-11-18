"""USSD menus (Africa's Talking style). `parts` is what the caller has typed so far, split on '*'.
Elton owns this file; data.py does the lookups and the sale. Replies start with CON (more input
expected) or END (finish) and must stay short: a screen holds about 160 characters."""
from rest_framework.exceptions import APIException

from apps.accounts import services as accounts
from apps.accounts.models import User

from . import data

PAGE = 6
MAIN_OWNER = "CON StockSure\n1. Record a sale\n2. Check stock\n3. Today's summary\n4. Tax estimate"
MAIN_STAFF = "CON StockSure\n1. Record a sale\n2. Check stock\n3. Today's summary"
NOT_SYNCED = "END No products have synced yet. Open the app with internet first."


def kwacha(ngwee: int) -> str:
    return f"K{ngwee / 100:,.2f}"


def _short(text: str, n: int = 20) -> str:
    return text if len(text) <= n else text[: n - 1] + "."


def _fit(reply: str, limit: int = 182) -> str:
    return reply if len(reply) <= limit else reply[: limit - 1] + "."


def _page_has_more(items, page):
    return (page + 1) * PAGE < len(items)


def handle(user, parts) -> str:
    try:
        return _fit(_route(user, parts))
    except APIException as exc:  # wrong PIN, locked account, ...
        return "END " + str(exc.detail)
    except data.UssdError as exc:
        return "END " + str(exc)


def _route(user, parts):
    is_owner = user.role == User.Role.OWNER
    if not parts:
        return MAIN_OWNER if is_owner else MAIN_STAFF
    choice = parts[0]
    if choice == "1":
        return _record_sale(user, parts)
    if choice == "2":
        return _stock(user)
    if choice == "3":
        s = data.today_summary(user.tenant_id)
        return (f"END Today: {kwacha(s['total'])} from {s['count']} sales.\n"
                f"Cash {kwacha(s['cash'])}, mobile money {kwacha(s['mobile'])}.")
    if choice == "4":
        return _tax(user) if is_owner else "END Tax is only for the shop owner."
    return "END Invalid choice."


def _stock(user):
    items = data.variants(user.tenant_id)
    if not items:
        return NOT_SYNCED
    items = sorted(items, key=lambda v: (v["stock"], v["label"].lower()))  # empty and lowest first
    lines = [f"{_short(v['label'], 30)}: {v['stock']}" for v in items[:5]]
    more = f"\n+{len(items) - 5} more in the app" if len(items) > 5 else ""
    return "END Stock, lowest first:\n" + "\n".join(lines) + more


def _tax(user):
    t = data.tax_estimate(user.tenant_id)
    if t is None:
        return "END Tax rules are not available yet."
    if t["no_period"]:
        return "END No tax period yet. Open the app with internet first."
    if t["turnover"] <= 0:
        return "END No sales in this period yet, so the estimate is K0.00."
    if not t["eligible"]:
        return (f"END Turnover {kwacha(t['turnover'])} is above the turnover tax limit in the rules. "
                "Confirm with ZRA. Estimate only.")
    unchecked = " Rules not yet checked with ZRA." if not t["validated_with_zra"] else ""
    return (f"END Estimated tax: {kwacha(t['estimated_tax'])} on {kwacha(t['turnover'])} sales. "
            f"Due {t['due_on']}. Estimate only, not a ZRA assessment.{unchecked}")


def _record_sale(user, parts):
    items = [v for v in data.variants(user.tenant_id) if v["stock"] > 0]
    if not items:
        return NOT_SYNCED if not data.variants(user.tenant_id) else "END Nothing is in stock."
    i, page = 1, 0
    while i < len(parts) and parts[i] == "7" and _page_has_more(items, page):
        page, i = page + 1, i + 1
    shown = items[page * PAGE:(page + 1) * PAGE]
    if i >= len(parts):
        lines = [f"{n}. {_short(v['label'], 18)} {kwacha(v['sell_price'])}" for n, v in enumerate(shown, 1)]
        if _page_has_more(items, page):
            lines.append("7. More")
        return "CON Sell which item?\n" + "\n".join(lines)
    if not parts[i].isdigit() or not 1 <= int(parts[i]) <= len(shown):
        return "END Invalid choice."
    item = shown[int(parts[i]) - 1]
    i += 1
    if i >= len(parts):
        return f"CON {_short(item['label'], 24)}: how many? ({item['stock']} in stock)"
    if not parts[i].isdigit() or int(parts[i]) < 1:
        return "END Invalid quantity."
    qty = int(parts[i])
    if qty > item["stock"]:
        return f"END Only {item['stock']} in stock."
    i += 1
    total = item["sell_price"] * qty
    if i >= len(parts):
        return f"CON Total {kwacha(total)}. Paid by:\n1. Cash\n2. Mobile money"
    method = {"1": "cash", "2": "mobile_money"}.get(parts[i])
    if method is None:
        return "END Invalid choice."
    i += 1
    if i >= len(parts):
        return "CON Enter your PIN to save the sale"
    if len(parts) > i + 1:
        return "END Invalid input."
    accounts.authenticate_pin(user.phone, parts[i])  # raises on a wrong PIN or a locked account
    sale = data.record_sale(user, item["id"], qty, method)
    return f"END Saved: {qty} x {_short(sale['label'], 22)}, {kwacha(sale['total'])}. It will show in the app."
