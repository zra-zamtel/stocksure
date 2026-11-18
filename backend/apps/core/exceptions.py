from rest_framework import status
from rest_framework.exceptions import APIException
from rest_framework.views import exception_handler


class Conflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "This conflicts with the current state of the record."
    default_code = "conflict"


class PhoneTaken(Conflict):
    default_detail = "This phone number is already registered. Sign in, or reset your PIN."
    default_code = "phone_taken"


class AuthFailed(APIException):
    status_code = status.HTTP_401_UNAUTHORIZED
    default_detail = "Wrong phone number or PIN."
    default_code = "bad_credentials"


class Locked(APIException):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    default_detail = "Too many wrong PINs. Try again later."
    default_code = "locked"


def api_exception_handler(exc, context):
    """Same as DRF's, plus a stable machine-readable `code` next to every `detail` message."""
    response = exception_handler(exc, context)
    is_api_error = response is not None and isinstance(exc, APIException) and isinstance(response.data, dict)
    if is_api_error and "detail" in response.data and "code" not in response.data:
        codes = exc.get_codes()
        response.data["code"] = codes if isinstance(codes, str) else "error"
    return response
