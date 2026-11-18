import json
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

from apps.configs.models import ConfigVersion
from apps.configs.validators import LANG_EN, LANG_NY, TAX_RULES

# Mirrors `taxRules` in mobile/src/data/fake.ts. PLACEHOLDER values: scope-sheet open question 3.
PLACEHOLDER_RULES = {
    "version": 1, "rate": 0.04, "threshold": 800000, "periodDays": 30,
    "dueDaysAfterPeriod": 14, "reminderDaysBefore": [7, 3, 0],
}


class Command(BaseCommand):
    help = (
        "Publish version 1 of the config files: PLACEHOLDER tax rules (not validated with ZRA) and the "
        "app's current English and Nyanja files. Safe to run again; existing versions are left alone."
    )

    def add_arguments(self, parser):
        default = str(Path(settings.BASE_DIR).parent / "mobile" / "src" / "i18n")
        parser.add_argument("--lang-dir", default=default, help="Folder holding en.json and ny.json")

    def handle(self, *args, **opts):
        obj, created = ConfigVersion.objects.get_or_create(
            kind=TAX_RULES, version=1,
            defaults={"payload": PLACEHOLDER_RULES, "is_published": True, "validated_with_zra": False,
                      "source_note": "PLACEHOLDER values from the demo data. Replace after checking ZRA's published rules."},
        )
        self.stdout.write(self.style.WARNING(f"{'Published' if created else 'Exists'}: {obj}"))
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
