from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models
from django.utils import timezone

from apps.core.utils import validate_zm_phone


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create(self, phone, password, **extra):
        user = self.model(phone=validate_zm_phone(phone), **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, phone, password=None, **extra):
        extra.setdefault("is_staff", False)
        extra.setdefault("is_superuser", False)
        return self._create(phone, password, **extra)

    def create_superuser(self, phone, password=None, **extra):
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        extra.setdefault("role", User.Role.OWNER)
        return self._create(phone, password, **extra)


class User(AbstractBaseUser, PermissionsMixin):
    """An owner or a staff member. The password field holds the PIN, hashed by Django (never the PIN).

    All shop data belongs to the *owner*. A staff user points at their owner, so owner and staff
    sign in separately but sync into the same data set (`tenant_id`).
    """

    class Role(models.TextChoices):
        OWNER = "owner", "Owner"
        STAFF = "staff", "Staff"

    phone = models.CharField(max_length=15, unique=True)
    name = models.CharField(max_length=150)
    role = models.CharField(max_length=5, choices=Role.choices, default=Role.OWNER)
    owner = models.ForeignKey("self", null=True, blank=True, on_delete=models.CASCADE, related_name="staff_members")
    # The phone-generated record id (e.g. "owner_k3j2..."), so the app can match this account to its own rows.
    client_id = models.CharField(max_length=80, unique=True, null=True, blank=True)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)  # Django admin access, unrelated to the shop "staff" role
    failed_pins = models.PositiveSmallIntegerField(default=0)
    locked_until = models.DateTimeField(null=True, blank=True)
    date_joined = models.DateTimeField(auto_now_add=True)

    objects = UserManager()
    USERNAME_FIELD = "phone"
    REQUIRED_FIELDS = []

    @property
    def tenant_id(self):
        return self.id if self.role == self.Role.OWNER else self.owner_id

    @property
    def app_id(self):
        return self.client_id or str(self.pk)

    @property
    def is_locked(self):
        return bool(self.locked_until and self.locked_until > timezone.now())

    def __str__(self):
        return f"{self.name} ({self.phone}, {self.role})"


class PinResetCode(models.Model):
    """One-time code sent by SMS to the owner's phone. Only a hash of the code is stored."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="reset_codes")
    code_hash = models.CharField(max_length=128)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    attempts = models.PositiveSmallIntegerField(default=0)
    used = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]
