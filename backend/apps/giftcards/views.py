from django.db.models import Prefetch
from apps.security.permissions import IsStaffWith2FA
from apps.security.services import SecurityError
from apps.security.throttles import SensitiveActionThrottle
from apps.security.views import security_error_response
from rest_framework import permissions, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from . import services
from .models import GiftCardBrand, GiftCardSubcategory, GiftCardSubmission
from .serializers import AdminGiftCardSubmissionSerializer, BrandSerializer, GiftCardSubmissionSerializer


class GiftCardSubmissionViewSet(viewsets.ModelViewSet):
    """
    Users submit cards and view their own submission history.
    Review/approval happens through AdminGiftCardSubmissionViewSet
    below (or Django admin), not through this client-facing endpoint.
    """
    serializer_class = GiftCardSubmissionSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "post", "head"]

    def get_queryset(self):
        return GiftCardSubmission.objects.filter(user=self.request.user).select_related(
            "transaction", "subcategory__brand"
        ).prefetch_related("gallery")


class AdminGiftCardSubmissionViewSet(viewsets.ReadOnlyModelViewSet):
    """
    The staff review queue. `review` mirrors exactly the approve/reject
    logic already in apps/giftcards/admin.py's bulk actions, so the
    portal and Django admin never disagree about what "approve" means.
    """
    serializer_class = AdminGiftCardSubmissionSerializer
    permission_classes = [IsStaffWith2FA]

    def get_queryset(self):
        qs = GiftCardSubmission.objects.select_related(
            "user", "transaction", "subcategory__brand"
        ).prefetch_related("gallery").order_by("-submitted_at")
        status_filter = self.request.query_params.get("status")
        if status_filter:
            qs = qs.filter(transaction__status=status_filter)
        brand = self.request.query_params.get("brand")
        if brand:
            qs = qs.filter(brand=brand)
        return qs

    @action(detail=True, methods=["post"])
    def review(self, request, pk=None):
        """
        approve  — requires `redeemed_confirmed: true` and `redeemed_value`
                   (what the reviewer actually got out of the card). The
                   payout is computed server-side from that.
        reject / flag — as before.
        """
        submission = self.get_object()
        decision = request.data.get("decision")
        if decision not in ("approve", "reject", "flag"):
            raise serializers.ValidationError({"decision": "Must be 'approve', 'reject', or 'flag'."})
        notes = request.data.get("reviewer_notes", "")

        try:
            if decision == "approve":
                submission = services.approve_submission(
                    submission.pk,
                    actor=request.user,
                    redeemed_confirmed=request.data.get("redeemed_confirmed") is True,
                    redeemed_value=request.data.get("redeemed_value"),
                    redemption_reference=request.data.get("redemption_reference", ""),
                    notes=notes,
                )
            elif decision == "reject":
                submission = services.reject_submission(submission.pk, actor=request.user, notes=notes)
            else:
                submission = services.flag_submission(submission.pk, actor=request.user, notes=notes)
        except services.ReviewError as exc:
            raise serializers.ValidationError(exc.message)

        submission.refresh_from_db()
        return Response(AdminGiftCardSubmissionSerializer(submission).data)

    @action(detail=True, methods=["post"], url_path="reveal-code", throttle_classes=[SensitiveActionThrottle])
    def reveal_code(self, request, pk=None):
        """
        Show the card code to redeem it. Needs a fresh authenticator code in `otp`; audited; capped per hour.
        The response is marked no-store so it can't be cached by a browser or proxy.
        """
        otp = request.data.get("otp", "")
        ip = request.META.get("REMOTE_ADDR", "")
        try:
            code = services.reveal_code(self.get_object().pk, actor=request.user, otp=otp if isinstance(otp, str) else "", ip=ip)
        except services.ReviewError as exc:
            raise serializers.ValidationError(exc.message)
        except SecurityError as exc:
            return security_error_response(exc)
        response = Response({"code": code, "hide_after_seconds": 30})
        response["Cache-Control"] = "no-store"
        return response


class GiftCardCatalogView(APIView):
    """
    Everything the sell screen needs: brands, each with its subcategories (country /
    currency / format / rate / value limits). Sellers only ever see active entries.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        subs = GiftCardSubcategory.objects.filter(is_active=True).order_by("sort_order", "name")
        brands = GiftCardBrand.objects.filter(is_active=True).prefetch_related(
            Prefetch("subcategories", queryset=subs, to_attr="active_subcategories")
        )
        # A brand with nothing sellable under it isn't worth a tile.
        brands = [b for b in brands if b.active_subcategories]
        return Response({"brands": BrandSerializer(brands, many=True).data})
