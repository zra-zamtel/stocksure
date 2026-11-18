from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models

from apps.core.utils import validate_zm_phone


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create(self, phone, password, **extra):
        if not phone:
            raise ValueError("A phone number is required.")
        phone = validate_zm_phone(phone)
        user = self.model(phone=phone, **extra)
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
        return self._create(phone, password, **extra)


class User(AbstractBaseUser, PermissionsMixin):
    """Phone number is the login. Owners and assistants are both Users; their role per shop
    lives on shops.Membership."""

    class Language(models.TextChoices):
        ENGLISH = "en", "English"
        NYANJA = "ny", "Nyanja"

    phone = models.CharField(max_length=15, unique=True)
    full_name = models.CharField(max_length=150, blank=True)
    email = models.EmailField(blank=True)
    language = models.CharField(max_length=2, choices=Language.choices, default=Language.ENGLISH)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(auto_now_add=True)

    objects = UserManager()
    USERNAME_FIELD = "phone"
    REQUIRED_FIELDS = []

    def __str__(self):
        return f"{self.full_name or 'User'} ({self.phone})"
