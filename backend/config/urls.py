from django.contrib import admin
from django.conf import settings
from django.conf.urls.static import static
from django.urls import include, path

urlpatterns = [
    path(settings.ADMIN_URL, admin.site.urls),
    path("api/auth/", include("apps.users.urls")),
    path("api/wallets/", include("apps.wallets.urls")),
    path("api/transactions/", include("apps.transactions.urls")),
    path("api/giftcards/", include("apps.giftcards.urls")),
    path("api/notifications/", include("apps.notifications.urls")),
    path("api/exchange/", include("apps.exchange.urls")),
    path("api/payments/", include("apps.payments.urls")),
    path("api/security/", include("apps.security.urls")),
    path("api/compliance/", include("apps.compliance.urls")),
    path("api/support/", include("apps.support.urls")),
    path("api/admin/", include("config.admin_urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
