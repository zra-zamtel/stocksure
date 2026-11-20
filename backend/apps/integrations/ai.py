"""Supplier-invoice reader (the MVP's AI feature).

MockInvoiceReader works offline for demos. AnthropicInvoiceReader sends the photo to Claude and
asks for structured JSON. Whatever the reader returns is only a *suggestion*: the user reviews
and confirms it before anything touches stock.
"""
import base64
import json
import re

from django.conf import settings
from django.utils.module_loading import import_string

PROMPT = (
    "This is a photo of a supplier invoice or delivery note from a small shop in Zambia. "
    "Extract every line item. Reply with ONLY a JSON array, no prose. Each element: "
    '{"name": str, "category": str|null, "size": str|null, "color": str|null, '
    '"quantity": int, "unit_cost": number|null}. '
    "Use null when a field is not on the invoice. Do not invent items."
)


class BaseInvoiceReader:
    def read(self, image_bytes: bytes, media_type: str) -> list:
        raise NotImplementedError


class MockInvoiceReader(BaseInvoiceReader):
    def read(self, image_bytes, media_type):
        return [
            {"name": "Men's sneaker", "category": "Shoes", "size": "42", "color": "Black", "quantity": 3, "unit_cost": 250},
            {"name": "Men's sneaker", "category": "Shoes", "size": "43", "color": "Black", "quantity": 3, "unit_cost": 250},
            {"name": "Ladies sandal", "category": "Shoes", "size": "38", "color": "Brown", "quantity": 4, "unit_cost": 120},
        ]


class AnthropicInvoiceReader(BaseInvoiceReader):
    def read(self, image_bytes, media_type):
        import anthropic  # imported lazily so the package is optional

        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        message = client.messages.create(
            model=settings.ANTHROPIC_MODEL,
            max_tokens=2000,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": base64.b64encode(image_bytes).decode(),
                            },
                        },
                        {"type": "text", "text": PROMPT},
                    ],
                }
            ],
        )
        text = "".join(b.text for b in message.content if getattr(b, "type", "") == "text")
        match = re.search(r"\[.*\]", text, re.DOTALL)
        if not match:
            raise ValueError("The invoice reader did not return a list of items.")
        rows = json.loads(match.group(0))
        cleaned = []
        for row in rows:
            try:
                qty = int(row.get("quantity") or 0)
            except (TypeError, ValueError):
                continue
            if not row.get("name") or qty <= 0:
                continue
            cleaned.append(
                {
                    "name": str(row["name"])[:150],
                    "category": row.get("category"),
                    "size": None if row.get("size") is None else str(row["size"]),
                    "color": row.get("color"),
                    "quantity": qty,
                    "unit_cost": row.get("unit_cost"),
                }
            )
        return cleaned


def get_invoice_reader() -> BaseInvoiceReader:
    return import_string(settings.AI_INVOICE_READER)()
