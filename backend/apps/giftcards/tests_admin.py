from django.conf import settings
from django.test import Client
from rest_framework.test import APITestCase

from apps.payments.testing import make_user

from .models import GiftCardBrand, GiftCardSubcategory

ADMIN = "/" + settings.ADMIN_URL + "giftcards/"


class CatalogAdminProtectionTests(APITestCase):
    """The catalog is the pricing sheet: entries get switched OFF in admin, never deleted."""

    def setUp(self):
        self.root = make_user("root", staff=True)
        self.root.is_superuser = True  # even a superuser must not be able to delete
        self.root.save()
        self.c = Client()
        self.c.force_login(self.root)
        self.brand = GiftCardBrand.objects.get(slug="amazon")
        self.sub = GiftCardSubcategory.objects.get(brand=self.brand, slug="usa-physical")
        self.subs_before = GiftCardSubcategory.objects.count()
        self.brands_before = GiftCardBrand.objects.count()

    def assertNothingDeleted(self):
        self.assertEqual(GiftCardSubcategory.objects.count(), self.subs_before)
        self.assertEqual(GiftCardBrand.objects.count(), self.brands_before)

    def test_even_a_superuser_has_no_delete_permission(self):
        from django.contrib import admin as dj_admin

        for model in (GiftCardBrand, GiftCardSubcategory):
            self.assertFalse(dj_admin.site._registry[model].has_delete_permission(self._request(), None), model)

    def _request(self):
        from django.test import RequestFactory

        r = RequestFactory().get("/")
        r.user = self.root
        return r

    def test_the_brand_page_has_no_delete_checkboxes_on_its_subcategory_rows(self):
        # This tick-box is how an entry gets deleted by accident while saving a brand.
        html = self.c.get(f"{ADMIN}giftcardbrand/{self.brand.pk}/change/").content.decode()
        self.assertEqual(self.c.get(f"{ADMIN}giftcardbrand/{self.brand.pk}/change/").status_code, 200)
        self.assertNotIn("-DELETE", html)
        self.assertNotIn("deletelink", html)
        self.assertIn("Deleting is disabled", html)  # and it tells you what to do instead

    def test_the_subcategory_page_has_no_delete_button_and_explains_why(self):
        html = self.c.get(f"{ADMIN}giftcardsubcategory/{self.sub.pk}/change/").content.decode()
        self.assertNotIn("deletelink", html)
        self.assertIn("untick", html.lower())

    def test_delete_urls_are_forbidden(self):
        for path in (f"{ADMIN}giftcardsubcategory/{self.sub.pk}/delete/", f"{ADMIN}giftcardbrand/{self.brand.pk}/delete/"):
            self.assertEqual(self.c.get(path).status_code, 403, path)
            self.assertEqual(self.c.post(path, {"post": "yes"}).status_code, 403, path)
        self.assertNothingDeleted()

    def test_bulk_delete_is_not_offered_and_does_not_work(self):
        for model in ("giftcardsubcategory", "giftcardbrand"):
            self.assertNotIn("delete_selected", self.c.get(f"{ADMIN}{model}/").content.decode())
        self.c.post(f"{ADMIN}giftcardsubcategory/", {"action": "delete_selected", "_selected_action": [str(self.sub.pk)], "post": "yes"})
        self.c.post(f"{ADMIN}giftcardbrand/", {"action": "delete_selected", "_selected_action": [str(self.brand.pk)], "post": "yes"})
        self.assertNothingDeleted()

    def test_switching_an_entry_off_still_works(self):
        s = self.sub
        r = self.c.post(f"{ADMIN}giftcardsubcategory/{s.pk}/change/", {
            "brand": s.brand_id, "name": s.name, "slug": s.slug, "country": s.country, "currency": s.currency,
            "card_format": s.card_format, "sort_order": s.sort_order, "help_text": s.help_text,
            "allow_auto_payment": "on",  # is_active deliberately omitted = unticked
        })
        self.assertEqual(r.status_code, 302, r.content.decode()[:300])
        s.refresh_from_db()
        self.assertFalse(s.is_active)
        self.assertNothingDeleted()

    def test_a_deactivated_entry_disappears_from_the_sell_screen_but_keeps_its_data(self):
        self.sub.rate = 12
        self.sub.is_active = False
        self.sub.save()
        self.client.force_authenticate(make_user("seller"))
        subs = {s["slug"] for b in self.client.get("/api/giftcards/catalog/").json()["brands"] if b["slug"] == "amazon" for s in b["subcategories"]}
        self.assertNotIn("usa-physical", subs)
        self.sub.refresh_from_db()
        self.assertEqual(float(self.sub.rate), 12.0)  # the price is still there for when it's switched back on
