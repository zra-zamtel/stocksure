from datetime import datetime, timedelta, timezone

from django.test import TestCase

from apps.sales.matching import (
    MatchCandidate,
    match_candidates,
    normalise_reference,
)

from .helpers import client_for, make_shop
from apps.sales.models import MobilePayment, Sale
from apps.sales import services


def at(hour, minute=0):
    return datetime(2026, 11, 17, hour, minute, tzinfo=timezone.utc)


def candidate(id, amount=45000, reference="", provider="Zamtel", when=None):
    return MatchCandidate(
        id=id, amount=amount, reference=reference, provider=provider, at=when or at(10)
    )


class MatchingRuleTests(TestCase):
    def test_matches_on_amount_reference_provider_and_time(self):
        result = match_candidates(
            [candidate("s1", reference="MP2607.1122.A84721", when=at(10))],
            [
                candidate(
                    "r1", reference="mp 2607.1122.a84721", when=at(10, 20)
                )
            ],
            30,
        )

        self.assertEqual(result.matched, [("s1", "r1")])

    def test_refuses_a_match_outside_the_window(self):
        result = match_candidates(
            [candidate("s1", when=at(10))],
            [candidate("r1", when=at(12, 15))],
            30,
        )

        self.assertEqual(result.matched, [])
        self.assertEqual(result.unmatched_sales, ["s1"])

    def test_refuses_a_match_when_the_references_differ(self):
        result = match_candidates(
            [candidate("s1", reference="AAA", when=at(10))],
            [candidate("r1", reference="BBB", when=at(10, 5))],
            30,
        )

        self.assertEqual(result.matched, [])

    def test_refuses_a_match_when_only_one_side_has_a_reference(self):
        result = match_candidates(
            [candidate("s1", reference="AAA", when=at(10))],
            [candidate("r1", reference="", when=at(10, 5))],
            30,
        )
        self.assertEqual(result.matched, [])

        result = match_candidates(
            [candidate("s2", reference="", when=at(10))],
            [candidate("r2", reference="BBB", when=at(10, 5))],
            30,
        )
        self.assertEqual(result.matched, [])

    def test_matches_without_references_when_exactly_one_pair_fits(self):
        result = match_candidates(
            [candidate("s9", reference="", when=at(10))],
            [candidate("p9", reference="", when=at(10, 5))],
            30,
        )

        self.assertEqual(result.matched, [("s9", "p9")])

    def test_refuses_a_match_across_different_providers(self):
        result = match_candidates(
            [candidate("s1", provider="MTN", when=at(10))],
            [candidate("r1", provider="Airtel", when=at(10, 5))],
            30,
        )

        self.assertEqual(result.matched, [])

    def test_a_missing_provider_on_one_side_still_matches(self):
        result = match_candidates(
            [candidate("s1", provider="", when=at(10))],
            [candidate("r1", provider="Zamtel", when=at(10, 5))],
            30,
        )

        self.assertEqual(result.matched, [("s1", "r1")])

    def test_exactly_the_window_still_matches(self):
        result = match_candidates(
            [candidate("s1", when=at(10))],
            [candidate("r1", when=at(10, 30))],
            30,
        )

        self.assertEqual(result.matched, [("s1", "r1")])

    def test_ambiguity_is_judged_from_the_sale_side(self):
        result = match_candidates(
            [candidate("s1", when=at(10))],
            [candidate("r1", when=at(10, 5)), candidate("r2", when=at(10, 10))],
            30,
        )

        self.assertEqual(result.matched, [])
        self.assertEqual(result.ambiguous_sales, ["s1"])
        self.assertEqual(result.ambiguous_received, [])

    def test_ambiguity_is_judged_from_the_payment_side(self):
        result = match_candidates(
            [candidate("s1", when=at(10)), candidate("s2", when=at(10, 5))],
            [candidate("r1", when=at(10, 2))],
            30,
        )

        self.assertEqual(result.matched, [])
        self.assertEqual(result.ambiguous_sales, ["s1", "s2"])
        self.assertEqual(result.ambiguous_received, ["r1"])

    def test_normalises_references(self):
        self.assertEqual(normalise_reference("  ab 12 cd "), "AB12CD")
        self.assertEqual(normalise_reference(None), "")


class MatchingDatabaseTests(TestCase):
    def setUp(self):
        self.shop, self.owner, self.assistant = make_shop()

    def sale(self, reference="", provider="", total="450.00", when=None):
        return Sale.objects.create(
            shop=self.shop,
            payment_method=Sale.Method.MOBILE_MONEY,
            total=total,
            provider=provider,
            payment_reference=reference,
            sold_at=when or at(10),
            sale_date=(when or at(10)).date(),
            match_status=Sale.Match.PENDING,
        )

    def payment(self, reference="", provider="", amount="450.00", when=None):
        return MobilePayment.objects.create(
            shop=self.shop,
            provider_ref=reference,
            provider=provider,
            amount=amount,
            received_at=when or at(10, 5),
        )

    def test_try_match_sale_links_a_unique_pair(self):
        sale = self.sale(reference="REF-1", provider="Zamtel")
        payment = self.payment(reference="REF-1", provider="Zamtel")

        services.matching.try_match_sale(sale)

        sale.refresh_from_db()
        payment.refresh_from_db()
        self.assertEqual(sale.match_status, Sale.Match.MATCHED)
        self.assertEqual(payment.status, MobilePayment.Status.MATCHED)
        self.assertEqual(payment.sale_id, sale.id)

    def test_two_fitting_payments_leave_the_sale_for_review(self):
        sale = self.sale(reference="", provider="")
        first = self.payment(reference="", provider="", when=at(10, 5))
        second = self.payment(reference="", provider="", when=at(10, 10))

        services.matching.try_match_sale(sale)

        sale.refresh_from_db()
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(sale.match_status, Sale.Match.NEEDS_REVIEW)
        self.assertEqual(first.sale_id, None)
        self.assertEqual(second.sale_id, None)
        self.assertEqual(first.status, MobilePayment.Status.UNMATCHED)
        self.assertEqual(second.status, MobilePayment.Status.UNMATCHED)

    def test_a_payment_that_fits_two_sales_is_left_for_review(self):
        first = self.sale(reference="", provider="", when=at(10))
        second = self.sale(reference="", provider="", when=at(10, 5))
        payment = self.payment(reference="", provider="", when=at(10, 2))

        services.matching.try_match_payment(payment)

        payment.refresh_from_db()
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(payment.status, MobilePayment.Status.NEEDS_REVIEW)
        self.assertEqual(first.match_status, Sale.Match.NEEDS_REVIEW)
        self.assertEqual(second.match_status, Sale.Match.NEEDS_REVIEW)


class IgnorePaymentTests(TestCase):
    def setUp(self):
        self.shop, self.owner, self.assistant = make_shop()
        self.payment = MobilePayment.objects.create(
            shop=self.shop, provider_ref="REF-IGNORE", amount="10.00", received_at=at(10)
        )

    def test_owner_can_ignore_a_payment_and_it_sticks(self):
        response = client_for(self.owner).post(
            f"/api/payments/{self.payment.id}/ignore/", {}, format="json"
        )

        self.assertEqual(response.status_code, 200)
        self.payment.refresh_from_db()
        self.assertEqual(self.payment.status, MobilePayment.Status.IGNORED)
        self.assertIsNone(self.payment.sale)

    def test_an_assistant_cannot_ignore_a_payment(self):
        response = client_for(self.assistant).post(
            f"/api/payments/{self.payment.id}/ignore/", {}, format="json"
        )

        self.assertEqual(response.status_code, 403)
