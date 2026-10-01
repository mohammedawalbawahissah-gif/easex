import io
from datetime import date

from PIL import Image
from rest_framework.test import APIClient, APITestCase

from apps.payments.testing import make_user

from .models import KYCSubmission


def _real_png():
    buf = io.BytesIO()
    Image.new("RGB", (2, 2), color=(5, 10, 15)).save(buf, format="PNG")
    return buf.getvalue()


class Base(APITestCase):
    def setUp(self):
        self.owner = make_user("kyc_owner")
        self.stranger = make_user("kyc_stranger")
        self.staff = make_user("kyc_staff", staff=True)

    def api(self, user=None):
        c = APIClient()
        if user:
            c.force_authenticate(user)
        return c

    def _make_submission(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        png = _real_png()
        return KYCSubmission.objects.create(
            user=self.owner,
            full_name="Test Owner",
            date_of_birth=date(1990, 1, 1),
            id_type=KYCSubmission.IDType.NATIONAL_ID,
            id_number="X123456",
            id_document_front=SimpleUploadedFile("front.png", png, content_type="image/png"),
            selfie=SimpleUploadedFile("selfie.png", png, content_type="image/png"),
        )


class KYCImageAccessTests(Base):
    """
    apps.compliance.views.KYCImageView — added alongside the audit fix for
    KYC documents being reachable by anyone with the URL. Each case here
    is one of the scenarios checked by hand during that fix, now
    permanent so a future change can't silently reopen it.
    """

    def test_unauthenticated_request_is_rejected(self):
        sub = self._make_submission()
        r = self.api().get(f"/api/compliance/kyc/{sub.id}/image/selfie/")
        self.assertEqual(r.status_code, 401)

    def test_a_different_user_cannot_view_it(self):
        sub = self._make_submission()
        r = self.api(self.stranger).get(f"/api/compliance/kyc/{sub.id}/image/selfie/")
        self.assertEqual(r.status_code, 403)

    def test_the_owner_can_view_their_own_image(self):
        sub = self._make_submission()
        r = self.api(self.owner).get(f"/api/compliance/kyc/{sub.id}/image/selfie/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r["Content-Type"], "image/png")
        content = b"".join(r.streaming_content) if r.streaming else r.content
        self.assertEqual(content, _real_png())

    def test_staff_can_view_it(self):
        sub = self._make_submission()
        r = self.api(self.staff).get(f"/api/compliance/kyc/{sub.id}/image/selfie/")
        self.assertEqual(r.status_code, 200)

    def test_an_unknown_field_name_404s_instead_of_leaking_anything(self):
        sub = self._make_submission()
        r = self.api(self.owner).get(f"/api/compliance/kyc/{sub.id}/image/card_code_hash/")
        self.assertEqual(r.status_code, 404)

    def test_the_serializer_points_at_the_authenticated_url_not_media_url(self):
        sub = self._make_submission()
        r = self.api(self.owner).get("/api/compliance/kyc/")
        data = r.json()[0]
        self.assertIn(f"/api/compliance/kyc/{sub.id}/image/selfie/", data["selfie"])
        self.assertNotIn("/media/", data["selfie"])
