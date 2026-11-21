"""Mobile money "request to pay" providers.

The prototype uses SimulatedProvider, so the whole flow works with no
merchant account and no real money. A real provider (MTN MoMo Collections,
Airtel Money Collections, or a payment company covering all three) is a new
subclass plus one setting, COLLECTIONS_PROVIDER, with no change to the app.
"""
import secrets
from dataclasses import dataclass

from django.conf import settings
from django.utils import timezone
from django.utils.module_loading import import_string


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


def get_provider() -> BaseCollectionProvider:
    return import_string(settings.COLLECTIONS_PROVIDER)()
