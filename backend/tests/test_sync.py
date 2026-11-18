from apps.sync.models import ChangeLog, SyncRecord

from .helpers import (
    T1,
    T2,
    BaseTestCase,
    base_data,
    change,
    line_row,
    login,
    movement_row,
    owner_row,
    payment_row,
    product_row,
    pull,
    push,
    register,
    sale_row,
    shop_row,
    staff_row,
    variant_row,
)


def reasons(response):
    return {r["queueId"]: r["reason"] for r in response.data["rejected"]}


class RoundTripTests(BaseTestCase):
    def setUp(self):
        super().setUp()
        self.a, _ = register()

    def test_phone_a_pushes_phone_b_pulls_the_same_records(self):
        base_data(self.a)
        push(self.a, [change("sale", sale_row()), change("sale_line", line_row()), change("payment", payment_row()),
                      change("stock_movement", movement_row("mov_2", qty=-1, reason="sale", sale_id="sale_1"))])
        phone_b = login("0977000001", "1234")  # same owner, a different phone
        r = pull(phone_b, "0")
        self.assertEqual(r.status_code, 200)
        got = [(c["entity"], c["entityId"]) for c in r.data["changes"]]
        for expected in [("owner", "owner_a"), ("product", "prod_1"), ("product_variant", "var_1"),
                         ("sale", "sale_1"), ("sale_line", "line_1"), ("payment", "pay_1"), ("stock_movement", "mov_2")]:
            self.assertIn(expected, got)
        sale = next(c for c in r.data["changes"] if c["entity"] == "sale")
        self.assertEqual(sale["payload"], sale_row())  # stored exactly as the phone sent it
        seqs = [c["seq"] for c in r.data["changes"]]
        self.assertEqual(seqs, sorted(seqs))
        self.assertFalse(r.data["hasMore"])

    def test_replaying_a_batch_is_a_no_op(self):
        batch = [change("owner", owner_row(), qid="q1"), change("product", product_row(), qid="q2")]
        first = push(self.a, batch)
        before = ChangeLog.objects.count()
        second = push(self.a, batch)
        self.assertEqual(sorted(second.data["accepted"]), ["q1", "q2"])
        self.assertEqual(second.data["rejected"], [])
        self.assertEqual(ChangeLog.objects.count(), before)
        self.assertEqual(first.data["cursor"], second.data["cursor"])

    def test_children_before_parents_in_one_batch_still_work(self):
        r = push(self.a, [
            change("stock_movement", movement_row(), qid="q_mov"),
            change("product_variant", variant_row(), qid="q_var"),
            change("product", product_row(), qid="q_prod"),
        ])
        self.assertEqual(r.data["rejected"], [])
        self.assertEqual(len(r.data["accepted"]), 3)

    def test_pull_pages_through_with_a_cursor(self):
        base_data(self.a)  # 5 records
        seen, cursor = [], "0"
        for _ in range(10):
            r = pull(self.a, cursor, limit=2)
            seen += [c["seq"] for c in r.data["changes"]]
            cursor = r.data["nextCursor"]
            if not r.data["hasMore"]:
                break
        self.assertEqual(len(seen), 5)
        self.assertEqual(seen, sorted(set(seen)))
        self.assertEqual(pull(self.a, cursor).data["changes"], [])  # nothing new after the last cursor

    def test_exclude_own_device(self):
        push(self.a, [change("owner", owner_row())], device="dev_a")
        push(self.a, [change("product", product_row())], device="dev_b")
        r = pull(self.a, "0", excludeDevice="dev_a")
        self.assertEqual([c["entity"] for c in r.data["changes"]], ["product"])
        self.assertEqual(r.data["nextCursor"], pull(self.a, "0").data["nextCursor"])

    def test_bad_cursor_and_limit(self):
        self.assertEqual(pull(self.a, "banana").status_code, 400)
        self.assertEqual(pull(self.a, "0", limit=0).status_code, 400)
        self.assertEqual(pull(self.a, "0", limit=5000).status_code, 400)


class ValidationTests(BaseTestCase):
    def setUp(self):
        super().setUp()
        self.a, _ = register()
        base_data(self.a)

    def test_malformed_record_is_rejected_with_a_reason_and_nothing_is_stored(self):
        bad = sale_row()
        del bad["total"]
        good = product_row("prod_2", "Red dress")
        r = push(self.a, [change("sale", bad, qid="q_bad"), change("product", good, qid="q_good")])
        self.assertIn("sale.total is required", reasons(r)["q_bad"])
        self.assertIn("q_good", r.data["accepted"])  # the good record in the same batch still lands
        self.assertFalse(SyncRecord.objects.filter(entity="sale").exists())
        self.assertTrue(SyncRecord.objects.filter(entity_id="prod_2").exists())

    def test_wrong_types_and_values(self):
        cases = {
            "float money": sale_row(total=250.5),
            "bad enum": {**sale_row(), "status": "cancelled"},
            "bad timestamp": {**sale_row(), "created_at": "yesterday"},
            "id mismatch": {**sale_row(), "id": "other"},
        }
        for name, payload in cases.items():
            r = push(self.a, [change("sale", payload, qid="q") if name != "id mismatch"
                              else {**change("sale", sale_row()), "payload": payload}])
            self.assertEqual(len(r.data["rejected"]), 1, name)
        self.assertFalse(SyncRecord.objects.filter(entity="sale").exists())

    def test_unknown_column_and_unknown_entity_are_rejected(self):
        r = push(self.a, [change("sale", {**sale_row(), "shop_id": "x"}, qid="q1"),
                          {**change("sale", sale_row()), "entity": "invoice", "queueId": "q2"}])
        self.assertIn("no column(s): shop_id", reasons(r)["q1"])
        self.assertIn("unknown entity", reasons(r)["q2"])

    def test_missing_parent_is_rejected(self):
        r = push(self.a, [change("sale_line", line_row(sale_id="ghost"), qid="q1")])
        self.assertIn("sale_id 'ghost' does not exist", reasons(r)["q1"])

    def test_zero_stock_movement_is_rejected(self):
        r = push(self.a, [change("stock_movement", movement_row("mov_0", qty=0), qid="q1")])
        self.assertIn("must not be 0", reasons(r)["q1"])

    def test_deletes_are_never_accepted(self):
        push(self.a, [change("sale", sale_row())])
        r = push(self.a, [change("sale", sale_row(), qid="q1", operation="delete")])
        self.assertIn("void the sale instead", reasons(r)["q1"])
        self.assertTrue(SyncRecord.objects.filter(entity="sale").exists())

    def test_bad_envelope_is_a_400(self):
        self.assertEqual(self.a.post("/api/v1/sync/push", {"batchId": "b", "changes": []}, format="json").status_code, 400)
        self.assertEqual(self.a.post("/api/v1/sync/push", {"deviceId": "d", "batchId": "b", "changes": "x"},
                                     format="json").status_code, 400)
        too_many = [change("product", product_row(f"p{i}")) for i in range(501)]
        self.assertEqual(push(self.a, too_many).status_code, 400)

    def test_barcode_must_be_unique(self):
        r = push(self.a, [change("product_variant", variant_row("var_2", barcode="6001234567890"), qid="q1")])
        self.assertIn("barcode is already used", reasons(r)["q1"])
        ok = push(self.a, [change("product_variant", variant_row("var_3", barcode=None), qid="q2"),
                           change("product_variant", variant_row("var_4", barcode=None), qid="q3")])
        self.assertEqual(ok.data["rejected"], [])  # variants without a barcode never clash

    def test_owner_record_must_match_the_account(self):
        r = push(self.a, [change("owner", owner_row("owner_x", phone="260977999999"), qid="q1")])
        self.assertIn("does not match the signed-in account", reasons(r)["q1"])


class ImmutabilityAndEditTests(BaseTestCase):
    def setUp(self):
        super().setUp()
        self.a, _ = register()
        base_data(self.a)
        push(self.a, [change("sale", sale_row()), change("sale_line", line_row()),
                      change("stock_movement", movement_row("mov_2", qty=-1, reason="sale", sale_id="sale_1"))])

    def test_stock_movements_are_append_only(self):
        r = push(self.a, [change("stock_movement", movement_row("mov_2", qty=-3, reason="sale", sale_id="sale_1"),
                                 qid="q1", operation="update")])
        self.assertIn("append-only", reasons(r)["q1"])
        self.assertEqual(SyncRecord.objects.get(entity_id="mov_2").data["quantity_change"], -1)

    def test_sale_can_be_voided_but_totals_cannot_change(self):
        voided = {**sale_row(), "status": "void", "void_reason": "wrong item", "updated_at": T1}
        self.assertEqual(push(self.a, [change("sale", voided, operation="update")]).data["rejected"], [])
        self.assertEqual(SyncRecord.objects.get(entity_id="sale_1").state, "void")
        r = push(self.a, [change("sale", {**sale_row(), "total": 99999, "updated_at": T2}, qid="q1", operation="update")])
        self.assertIn("cannot change after the sale is saved", reasons(r)["q1"])
        back = push(self.a, [change("sale", {**voided, "status": "active", "updated_at": T2}, qid="q2", operation="update")])
        self.assertIn("cannot be made active again", reasons(back)["q2"])

    def test_latest_edit_wins_and_stale_edits_are_ignored(self):
        newer = product_row(name="Black school shoes (new)", ts=T2)
        older = product_row(name="Black school shoes (old)", ts=T1)
        push(self.a, [change("product", newer, operation="update")])
        before = ChangeLog.objects.count()
        r = push(self.a, [change("product", older, qid="q1", operation="update")])
        self.assertIn("q1", r.data["accepted"])  # accepted so the phone stops retrying...
        self.assertEqual(ChangeLog.objects.count(), before)  # ...but it changes nothing
        self.assertEqual(SyncRecord.objects.get(entity_id="prod_1").data["name"], "Black school shoes (new)")

    def test_change_log_cannot_be_edited_or_deleted(self):
        entry = ChangeLog.objects.first()
        with self.assertRaises(RuntimeError):
            entry.delete()
        entry.payload = {}
        with self.assertRaises(RuntimeError):
            entry.save()


class TenantAndRoleTests(BaseTestCase):
    def setUp(self):
        super().setUp()
        self.a, _ = register()
        base_data(self.a)

    def test_owners_cannot_see_or_reference_each_others_data(self):
        b, _ = register(phone="0977000003", client_id="owner_b", name="Owner B")
        self.assertEqual(pull(b, "0").data["changes"], [])
        push(b, [change("owner", owner_row("owner_b", phone="260977000003"))])
        r = push(b, [change("sale", sale_row("sale_b", recorded_by="owner_b"), qid="q0"),
                     change("sale_line", line_row("line_b", sale_id="sale_b", variant_id="var_1"), qid="q1")])
        self.assertIn("variant_id 'var_1' does not exist", reasons(r)["q1"])  # var_1 belongs to owner A

    def _staff(self):
        self.a.post("/api/v1/staff", {"id": "staff_1", "name": "Staff One", "phone": "0977000002", "pin": "5678"},
                    format="json")
        push(self.a, [change("staff", staff_row())])
        return login("0977000002", "5678")

    def test_staff_can_record_sales_into_the_owners_data(self):
        staff = self._staff()
        r = push(staff, [change("sale", sale_row("sale_s", recorded_by="staff_1")), change("sale_line", line_row("line_s", sale_id="sale_s")),
                         change("stock_movement", movement_row("mov_s", qty=-1, reason="sale", sale_id="sale_s"))],
                 device="dev_staff")
        self.assertEqual(r.data["rejected"], [])
        self.assertTrue(pull(self.a, "0").data["changes"])
        self.assertIn("sale_s", [c["entityId"] for c in pull(self.a, "0").data["changes"]])

    def test_staff_cannot_change_products_void_or_restock(self):
        staff = self._staff()
        r = push(staff, [
            change("product", product_row("prod_x"), qid="q1"),
            change("sale", sale_row("sale_v", recorded_by="staff_1", status="void", void_reason="x"), qid="q2"),
            change("stock_movement", movement_row("mov_r", qty=10, reason="restock"), qid="q3"),
            change("shop", shop_row(ts=T1), qid="q4"),
        ])
        got = reasons(r)
        self.assertIn("cannot change product", got["q1"])
        self.assertIn("only the owner can void", got["q2"])
        self.assertIn("only record sale stock movements", got["q3"])
        self.assertIn("cannot change shop", got["q4"])

    def test_staff_never_receive_pin_hashes(self):
        staff = self._staff()
        changes = pull(staff, "0").data["changes"]
        owner = next(c for c in changes if c["entity"] == "owner")
        self.assertEqual(owner["payload"]["pin_hash"], "")
        self.assertEqual(next(c for c in changes if c["entity"] == "staff")["payload"]["pin_hash"], "")
        self.assertEqual(next(c for c in pull(self.a, "0").data["changes"] if c["entity"] == "owner")["payload"]["pin_hash"],
                         "hash-of-1234")  # the owner can restore their own hash
