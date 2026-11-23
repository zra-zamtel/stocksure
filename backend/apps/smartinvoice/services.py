"""Send each sale to Smart Invoice on the trader's behalf.

The trader never sees VSDC codes. StockSure builds the saveSales request from
the sale it already has, sends it through the VSDC bridge, and gives the phone
back the receipt details ZRA returns, through the normal sync pull.
"""

import hashlib
import logging

from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone

from apps.sync.models import Sale, SyncChange

from .models import SmartInvoiceLink, SmartInvoiceReceipt
from .vsdc import get_vsdc

logger = logging.getLogger(__name__)

ENTITY = "smart_invoice_receipt"
# VSDC code lists (ZRA_VSDC_DOC v1.0.2, section 4).
PAYMENT_CODES = {"cash": "01", "mobile_money": "06"}
OTHER_PAYMENT = "07"
TAX_TYPE_TURNOVER = "TOT"
REFUND_REASON_OTHER = "13"
# The simulation does not yet ask the trader to classify items; a real
# deployment fetches codes from /itemClass/selectItemsClass.
DEFAULT_ITEM_CLASS = "5059690800"


class SmartInvoiceError(Exception):
    pass


def _kwacha(ngwee: int) -> float:
    return round(ngwee / 100, 2)


def _stamp(moment) -> str:
    return timezone.localtime(moment).strftime("%Y%m%d%H%M%S")


def item_code(variant_id: str) -> str:
    """A stable VSDC item code: ZM, finished product (2), net (NT), unit (U), 7 digits."""
    number = int(hashlib.sha256(variant_id.encode()).hexdigest(), 16) % 10_000_000
    return f"ZM2NTU{number:07d}"


def normalise_tpin(raw: str) -> str:
    digits = "".join(ch for ch in (raw or "") if ch.isdigit())
    if len(digits) != 10:
        raise SmartInvoiceError("A TPIN has 10 digits. You can find it on your ZRA registration certificate.")
    return digits


@transaction.atomic
def connect(shop, tpin: str) -> SmartInvoiceLink:
    """Register the shop's VSDC device and send every sale not yet sent."""
    tpin = normalise_tpin(tpin)
    existing = SmartInvoiceLink.objects.filter(shop=shop).first()
    if existing:
        if existing.tpin != tpin:
            raise SmartInvoiceError("This shop is already connected with a different TPIN.")
        return existing

    vsdc = get_vsdc()
    serial = f"STOCKSURE-{shop.id[-12:]}"
    name = shop.owner.full_name or shop.name
    result = vsdc.init_device(tpin, "000", serial, name)
    if result.get("resultCd") != "000":
        raise SmartInvoiceError(result.get("resultMsg") or "Smart Invoice did not accept this TPIN.")
    info = result["data"]["info"]
    link = SmartInvoiceLink.objects.create(
        shop=shop,
        tpin=tpin,
        branch_id=info.get("bhfId", "000"),
        device_serial=serial,
        taxpayer_name=info.get("taxprNm", name),
        sdc_id=info["sdcId"],
        mrc_no=info["mrcNo"],
        simulated=vsdc.simulated,
    )
    if shop.tpin != tpin:
        shop.tpin = tpin
        shop.save(update_fields=["tpin"])
    for sale in Sale.objects.filter(shop=shop).order_by("created_at"):
        send_sale(sale)
    return link


def _next_invoice_no(link: SmartInvoiceLink) -> int:
    SmartInvoiceLink.objects.filter(pk=link.pk).update(next_invoice_no=F("next_invoice_no") + 1)
    link.refresh_from_db(fields=["next_invoice_no"])
    return link.next_invoice_no - 1


def build_sale_request(link, sale, *, invoice_no: int, refund_of: SmartInvoiceReceipt | None = None) -> dict:
    lines = list(sale.lines.select_related("variant__product").order_by("created_at", "id"))
    payment = sale.payments.order_by("created_at").first()
    recorder = sale.recorded_by
    recorder_id = str(recorder.id) if recorder else "stocksure"
    recorder_name = (recorder.full_name if recorder else "") or "StockSure"
    now = timezone.now()

    items = []
    for seq, line in enumerate(lines, start=1):
        variant = line.variant
        label = " ".join(part for part in (variant.product.name, variant.size, variant.colour) if part)
        unit = _kwacha(line.list_price // line.quantity) if line.quantity else 0.0
        discount_rate = round(line.discount * 100 / line.list_price, 2) if line.list_price else 0.0
        items.append(
            {
                "itemSeq": seq,
                "itemCd": item_code(variant.id),
                "itemClsCd": DEFAULT_ITEM_CLASS,
                "itemNm": label[:200],
                "bcd": variant.barcode or None,
                "pkgUnitCd": "NT",
                "pkg": line.quantity,
                "qtyUnitCd": "U",
                "qty": line.quantity,
                "prc": unit,
                "splyAmt": _kwacha(line.list_price),
                "dcRt": discount_rate,
                "dcAmt": _kwacha(line.discount),
                "taxTyCd": TAX_TYPE_TURNOVER,
                "taxblAmt": _kwacha(line.final_price),
                "totTaxAmt": 0,
                "totAmt": _kwacha(line.final_price),
            }
        )

    if not items:
        # A sale recorded by amount only (USSD) becomes one general line.
        items.append(
            {
                "itemSeq": 1,
                "itemCd": "ZM3NTU0000001",
                "itemClsCd": DEFAULT_ITEM_CLASS,
                "itemNm": "Goods sold (amount only)",
                "bcd": None,
                "pkgUnitCd": "NT",
                "pkg": 1,
                "qtyUnitCd": "U",
                "qty": 1,
                "prc": _kwacha(sale.total),
                "splyAmt": _kwacha(sale.total),
                "dcRt": 0,
                "dcAmt": 0,
                "taxTyCd": TAX_TYPE_TURNOVER,
                "taxblAmt": _kwacha(sale.total),
                "totTaxAmt": 0,
                "totAmt": _kwacha(sale.total),
            }
        )

    total = _kwacha(sale.total)
    zero = 0
    request = {
        "tpin": link.tpin,
        "bhfId": link.branch_id,
        "invcNo": invoice_no,
        "orgInvcNo": refund_of.invoice_no if refund_of else 0,
        "custTpin": None,
        "custNm": None,
        "salesTyCd": "N",
        "rcptTyCd": "R" if refund_of else "S",
        "pmtTyCd": PAYMENT_CODES.get(payment.method, OTHER_PAYMENT) if payment else OTHER_PAYMENT,
        "salesSttsCd": "02",
        "cfmDt": _stamp(sale.created_at),
        "salesDt": timezone.localtime(sale.created_at).strftime("%Y%m%d"),
        "stockRlsDt": _stamp(sale.created_at),
        "cnclReqDt": None,
        "cnclDt": None,
        "rfdDt": _stamp(now) if refund_of else None,
        "rfdRsnCd": REFUND_REASON_OTHER if refund_of else None,
        "totItemCnt": len(items),
        "taxblAmtA": zero, "taxblAmtB": zero, "taxblAmtC": zero, "taxblAmtD": zero,
        "taxRtA": zero, "taxRtB": zero, "taxRtC": zero, "taxRtD": zero,
        "taxAmtA": zero, "taxAmtB": zero, "taxAmtC": zero, "taxAmtD": zero,
        "totTaxblAmt": total,
        "totTaxAmt": zero,
        "totAmt": total,
        "prchrAcptcYn": "N",
        "remark": (f"Void: {sale.void_reason}"[:400] if refund_of and sale.void_reason else None),
        "regrId": recorder_id[:20],
        "regrNm": recorder_name[:60],
        "modrId": recorder_id[:20],
        "modrNm": recorder_name[:60],
        "itemList": items,
    }
    return request


def phone_payload(receipt: SmartInvoiceReceipt) -> dict:
    return {
        "id": f"{receipt.sale_id}:{receipt.receipt_type}",
        "saleId": receipt.sale_id,
        "receiptType": receipt.receipt_type,
        "invoiceNo": receipt.invoice_no,
        "originalInvoiceNo": receipt.original_invoice_no,
        "resultCode": receipt.result_code,
        "resultMessage": receipt.result_message,
        "receiptNo": receipt.receipt_no,
        "receiptSignature": receipt.receipt_signature,
        "internalData": receipt.internal_data,
        "sdcId": receipt.sdc_id,
        "mrcNo": receipt.mrc_no,
        "publishedAt": receipt.published_at.isoformat() if receipt.published_at else None,
        "simulated": receipt.simulated,
    }


def _send(link, sale, receipt_type, refund_of=None) -> SmartInvoiceReceipt | None:
    if SmartInvoiceReceipt.objects.filter(sale=sale, receipt_type=receipt_type).exists():
        return None
    if sale.total <= 0:
        return None
    vsdc = get_vsdc()
    invoice_no = _next_invoice_no(link)
    request = build_sale_request(link, sale, invoice_no=invoice_no, refund_of=refund_of)
    result = vsdc.save_sales(request)
    data = result.get("data") or {}
    published = data.get("vsdcRcptPbctDate")
    try:
        with transaction.atomic():
            receipt = SmartInvoiceReceipt.objects.create(
                shop=sale.shop,
                sale=sale,
                receipt_type=receipt_type,
                invoice_no=invoice_no,
                original_invoice_no=refund_of.invoice_no if refund_of else 0,
                request=request,
                result_code=result.get("resultCd", "999"),
                result_message=(result.get("resultMsg") or "")[:200],
                receipt_no=data.get("rcptNo"),
                total_receipt_no=data.get("totRcptNo"),
                internal_data=data.get("intrlData", ""),
                receipt_signature=data.get("rcptSign", ""),
                sdc_id=link.sdc_id,
                mrc_no=link.mrc_no,
                published_at=(
                    timezone.make_aware(timezone.datetime.strptime(published, "%Y%m%d%H%M%S"))
                    if published
                    else None
                ),
                simulated=vsdc.simulated,
            )
    except IntegrityError:
        return None
    SyncChange.objects.create(
        shop=sale.shop,
        entity=ENTITY,
        entity_id=f"{sale.id}:{receipt_type}",
        operation="create",
        payload=phone_payload(receipt),
    )
    return receipt


def send_sale(sale: Sale) -> None:
    """Send a sale (and its refund, once voided). Safe to call repeatedly.

    A failure is logged and never blocks the sale itself: the shop keeps
    trading and the sale is sent on the next sync.
    """
    link = SmartInvoiceLink.objects.filter(shop_id=sale.shop_id).first()
    if link is None:
        return
    try:
        original = SmartInvoiceReceipt.objects.filter(
            sale=sale, receipt_type=SmartInvoiceReceipt.Type.SALE
        ).first() or _send(link, sale, SmartInvoiceReceipt.Type.SALE)
        if sale.status == Sale.Status.VOID and original and original.result_code == "000":
            _send(link, sale, SmartInvoiceReceipt.Type.REFUND, refund_of=original)
    except Exception as exc:  # noqa: BLE001 - never block a sale on the bridge
        logger.warning("Smart Invoice could not send sale %s: %s", sale.id, exc)


def status_for(shop) -> dict:
    link = SmartInvoiceLink.objects.filter(shop=shop).first()
    if link is None:
        return {"connected": False}
    receipts = SmartInvoiceReceipt.objects.filter(shop=shop)
    sent = receipts.filter(result_code="000")
    sent_sale_ids = sent.filter(receipt_type="S").values_list("sale_id", flat=True)
    return {
        "connected": True,
        "simulated": link.simulated,
        "tpin": link.tpin,
        "branchId": link.branch_id,
        "taxpayerName": link.taxpayer_name,
        "sdcId": link.sdc_id,
        "mrcNo": link.mrc_no,
        "connectedAt": link.connected_at.isoformat(),
        "sentCount": sent.filter(receipt_type="S").count(),
        "refundCount": sent.filter(receipt_type="R").count(),
        "failedCount": receipts.exclude(result_code="000").count(),
        "waitingCount": Sale.objects.filter(shop=shop).exclude(id__in=sent_sale_ids).count(),
        "lastSentAt": (
            sent.order_by("-created_at").values_list("created_at", flat=True).first().isoformat()
            if sent.exists()
            else None
        ),
    }
