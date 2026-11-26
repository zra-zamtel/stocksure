"""Mobile money "request to pay" providers.

The prototype uses SimulatedProvider, so the whole flow works with no
merchant account and no real money. A real provider (MTN MoMo Collections,
Airtel Money Collections, or a payment company covering all three) is a new
subclass plus one setting, COLLECTIONS_PROVIDER, with no change to the app.
"""
import logging
import secrets
from dataclasses import dataclass
from decimal import Decimal

import httpx
from django.conf import settings
from django.utils import timezone
from django.utils.module_loading import import_string

logger = logging.getLogger(__name__)


class ProviderError(Exception):
    """A provider failure whose message is safe to show at the counter."""


@dataclass
class ProviderStatus:
    status: str  # "pending", "successful" or "failed"
    reference: str = ""
    reason: str = ""


class BaseCollectionProvider:
    def start(self, request) -> None:
        """Ask the provider to prompt the customer. Raise to report a failure."""
        raise NotImplementedError

    def check(self, request) -> ProviderStatus:
        """Report where the request stands now."""
        raise NotImplementedError


class SimulatedProvider(BaseCollectionProvider):
    """Approves every request after a short delay, as if the customer typed
    their PIN. Test numbers ending in 000 are declined; numbers ending in 111
    never answer, so the request times out."""

    def start(self, request) -> None:
        return None

    def check(self, request) -> ProviderStatus:
        waited = (timezone.now() - request.created_at).total_seconds()
        if waited < settings.COLLECTIONS_SIMULATED_DELAY_SECONDS or request.phone.endswith("111"):
            return ProviderStatus("pending")
        if request.phone.endswith("000"):
            return ProviderStatus("failed", reason="The customer declined the payment.")
        prefix = {"MTN": "MP", "Airtel": "PP", "Zamtel": "ZK"}.get(request.provider, "SIM")
        return ProviderStatus("successful", reference=f"{prefix}SIM{secrets.token_hex(4).upper()}")


class LipilaProvider(BaseCollectionProvider):
    """Lipila mobile-money collections: one API for MTN, Airtel and Zamtel.

    Lipila works out the network from the number, so no provider field is sent.
    The request id is our referenceId, which is also how its status is checked.
    """

    COLLECT_PATH = "/api/v1/collections/mobile-money"
    STATUS_PATH = "/api/v1/collections/check-status"

    def _headers(self, *, with_body: bool = False) -> dict[str, str]:
        headers = {"accept": "application/json", "x-api-key": settings.LIPILA_API_KEY}
        if with_body:
            # Only the POST carries these. Lipila answers 400 to a status GET
            # that says Content-Type: application/json (found in the K1 test).
            headers["Content-Type"] = "application/json"
            if settings.LIPILA_CALLBACK_URL:
                headers["callbackUrl"] = settings.LIPILA_CALLBACK_URL
        return headers

    def _url(self, path: str) -> str:
        return settings.LIPILA_BASE_URL.rstrip("/") + path

    @staticmethod
    def _body(response: httpx.Response) -> dict:
        try:
            body = response.json()
        except ValueError:
            return {}
        return body if isinstance(body, dict) else {}

    def start(self, request) -> None:
        payload = {
            "referenceId": request.id,
            # Lipila takes kwacha; the app stores ngwee. The customer pays the
            # sale plus the fee passed on to them (0 when none is).
            "amount": float(Decimal(request.amount_ngwee + getattr(request, "fee_ngwee", 0)) / 100),
            "narration": settings.LIPILA_NARRATION,
            "accountNumber": request.phone,
            "currency": "ZMW",
        }
        try:
            response = httpx.post(
                self._url(self.COLLECT_PATH),
                json=payload,
                headers=self._headers(with_body=True),
                timeout=settings.LIPILA_TIMEOUT_SECONDS,
            )
        except httpx.HTTPError as exc:
            raise ProviderError("The payment service could not be reached. Try again.") from exc

        body = self._body(response)
        message = str(body.get("message") or "").strip()
        if not response.is_success:
            logger.warning("Lipila refused request %s: HTTP %s %s", request.id, response.status_code, message)
            raise ProviderError(message or f"The payment service refused the request (HTTP {response.status_code}).")
        if str(body.get("status") or "").lower() == "failed":
            raise ProviderError(message or "The payment service could not start the payment.")
        # A handle for support; the status check still keys off our referenceId.
        request.provider_reference = str(body.get("identifier") or "")[:80]

    def check(self, request) -> ProviderStatus:
        try:
            response = httpx.get(
                self._url(self.STATUS_PATH),
                params={"referenceId": request.id},
                headers=self._headers(),
                timeout=settings.LIPILA_TIMEOUT_SECONDS,
            )
        except httpx.HTTPError as exc:
            raise ProviderError("The payment service could not be reached.") from exc

        # Lipila has not recorded the request yet: still waiting, not a failure.
        if response.status_code == 404:
            return ProviderStatus("pending")
        if not response.is_success:
            raise ProviderError(f"The payment service status check failed (HTTP {response.status_code}).")

        body = self._body(response)
        state = str(body.get("status") or "").lower()
        reference = str(body.get("externalId") or body.get("identifier") or "")[:80]
        message = str(body.get("message") or "").strip()
        # Key off status only: a Pending response can still say "Transaction Successful".
        if state == "successful":
            return ProviderStatus("successful", reference=reference, reason=message)
        if state == "failed":
            return ProviderStatus(
                "failed", reference=reference, reason=message or "The payment was declined or failed."
            )
        return ProviderStatus("pending")


def get_provider() -> BaseCollectionProvider:
    return import_string(settings.COLLECTIONS_PROVIDER)()
