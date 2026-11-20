"""Scheduled warmer for the public API Lambda.

EventBridge invokes this function every two minutes. It calls the public health
endpoint, which does not touch the database, so the API function stays warm
without waking the Postgres pooler.
"""

import os
import urllib.request


def handler(event, context):
    url = os.environ.get("WARM_URL", "").strip()
    if not url:
        return {"ok": False, "error": "WARM_URL is not set."}

    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            body = response.read(200).decode("utf-8", "replace")
            return {"ok": response.status == 200, "status": response.status, "body": body}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
