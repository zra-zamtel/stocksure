from django.db import models


class Owner(models.Model):
    """The owner registered once, online, when the account is created.

    Email and password are the online identity. The primary key and `pin_hash`
    come from the phone; the PIN is the fast offline unlock on a trusted device.
    The PIN itself is never sent to the server. The server keeps `pin_hash` only
    to confirm that an idempotent registration retry comes from the same phone;
    sign-in never reads it.
    """

    id = models.CharField(primary_key=True, max_length=64)
    name = models.CharField(max_length=120)
    phone = models.CharField(max_length=20, unique=True)
    email = models.EmailField(max_length=254, unique=True, null=True, blank=True)
    password_hash = models.CharField(max_length=255, blank=True, default="")
    email_verified_at = models.DateTimeField(null=True, blank=True)
    pin_hash = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "owner"
        ordering = ["created_at"]

    def __str__(self) -> str:
        return f"{self.name} ({self.email or self.phone})"


class MagicLinkToken(models.Model):
    """A single-use, short-lived link sent to the owner's email.

    Only the SHA-256 hash is stored. Requesting a new link marks the previous
    one used, so there is never more than one live link per owner.
    """

    owner = models.ForeignKey(Owner, on_delete=models.CASCADE, related_name="magic_links")
    token_hash = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "magic_link_token"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"Magic link for {self.owner.email or self.owner.phone}"


class DeviceSession(models.Model):
    """A phone that signed in with email or a magic link.

    The token is stored hashed and is used for online calls that act on behalf
    of the owner, such as setting the local PIN on a new device.
    """

    owner = models.ForeignKey(Owner, on_delete=models.CASCADE, related_name="devices")
    token_hash = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    last_seen_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "device_session"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"Device for {self.owner.email or self.owner.phone}"


class Staff(models.Model):
    """A staff member the owner added so they can sign in with their own PIN.

    The server keeps only a Django password verifier for the first sign-in.
    The phone keeps its own salted hash for offline sign-in; sending that hash
    to the server would add a copy that no server path reads and that a
    database leak could crack in seconds.
    """

    id = models.CharField(primary_key=True, max_length=64)
    owner = models.ForeignKey(Owner, on_delete=models.CASCADE, related_name="staff")
    name = models.CharField(max_length=120)
    phone = models.CharField(max_length=20, unique=True)
    pin_verifier = models.CharField(max_length=255, blank=True, default="")
    first_signed_in_at = models.DateTimeField(null=True, blank=True)
    failed_sign_ins = models.PositiveSmallIntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "staff"
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
