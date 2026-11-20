from django.core.cache import cache
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.shops.models import Membership, Shop
from apps.sync.models import Shop as SyncShop


def make_shop(mode="full", tolerance=0):
    owner = User.objects.create_user("0977000001", "ownerpass", full_name="Owner")
    assistant = User.objects.create_user("0977000002", "1234", full_name="Assistant")
    shop = Shop.objects.create(owner=owner, name="Test Shoes", town="Kabwe", mode=mode, cash_tolerance=tolerance,
                               zamtel_merchant_number="260977000100")
    Membership.objects.create(user=owner, shop=shop, role="owner")
    Membership.objects.create(user=assistant, shop=shop, role="assistant")
    now = timezone.now()
    SyncShop.objects.create(
        id=f"shop_{owner.id}",
        owner=owner,
        name=shop.name,
        type="other",
        town=shop.town,
        currency="ZMW",
        language="en",
        created_at=now,
        updated_at=now,
    )
    return shop, owner, assistant


def client_for(user):
    c = APIClient()
    c.force_authenticate(user)
    return c


class BaseTestCase(TestCase):
    """Clears the cache so throttle counters start fresh in each test."""

    def setUp(self):
        cache.clear()
