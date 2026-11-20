import json
import tempfile
from pathlib import Path

from django.core.exceptions import ValidationError
from django.core.management import call_command
from rest_framework.test import APIClient

from apps.configs.models import ConfigVersion

from .helpers import BaseTestCase

RULES = {"version": 1, "rate": 0.04, "threshold": 800000, "periodDays": 30,
         "dueDaysAfterPeriod": 14, "reminderDaysBefore": [7, 3, 0]}


def publish(kind, version, payload, **extra):
    return ConfigVersion.objects.create(kind=kind, version=version, payload=payload, is_published=True, **extra)


class ConfigTests(BaseTestCase):
    def test_nothing_published_means_an_empty_index_and_404_per_kind(self):
        r = APIClient().get("/api/v1/config")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data["configs"], {})
        self.assertEqual(APIClient().get("/api/v1/config/tax_rules").status_code, 404)

    def test_app_can_fetch_without_signing_in(self):
        publish("tax_rules", 1, RULES)
        publish("lang_en", 1, {"app.name": "StockSure"})
        r = APIClient().get("/api/v1/config")
        self.assertEqual(r.data["configs"]["tax_rules"]["payload"], RULES)
        self.assertEqual(r.data["configs"]["lang_en"]["version"], 1)
        self.assertEqual(len(r.data["configs"]["tax_rules"]["checksum"]), 64)

    def test_newer_published_version_replaces_older_and_drafts_are_not_served(self):
        publish("tax_rules", 1, RULES)
        publish("tax_rules", 2, {**RULES, "version": 2, "rate": 0.05})
        ConfigVersion.objects.create(kind="tax_rules", version=3, payload={**RULES, "version": 3, "rate": 0.09})  # draft
        got = APIClient().get("/api/v1/config/tax_rules").data
        self.assertEqual((got["version"], got["payload"]["rate"]), (2, 0.05))

    def test_etag_and_have_return_304_when_nothing_changed(self):
        publish("tax_rules", 1, RULES)
        c = APIClient()
        first = c.get("/api/v1/config")
        etag = first["ETag"]
        self.assertEqual(c.get("/api/v1/config", HTTP_IF_NONE_MATCH=etag).status_code, 304)
        publish("tax_rules", 2, {**RULES, "version": 2})
        self.assertEqual(c.get("/api/v1/config", HTTP_IF_NONE_MATCH=etag).status_code, 200)
        self.assertEqual(c.get("/api/v1/config/tax_rules?have=2").status_code, 304)
        self.assertEqual(c.get("/api/v1/config/tax_rules?have=1").status_code, 200)

    def test_unknown_kind_is_404(self):
        self.assertEqual(APIClient().get("/api/v1/config/colours").status_code, 404)

    def test_a_bad_tax_rules_file_cannot_be_saved(self):
        bad = [
            {**RULES, "rate": 4},                   # 4 would mean 400%
            {**RULES, "threshold": -1},
            {**RULES, "reminderDaysBefore": []},
            {**RULES, "version": 9},                # must match the record's version
            {k: v for k, v in RULES.items() if k != "rate"},   # partial file
            {**RULES, "surprise": 1},
        ]
        for payload in bad:
            with self.assertRaises(ValidationError, msg=str(payload)):
                ConfigVersion.objects.create(kind="tax_rules", version=1, payload=payload, is_published=True)
        self.assertEqual(ConfigVersion.objects.count(), 0)

    def test_a_partial_language_file_cannot_replace_a_complete_one(self):
        publish("lang_ny", 1, {"a": "A", "b": "B", "c": "C"})
        with self.assertRaises(ValidationError):
            publish("lang_ny", 2, {"a": "A"})  # cut off part-way
        with self.assertRaises(ValidationError):
            publish("lang_en", 1, {"a": 5})    # values must be text
        ok = publish("lang_ny", 2, {"a": "A2", "b": "B", "c": "C", "d": "D"})  # adding keys is fine
        self.assertEqual(APIClient().get("/api/v1/config/lang_ny").data["version"], ok.version)
        self.assertEqual(ConfigVersion.objects.filter(kind="lang_ny", is_published=True).count(), 2)

    def test_seed_command_publishes_placeholder_rules_that_are_not_validated(self):
        with tempfile.TemporaryDirectory() as d:
            Path(d, "en.json").write_text(json.dumps({"app.name": "StockSure"}), encoding="utf-8")
            Path(d, "ny.json").write_text(json.dumps({"app.name": "StockSure"}), encoding="utf-8")
            call_command("seed_config", lang_dir=d, verbosity=0)
            call_command("seed_config", lang_dir=d, verbosity=0)  # running twice is harmless
        rules = ConfigVersion.latest_published("tax_rules")
        self.assertFalse(rules.validated_with_zra)
        self.assertEqual(ConfigVersion.objects.count(), 3)
        self.assertFalse(APIClient().get("/api/v1/config/tax_rules").data["validatedWithZra"])
