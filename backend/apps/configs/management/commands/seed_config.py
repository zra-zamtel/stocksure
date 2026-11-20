import json
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

from apps.configs.models import ConfigVersion
from apps.configs.validators import LANG_EN, LANG_NY, TAX_RULES

# Mirrors `taxRules` in mobile/src/data/fake.ts: the rules ZRA's tax team gave the
# team on 18 November 2026 (scope sheet section 7). 5% of monthly turnover; turnover
# tax only below K5 million a year (threshold in ngwee, measured on sales so far this
# year); each month's return is due on the 14th of the next month.
ZRA_RULES_VERSION = 2
ZRA_RULES = {
    "version": ZRA_RULES_VERSION, "rate": 0.05, "threshold": 500_000_000, "thresholdBasis": "year",
    "periodDays": 30, "dueDaysAfterPeriod": 14, "reminderDaysBefore": [7, 3, 0],
}


class Command(BaseCommand):
    help = (
        "Publish the config files: the ZRA tax rules (version 2) and version 1 of the app's English and "
        "Nyanja files. Safe to run again; existing versions are left alone."
    )

    def add_arguments(self, parser):
        default = str(Path(settings.BASE_DIR).parent / "mobile" / "src" / "i18n")
        parser.add_argument("--lang-dir", default=default, help="Folder holding en.json and ny.json")

    def handle(self, *args, **opts):
        obj, created = ConfigVersion.objects.get_or_create(
            kind=TAX_RULES, version=ZRA_RULES_VERSION,
            defaults={"payload": ZRA_RULES, "is_published": True, "validated_with_zra": True,
                      "source_note": "From ZRA's tax team, 18 November 2026: 5%, K5 million a year, due on the "
                                     "14th. Still open: what 'excluding all income' covers."},
        )
        self.stdout.write(self.style.SUCCESS(f"{'Published' if created else 'Exists'}: {obj}"))
        lang_dir = Path(opts["lang_dir"])
        for kind, name in ((LANG_EN, "en.json"), (LANG_NY, "ny.json")):
            path = lang_dir / name
            if not path.exists():
                self.stdout.write(f"Skipped {kind}: {path} not found (use --lang-dir).")
                continue
            payload = json.loads(path.read_text(encoding="utf-8"))
            obj, created = ConfigVersion.objects.get_or_create(
                kind=kind, version=1, defaults={"payload": payload, "is_published": True,
                                                "source_note": f"Loaded from {name}. Nyanja still needs native-speaker review."},
            )
            self.stdout.write(self.style.SUCCESS(f"{'Published' if created else 'Exists'}: {obj}"))
