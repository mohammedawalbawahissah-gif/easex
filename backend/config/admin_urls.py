"""
Staff-only API surface for the admin portal (a separate web app,
not Django admin — see web/src/pages/admin/). Every viewset here
enforces permissions.IsAdminUser individually; this module just
collects them under one /api/admin/ prefix.
"""
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.compliance.views import AdminDashboardView, AdminKYCSubmissionViewSet, ComplianceFlagViewSet
from apps.giftcards.views import AdminGiftCardSubmissionViewSet
from apps.support.views import AdminSupportSessionViewSet
from apps.transactions.views import AdminTransactionViewSet
from apps.users.views import AdminUserViewSet

router = DefaultRouter()
router.register("kyc", AdminKYCSubmissionViewSet, basename="admin-kyc")
router.register("giftcards", AdminGiftCardSubmissionViewSet, basename="admin-giftcards")
router.register("transactions", AdminTransactionViewSet, basename="admin-transactions")
router.register("compliance-flags", ComplianceFlagViewSet, basename="admin-compliance-flags")
router.register("users", AdminUserViewSet, basename="admin-users")
router.register("support", AdminSupportSessionViewSet, basename="admin-support")

urlpatterns = router.urls + [
    path("dashboard/", AdminDashboardView.as_view(), name="admin-dashboard"),
    path("", include("apps.risk.urls")),
]
