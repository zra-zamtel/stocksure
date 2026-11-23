"""The VSDC bridge.

ZRA's VSDC (API spec ZRA_VSDC_DOC v1.0.2) is software a taxpayer installs after
applying and being approved. StockSure talks to it on the trader's behalf.

``SimulatedVsdc`` is a sandbox that behaves like the real thing: it checks the
same required fields and answers with the same response shape (result code,
receipt number, signature, SDC id). A real deployment adds a subclass that
POSTs to the installed VSDC and sets ``SMART_INVOICE_BACKEND``.
"""

import hashlib
import secrets

from django.conf import settings
from django.utils import timezone
from django.utils.module_loading import import_string

REQUIRED_SALE_FIELDS = (
    "tpin", "bhfId", "invcNo", "orgInvcNo", "salesTyCd", "rcptTyCd", "salesSttsCd",
    "cfmDt", "salesDt", "totItemCnt", "totTaxblAmt", "totTaxAmt", "totAmt",
    "prchrAcptcYn", "regrId", "regrNm", "modrId", "modrNm", "itemList",
)
REQUIRED_ITEM_FIELDS = (
    "itemSeq", "itemCd", "itemNm", "pkgUnitCd", "pkg", "qtyUnitCd", "qty", "prc",
    "splyAmt", "dcRt", "dcAmt", "taxTyCd", "taxblAmt", "totTaxAmt", "totAmt",
)


def _stamp(moment=None) -> str:
    return (moment or timezone.now()).strftime("%Y%m%d%H%M%S")


class BaseVsdc:
    simulated = True

    def init_device(self, tpin: str, branch_id: str, device_serial: str, taxpayer_name: str) -> dict:
        raise NotImplementedError

    def save_sales(self, request: dict) -> dict:
        raise NotImplementedError


class SimulatedVsdc(BaseVsdc):
    """A sandbox VSDC. Nothing leaves the server."""

    simulated = True

    def init_device(self, tpin, branch_id, device_serial, taxpayer_name):
        digest = hashlib.sha256(f"{tpin}:{branch_id}:{device_serial}".encode()).hexdigest().upper()
        return {
            "resultCd": "000",
            "resultMsg": "It is succeeded",
            "resultDt": _stamp(),
            "data": {
                "info": {
                    "tpin": tpin,
                    "taxprNm": taxpayer_name,
                    "bhfId": branch_id,
                    "dvcId": device_serial,
                    "sdcId": f"SDC-SIM-{digest[:6]}",
                    "mrcNo": f"SIM{digest[6:14]}",
                }
            },
        }

    def save_sales(self, request):
        missing = [key for key in REQUIRED_SALE_FIELDS if request.get(key) is None]
        for item in request.get("itemList") or []:
            missing += [f"itemList.{key}" for key in REQUIRED_ITEM_FIELDS if item.get(key) is None]
        if missing or not request.get("itemList"):
            return {
                "resultCd": "910",
                "resultMsg": "Request parameter error: " + ", ".join(missing or ["itemList"]),
                "resultDt": _stamp(),
                "data": None,
            }
        signature = secrets.token_hex(8).upper()
        internal = secrets.token_hex(13).upper()
        return {
            "resultCd": "000",
            "resultMsg": "It is succeeded",
            "resultDt": _stamp(),
            "data": {
                "rcptNo": request["invcNo"],
                "intrlData": internal,
                "rcptSign": signature,
                "totRcptNo": request["invcNo"],
                "vsdcRcptPbctDate": _stamp(),
            },
        }


def get_vsdc() -> BaseVsdc:
    return import_string(settings.SMART_INVOICE_BACKEND)()
