import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.core.exceptions import AuthFailed, Locked, PhoneTaken
from apps.core.sms import send_sms
from apps.core.utils import validate_pin, validate_zm_phone

from .models import PinResetCode, User

# Checked when the phone number is unknown, so "unknown phone" and "wrong PIN" cost the same time.
_DUMMY_HASH = make_password("000000")


def register_owner(*, name, phone, pin, client_id=None):
    name = (name or "").strip()
    if not name:
        raise ValidationError({"name": "Name is required."})
    phone = validate_zm_phone(phone)
    validate_pin(pin)
    if User.objects.filter(phone=phone).exists():
        raise PhoneTaken()
    if client_id and User.objects.filter(client_id=client_id).exists():
        raise ValidationError({"id": "This id is already in use."})
    try:
        with transaction.atomic():
            return User.objects.create_user(
                phone=phone, password=pin, name=name, role=User.Role.OWNER, client_id=client_id or None
            )
    except IntegrityError:  # two requests with the same phone at the same moment
        raise PhoneTaken()


def authenticate_pin(phone, pin):
    """Return the active user for phone+PIN, counting failures and locking after too many."""
    try:
        phone = validate_zm_phone(phone)
    except ValidationError:
        raise AuthFailed()
    user = User.objects.filter(phone=phone, is_active=True).first()
    if user is None:
        check_password(pin or "", _DUMMY_HASH)
        raise AuthFailed()
    if user.is_locked:
        raise Locked()
    if not check_password(pin or "", user.password):
        user.failed_pins += 1
        if user.failed_pins >= settings.PIN_MAX_ATTEMPTS:
            user.failed_pins = 0
            user.locked_until = timezone.now() + timedelta(minutes=settings.PIN_LOCK_MINUTES)
        user.save(update_fields=["failed_pins", "locked_until"])
        raise Locked() if user.is_locked else AuthFailed()
    if user.failed_pins or user.locked_until:
        user.failed_pins = 0
        user.locked_until = None
        user.save(update_fields=["failed_pins", "locked_until"])
    return user


def change_pin(user, old_pin, new_pin):
    validate_pin(new_pin)
    if not check_password(old_pin or "", user.password):
        raise AuthFailed("The current PIN is wrong.")
    user.set_password(new_pin)
    user.save(update_fields=["password"])


# ---- PIN reset (forgotten PIN) ---------------------------------------------------------------
def request_pin_reset(phone):
    """Send a one-time code by SMS. Returns the code (so tests/dev can use it) or None.

    The API always answers the same way, whether or not the phone is registered, so this cannot be
    used to find out who has an account. Only owners reset themselves; staff ask their owner.
    """
    try:
        phone = validate_zm_phone(phone)
    except ValidationError:
        return None
    user = User.objects.filter(phone=phone, is_active=True, role=User.Role.OWNER).first()
    if user is None:
        return None
    recent = PinResetCode.objects.filter(user=user, created_at__gte=timezone.now() - timedelta(hours=1)).count()
    if recent >= 3:
        return None
    code = f"{secrets.randbelow(10**6):06d}"
    PinResetCode.objects.create(
        user=user, code_hash=make_password(code),
        expires_at=timezone.now() + timedelta(minutes=settings.PIN_RESET_MINUTES),
    )
    send_sms(phone, f"StockSure: your PIN reset code is {code}. It expires in {settings.PIN_RESET_MINUTES} minutes.")
    return code


def confirm_pin_reset(phone, code, new_pin):
    validate_pin(new_pin)
    bad = ValidationError({"code": "That code is wrong or has expired. Ask for a new one."})
    try:
        phone = validate_zm_phone(phone)
    except ValidationError:
        raise bad
    user = User.objects.filter(phone=phone, is_active=True, role=User.Role.OWNER).first()
    if user is None:
        raise bad
    entry = PinResetCode.objects.filter(user=user, used=False, expires_at__gt=timezone.now()).first()
    if entry is None or entry.attempts >= 5:
        raise bad
    if not check_password(str(code or ""), entry.code_hash):
        entry.attempts += 1
        entry.save(update_fields=["attempts"])
        raise bad
    with transaction.atomic():
        entry.used = True
        entry.save(update_fields=["used"])
        user.set_password(new_pin)
        user.failed_pins = 0
        user.locked_until = None
        user.save(update_fields=["password", "failed_pins", "locked_until"])
        PinResetCode.objects.filter(user=user, used=False).update(used=True)
    return user


# ---- staff ---------------------------------------------------------------------------------------
def create_staff(*, owner, client_id, name, phone, pin):
    """Idempotent on the phone-generated id: replaying the same request returns the same staff user."""
    if not client_id or not isinstance(client_id, str):
        raise ValidationError({"id": "The staff id created on the phone is required."})
    name = (name or "").strip()
    if not name:
        raise ValidationError({"name": "Name is required."})
    phone = validate_zm_phone(phone)
    validate_pin(pin)
    existing = User.objects.filter(client_id=client_id).first()
    if existing:
        if existing.owner_id == owner.id and existing.phone == phone:
            return existing, False
        raise ValidationError({"id": "This id is already in use."})
    if User.objects.filter(phone=phone).exists():
        raise PhoneTaken()
    try:
        with transaction.atomic():
            user = User.objects.create_user(
                phone=phone, password=pin, name=name, role=User.Role.STAFF, owner=owner, client_id=client_id
            )
    except IntegrityError:
        raise PhoneTaken()
    return user, True


def reset_staff_pin(*, owner, client_id, new_pin):
    validate_pin(new_pin)
    staff = User.objects.filter(client_id=client_id, owner=owner, role=User.Role.STAFF).first()
    if staff is None:
        return None
    staff.set_password(new_pin)
    staff.failed_pins = 0
    staff.locked_until = None
    staff.save(update_fields=["password", "failed_pins", "locked_until"])
    return staff
