from django.db import models


class Owner(models.Model):
    """The owner registered once, online, when the account is created.

    The primary key and `pin_hash` come from the phone. The PIN itself is never
    sent to the server. Sign-in happens on the phone against its local copy.
    """

    id = models.CharField(primary_key=True, max_length=64)
    name = models.CharField(max_length=120)
    phone = models.CharField(max_length=20, unique=True)
    pin_hash = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "owner"
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"{self.name} ({self.phone})"


class PinResetCode(models.Model):
    """A short-lived code for resetting a forgotten PIN.

    Only the hash is stored. Requesting a new code marks the previous one used,
    so there is never more than one live code for an owner.
    """

    owner = models.ForeignKey(Owner, on_delete=models.CASCADE, related_name="reset_codes")
    code_hash = models.CharField(max_length=255)
    expires_at = models.DateTimeField()
    attempts = models.PositiveSmallIntegerField(default=0)
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "pin_reset_code"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"Reset code for {self.owner.phone} at {self.created_at:%Y-%m-%d %H:%M}"
