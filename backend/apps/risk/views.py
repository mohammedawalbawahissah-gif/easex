from apps.security.permissions import IsStaffWith2FA
from django.http import JsonResponse
from rest_framework import serializers as drf_serializers
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ComplianceRiskSettings, GiftCardAssessment, KYCAssessment
from .serializers import ComplianceRiskSettingsSerializer, GiftCardAssessmentSerializer, KYCAssessmentSerializer


class AdminKYCAssessmentView(APIView):
    """
    Returns JSON null (200, body literally "null") rather than 404 when no
    assessment exists yet — it may still be running, assist may be
    disabled, or the submission may predate this feature. Either way
    that's a normal state for KYCAssessmentPanel.tsx to render nothing
    for, not an error.

    Uses django.http.JsonResponse rather than DRF's Response here
    specifically: DRF's JSONRenderer treats `Response(None)` as "no
    content" and sends an EMPTY body (verified against a running
    instance) — which breaks a frontend `.json()` call expecting valid
    JSON. JsonResponse(None, safe=False) sends the literal 4 bytes "null".
    """

    permission_classes = [IsStaffWith2FA]

    def get(self, request, submission_id):
        try:
            assessment = KYCAssessment.objects.get(submission_id=submission_id)
        except KYCAssessment.DoesNotExist:
            return JsonResponse(None, safe=False)
        return Response(KYCAssessmentSerializer(assessment).data)


class AdminGiftCardAssessmentView(APIView):
    """Same null-if-absent contract as AdminKYCAssessmentView, same reason for JsonResponse over Response(None)."""

    permission_classes = [IsStaffWith2FA]

    def get(self, request, submission_id):
        try:
            assessment = GiftCardAssessment.objects.get(submission_id=submission_id)
        except GiftCardAssessment.DoesNotExist:
            return JsonResponse(None, safe=False)
        return Response(GiftCardAssessmentSerializer(assessment).data)


class AdminRiskSettingsView(APIView):
    """Single-row settings — GET to read, POST (partial) to update. Same shape you'd want for PaymentSettings."""

    permission_classes = [IsStaffWith2FA]

    def get(self, request):
        return Response(ComplianceRiskSettingsSerializer(ComplianceRiskSettings.get()).data)

    def post(self, request):
        obj = ComplianceRiskSettings.get()
        serializer = ComplianceRiskSettingsSerializer(obj, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class AdminCopilotView(APIView):
    """
    Stateless — the client sends the whole conversation each time, same
    shape as the Anthropic API itself. Nothing here is persisted; if a
    saved history is wanted later, it's a straightforward SupportSession
    -shaped addition, not a rework of this endpoint.
    """

    permission_classes = [IsStaffWith2FA]

    def post(self, request):
        history = request.data.get("messages")
        if not isinstance(history, list) or not history:
            raise drf_serializers.ValidationError({"messages": "Must be a non-empty list of {role, content}."})

        from . import copilot

        try:
            reply = copilot.run_turn(history)
        except copilot.CopilotError as exc:
            raise drf_serializers.ValidationError(exc.message)
        return Response({"role": "assistant", "content": reply})
