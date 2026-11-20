"""SMS gateway interface. The prototype logs messages; a real gateway (e.g. Zamtel bulk SMS,
Africa's Talking) is a new subclass plus one setting: SMS_BACKEND."""
import logging

from django.conf import settings
from django.utils.module_loading import import_string

logger = logging.getLogger(__name__)


class BaseSMSBackend:
    def send(self, phone: str, message: str):
        """Return (ok: bool, provider_message: str)."""
        raise NotImplementedError


class ConsoleSMSBackend(BaseSMSBackend):
    def send(self, phone, message):
        logger.info("[SMS -> %s] %s", phone, message)
        return True, "logged (no real SMS sent)"


def get_sms_backend() -> BaseSMSBackend:
    return import_string(settings.SMS_BACKEND)()
