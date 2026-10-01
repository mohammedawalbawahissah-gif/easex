"""
Inbound callbacks from payment providers.

These are the only views in the app that aren't user-authenticated — a
gateway is telling EaseX something happened, not a logged-in user asking
for something. Each one:
  1. Identifies which of OUR transactions this callback is about.
  2. Builds a ProviderResult from the provider's payload.
  3. Calls the same finalize_* functions a webhook is designed to call
     (see services.apply_collection_result / services.finalize_withdrawal —
     both docstrings say "also what a webhook would call").

IMPORTANT — exact payload field names: Hubtel and MTN both version their
callback payloads and have changed field names before. The field names
below match their documentation at the time this was written, but verify
them against a real sandbox callback (log request.data once and inspect
it) before relying on this in production.
"""

import logging

from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.transactions.models import Transaction

from . import services
from .providers import ProviderResult

logger = logging.getLogger(__name__)


def _find_collection_txn(reference: str):
    """A wallet load's ClientReference/externalId is txn.metadata['reference']."""
    return Transaction.objects.filter(metadata__reference=reference).first()


def _find_withdrawal_txn(reference: str):
    """A payout's reference IS the transaction's primary key (see services.execute_withdrawal)."""
    return Transaction.objects.filter(pk=reference).first()


class HubtelCollectionWebhookView(APIView):
    """
    Hubtel's PrimaryCallbackUrl for Receive Money. Point HUBTEL_CALLBACK_URL
    at this view's absolute URL (must be public HTTPS — Hubtel can't reach
    localhost). Configure it in settings AND in the Hubtel merchant dashboard.
    """

    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_classes = []  # gateway retries shouldn't be rate-limited like anonymous users

    def post(self, request):
        data = request.data
        logger.info("Hubtel collection webhook: %s", data)

        client_reference = data.get("ClientReference") or data.get("Data", {}).get("ClientReference")
        hubtel_status = str(data.get("Status") or data.get("Data", {}).get("Status") or "").lower()
        transaction_id = data.get("TransactionId") or data.get("Data", {}).get("TransactionId", "")

        txn = _find_collection_txn(client_reference) if client_reference else None
        if not txn:
            # Don't 4xx a gateway you don't control into retry storms; just
            # log it and return 200. Nothing to reconcile if we can't find it.
            logger.warning("Hubtel collection webhook: no transaction for reference %s", client_reference)
            return Response({"received": True})

        if hubtel_status in ("success", "paid"):
            result = ProviderResult("settled", reference=transaction_id)
        elif hubtel_status in ("failed", "unpaid", "cancelled"):
            result = ProviderResult("failed", message="Hubtel reported the payment failed.")
        else:
            # Still pending (e.g. awaiting the user's PIN) — nothing to do yet.
            return Response({"received": True})

        services.apply_collection_result(txn.pk, result)
        return Response({"received": True})


class HubtelPayoutWebhookView(APIView):
    """Hubtel's callback for Send Money (payouts). Separate URL from collections
    so the two flows can't be confused, even though the handling is similar."""

    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_classes = []  # gateway retries shouldn't be rate-limited like anonymous users

    def post(self, request):
        data = request.data
        logger.info("Hubtel payout webhook: %s", data)

        client_reference = data.get("ClientReference") or data.get("Data", {}).get("ClientReference")
        hubtel_status = str(data.get("Status") or data.get("Data", {}).get("Status") or "").lower()
        transaction_id = data.get("TransactionId") or data.get("Data", {}).get("TransactionId", "")

        txn = _find_withdrawal_txn(client_reference) if client_reference else None
        if not txn:
            logger.warning("Hubtel payout webhook: no transaction for reference %s", client_reference)
            return Response({"received": True})

        if hubtel_status in ("success", "paid"):
            result = ProviderResult("settled", reference=transaction_id)
        elif hubtel_status in ("failed", "cancelled"):
            result = ProviderResult("failed", message="Hubtel reported the payout failed.")
        else:
            return Response({"received": True})

        services.finalize_withdrawal(txn.pk, result)
        return Response({"received": True})


class MTNMoMoWebhookView(APIView):
    """
    MTN MoMo callback. MTN doesn't sign its callbacks the way some gateways
    do, so this URL carries a shared-secret path segment (MTN_MOMO_CALLBACK_
    TOKEN) instead — anyone who doesn't know the token gets a 404 and never
    learns whether a reference exists. Register the full callback URL
    (including the token) as X-Callback-Url when you set up the MoMo API
    subscription.

    Handles both collections and disbursements: MTN's X-Reference-Id is the
    UUID EaseX generated in MTNMoMoProvider — we don't know upfront whether
    it belongs to a load or a withdrawal, so we check both.
    """

    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_classes = []  # gateway retries shouldn't be rate-limited like anonymous users

    def post(self, request, token):
        from django.conf import settings as dj_settings

        if not dj_settings.MTN_MOMO_CALLBACK_TOKEN or token != dj_settings.MTN_MOMO_CALLBACK_TOKEN:
            return Response(status=status.HTTP_404_NOT_FOUND)

        data = request.data
        logger.info("MTN MoMo webhook: %s", data)

        reference_id = data.get("externalId") or data.get("referenceId", "")
        momo_status = str(data.get("status", "")).upper()  # SUCCESSFUL / FAILED / PENDING

        if momo_status == "SUCCESSFUL":
            result = ProviderResult("settled", reference=data.get("financialTransactionId", ""))
        elif momo_status == "FAILED":
            result = ProviderResult("failed", message=data.get("reason", "MTN MoMo reported the transfer failed."))
        else:
            return Response({"received": True})

        # externalId was set to our own `reference` in MTNMoMoProvider — for
        # a collection that's txn.metadata['reference'] (an "EX-..." code);
        # for a payout it's the transaction's own primary key.
        txn = _find_collection_txn(reference_id)
        if txn:
            services.apply_collection_result(txn.pk, result)
            return Response({"received": True})

        txn = _find_withdrawal_txn(reference_id)
        if txn:
            services.finalize_withdrawal(txn.pk, result)
            return Response({"received": True})

        logger.warning("MTN MoMo webhook: no transaction for externalId %s", reference_id)
        return Response({"received": True})
