from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.shops.models import Membership, Shop


def make_shop(mode="full", tolerance=0):
    owner = User.objects.create_user("0977000001", "ownerpass", full_name="Owner")
    assistant = User.objects.create_user("0977000002", "1234", full_name="Assistant")
    shop = Shop.objects.create(owner=owner, name="Test Shoes", town="Kabwe", mode=mode, cash_tolerance=tolerance,
                               zamtel_merchant_number="260977000100")
    Membership.objects.create(user=owner, shop=shop, role="owner")
    Membership.objects.create(user=assistant, shop=shop, role="assistant")
    return shop, owner, assistant


def client_for(user):
    c = APIClient()
    c.force_authenticate(user)
    return c
