from django.core.management.base import BaseCommand

from apps.notifications.services import generate_reminders
from apps.shops.models import Shop


class Command(BaseCommand):
    help = "Send missing-record, savings and tax-due reminders. Run daily (cron / scheduler)."

    def handle(self, *args, **options):
        total = 0
        for shop in Shop.objects.filter(is_active=True).select_related("owner"):
            total += len(generate_reminders(shop))
        self.stdout.write(self.style.SUCCESS(f"{total} reminder(s) sent."))
