from django.conf import settings
from django.db import models


class UssdPin(models.Model):
    """The PIN a person types to sign in when they dial StockSure over USSD.

    It is separate from the app PIN, which never leaves the phone. The owner
    sets their own PIN in the app and sets one for each staff member, because
    staff sign in on the owner's connected phone and have no session of their
    own. Only a Django password hash is stored. Repeated wrong PINs lock dial-in
    for a short time so a 4-digit PIN cannot be guessed.
    """

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="ussd_pin"
    )
    pin_hash = models.CharField(max_length=255)
    failed_attempts = models.PositiveSmallIntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)
    set_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="+",
    )
    last_used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"USSD PIN for {self.user}"


class UssdPaymentRequest(models.Model):
    """A mobile money request sent from USSD, and the sale it becomes.

    USSD cannot wait while the customer types their PIN, so the session ends
    once the request is sent. The sale is written only when the provider says
    the customer paid, the same rule as the app: an unpaid request never
    becomes turnover. ``apps.ussd.momo.settle`` does that, whenever the shop
    next dials in, the phone syncs, or the person checks their requests.
    """

    payment_request = models.OneToOneField(
        "payment_collections.PaymentRequest", on_delete=models.CASCADE, related_name="ussd"
    )
    shop = models.ForeignKey("sync.Shop", on_delete=models.CASCADE, related_name="ussd_payment_requests")
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="+"
    )
    sale_id = models.CharField(max_length=64, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"USSD request {self.payment_request_id}"
