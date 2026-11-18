"""SMS interface (used for PIN-reset codes). Console just logs; swap SMS_BACKEND for a real gateway later."""
import logging

from django.conf import settings
from django.utils.module_loading import import_string

logger = logging.getLogger(__name__)


class BaseSMSBackend:
    def send(self, phone: str, message: str) -> bool:
        raise NotImplementedError


class ConsoleSMSBackend(BaseSMSBackend):
    def send(self, phone, message):
        logger.info("[SMS -> %s] %s", phone, message)
        return True


def send_sms(phone: str, message: str) -> bool:
    try:
        return import_string(settings.SMS_BACKEND)().send(phone, message)
    except Exception:  # a gateway failure must not crash the request
        logger.exception("SMS send failed")
        return False
