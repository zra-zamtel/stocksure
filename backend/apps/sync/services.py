import re

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import Max
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from apps.accounts.models import User
from apps.core.utils import iso_now, normalize_phone, parse_iso

from .models import ChangeLog, SyncRecord
from .schemas import ENTITIES, STAFF_STOCK_REASONS, validate_shape


class Reject(Exception):
    """One change is refused. The text goes back to the phone as the reason; nothing is stored."""


def format_cursor(seq: int) -> str:
    return f"c_{seq:06d}"


def parse_cursor(raw) -> int:
    if raw in (None, "", "0", 0):
        return 0
    m = re.fullmatch(r"c_(\d+)", str(raw))
    if not m:
        raise ValidationError({"cursor": "Not a valid cursor. Use the cursor the server gave you, or 0."})
    return int(m.group(1))


def latest_seq(tenant_id) -> int:
    return ChangeLog.objects.filter(tenant_id=tenant_id).aggregate(m=Max("seq"))["m"] or 0


# ---- indexing helpers -------------------------------------------------------------------------
def _index(entity: str, payload: dict) -> dict:
    spec = ENTITIES[entity]
    unique_value = None
    if spec.unique == "singleton":
        unique_value = "singleton"
    elif spec.unique:
        raw = payload.get(spec.unique)
        if isinstance(raw, str) and raw.strip():
            unique_value = normalize_phone(raw) if spec.unique == "phone" else raw.strip()
    created = parse_iso(payload.get("created_at"))
    num = payload.get(spec.num) if spec.num else None
    return {
        "ref_id": str(payload.get(spec.ref) or "") if spec.ref else "",
        "unique_value": unique_value,
        "num": num if isinstance(num, int) and not isinstance(num, bool) else None,
        "state": str(payload.get(spec.state) or "") if spec.state else "",
        "event_at": created,
    }


def _check_references(tenant_id, spec, payload):
    for column, targets in spec.fks.items():
        if not SyncRecord.objects.filter(tenant_id=tenant_id, entity__in=targets, entity_id=payload[column]).exists():
            raise Reject(f"{column} '{payload[column]}' does not exist (expected a {' or '.join(targets)})")
    for column, targets in spec.fks_optional.items():
        value = payload.get(column)
        if value is not None and not SyncRecord.objects.filter(
            tenant_id=tenant_id, entity__in=targets, entity_id=value
        ).exists():
            raise Reject(f"{column} '{value}' does not exist (expected a {' or '.join(targets)})")


def _check_permissions(user, entity, payload):
    spec = ENTITIES[entity]
    if user.role == User.Role.OWNER:
        if entity == "owner" and normalize_phone(payload["phone"]) != user.phone:
            raise Reject("owner.phone does not match the signed-in account")
        return
    # staff device
    if not spec.staff_may_push:
        raise Reject(f"staff accounts cannot change {entity} records")
    if entity == "stock_movement" and payload["reason"] not in STAFF_STOCK_REASONS:
        raise Reject("staff accounts can only record sale stock movements")
    if entity == "sale" and payload["status"] == "void":
        raise Reject("only the owner can void a sale")


# ---- the heart of push ----------------------------------------------------------------------------
def apply_change(*, tenant_id, user, device_id, batch_id, queue_id, change):
    """Validate one change and store it. Returns "applied" or "noop" (a replay or a stale edit);
    raises Reject with a reason otherwise. Replaying the same change is always safe."""
    if not isinstance(change, dict):
        raise Reject("a change must be an object")
    entity, entity_id = change.get("entity"), change.get("entityId")
    operation, payload = change.get("operation"), change.get("payload")

    spec = ENTITIES.get(entity) if isinstance(entity, str) else None
    if spec is None:
        raise Reject(f"unknown entity {entity!r}")
    if not isinstance(entity_id, str) or not entity_id:
        raise Reject("entityId is required")
    if operation == "delete":
        raise Reject("records are never deleted" + ("; void the sale instead" if entity == "sale" else ""))
    if operation not in ("create", "update"):
        raise Reject("operation must be 'create' or 'update'")
    if not isinstance(payload, dict):
        raise Reject("payload must be an object")

    problems = validate_shape(entity, entity_id, payload, settings.SYNC_STRICT_FIELDS)
    if problems:
        raise Reject("; ".join(problems[:5]))
    _check_permissions(user, entity, payload)

    existing = SyncRecord.objects.filter(tenant_id=tenant_id, entity=entity, entity_id=entity_id).first()
    incoming_updated = parse_iso(payload["updated_at"])
    if existing is not None:
        if existing.data == payload:
            return "noop"  # exact replay
        if spec.immutable:
            raise Reject(f"{entity} records are append-only: this id already exists with different content")
        if entity == "sale":
            for column in spec.locked_after_create:
                if existing.data.get(column) != payload.get(column):
                    raise Reject(f"sale.{column} cannot change after the sale is saved; void it instead")
            if existing.data.get("status") == "void" and payload["status"] != "void":
                raise Reject("a voided sale cannot be made active again")
        if incoming_updated <= existing.updated_at_client:
            return "noop"  # latest edit wins, and this one is not the latest

    _check_references(tenant_id, spec, payload)

    index = _index(entity, payload)
    if index["unique_value"] is not None:
        clash = SyncRecord.objects.filter(
            tenant_id=tenant_id, entity=entity, unique_value=index["unique_value"]
        ).exclude(entity_id=entity_id)
        if clash.exists():
            label = "owner" if spec.unique == "singleton" else spec.unique
            raise Reject(f"{label} is already used by another {entity} record")

    try:
        with transaction.atomic():
            log = ChangeLog.objects.create(
                tenant_id=tenant_id, entity=entity, entity_id=entity_id,
                operation="update" if existing is not None else "create",
                payload=payload, device_id=device_id, batch_id=batch_id, queue_id=queue_id,
            )
            if existing is None:
                SyncRecord.objects.create(
                    tenant_id=tenant_id, entity=entity, entity_id=entity_id, data=payload,
                    updated_at_client=incoming_updated, last_seq=log.seq, **index,
                )
            else:
                existing.data = payload
                existing.updated_at_client = incoming_updated
                existing.last_seq = log.seq
                for key, value in index.items():
                    setattr(existing, key, value)
                existing.save()
    except IntegrityError:
        raise Reject("this record clashes with an existing one")
    return "applied"


def push(user, body):
    if not isinstance(body, dict):
        raise ValidationError("The request body must be a JSON object.")
    device_id, batch_id, changes = body.get("deviceId"), body.get("batchId"), body.get("changes")
    if not isinstance(device_id, str) or not device_id:
        raise ValidationError({"deviceId": "deviceId is required."})
    if not isinstance(batch_id, str) or not batch_id:
        raise ValidationError({"batchId": "batchId is required."})
    if not isinstance(changes, list):
        raise ValidationError({"changes": "changes must be a list."})
    if len(changes) > settings.SYNC_MAX_BATCH:
        raise ValidationError({"changes": f"At most {settings.SYNC_MAX_BATCH} changes per push. Send smaller batches."})

    tenant_id = user.tenant_id
    prepared = []
    for index, change in enumerate(changes):
        queue_id = change.get("queueId") if isinstance(change, dict) else None
        if not isinstance(queue_id, str) or not queue_id:
            queue_id = f"index:{index}"
        entity = change.get("entity") if isinstance(change, dict) else None
        spec = ENTITIES.get(entity) if isinstance(entity, str) else None
        created = change.get("clientCreatedAt") if isinstance(change, dict) else ""
        prepared.append(((spec.rank if spec else 99), created if isinstance(created, str) else "", index, queue_id, change))
    prepared.sort(key=lambda p: (p[0], p[1], p[2]))  # parents first, so references resolve inside one batch

    accepted, rejected = [], []
    with transaction.atomic():
        # One writer per owner at a time, so change numbers (the pull cursor) are handed out in order.
        User.objects.select_for_update().get(pk=tenant_id)
        for _, _, _, queue_id, change in prepared:
            try:
                with transaction.atomic():
                    apply_change(
                        tenant_id=tenant_id, user=user, device_id=device_id, batch_id=batch_id,
                        queue_id=queue_id, change=change,
                    )
                accepted.append(queue_id)
            except Reject as reason:
                rejected.append({"queueId": queue_id, "reason": str(reason)})
    return {
        "accepted": accepted, "rejected": rejected,
        "serverTime": iso_now(), "cursor": format_cursor(latest_seq(tenant_id)),
    }


def _outgoing_payload(user, entity, payload):
    """Staff devices never receive PIN hashes: a 4-6 digit PIN is trivial to recover from its hash."""
    if user.role == User.Role.STAFF and entity in ("owner", "staff"):
        return {**payload, "pin_hash": ""}
    return payload


def pull(user, cursor_raw, limit, exclude_device=None):
    cursor = parse_cursor(cursor_raw)
    tenant_id = user.tenant_id
    qs = ChangeLog.objects.filter(tenant_id=tenant_id, seq__gt=cursor).order_by("seq")
    if exclude_device:
        qs = qs.exclude(device_id=exclude_device)
    rows = list(qs[: limit + 1])
    has_more = len(rows) > limit
    rows = rows[:limit]
    next_seq = rows[-1].seq if has_more else max(latest_seq(tenant_id), cursor)
    return {
        "changes": [
            {
                "seq": r.seq, "entity": r.entity, "entityId": r.entity_id, "operation": r.operation,
                "payload": _outgoing_payload(user, r.entity, r.payload),
                "deviceId": r.device_id, "serverCreatedAt": r.created_at.isoformat(),
            }
            for r in rows
        ],
        "cursor": format_cursor(cursor),
        "nextCursor": format_cursor(next_seq),
        "hasMore": has_more,
        "serverTime": iso_now(),
    }


def apply_server_change(*, user, entity, payload, device_id="server"):
    """Used by USSD: write a record the same way a phone would (same checks, same change log)."""
    with transaction.atomic():
        User.objects.select_for_update().get(pk=user.tenant_id)
        return apply_change(
            tenant_id=user.tenant_id, user=user, device_id=device_id, batch_id=f"{device_id}-{timezone.now():%Y%m%d}",
            queue_id=f"{device_id}:{payload.get('id', '')}",
            change={"entity": entity, "entityId": payload.get("id"), "operation": "create", "payload": payload},
        )
