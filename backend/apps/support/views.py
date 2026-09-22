import uuid

from apps.security.permissions import IsStaffWith2FA
from rest_framework import permissions, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from . import services
from .models import SupportSession
from .serializers import AdminSupportSessionSerializer, SupportSessionSerializer


def _guest_id(request) -> str | None:
    """
    Guests pass their client-generated id as `guest_id` — query param on
    GET (list/retrieve), body field on POST. Raises a clean 400 for a
    malformed value rather than letting an invalid UUID reach the DB
    adapter as an opaque error.
    """
    raw = request.query_params.get("guest_id") or (
        request.data.get("guest_id") if hasattr(request, "data") else None
    )
    if not raw:
        return None
    try:
        return str(uuid.UUID(str(raw)))
    except (ValueError, TypeError):
        raise serializers.ValidationError({"guest_id": "Must be a valid UUID."})


class SupportSessionViewSet(viewsets.ReadOnlyModelViewSet):
    """
    User-facing chat — signed-in users OR guests. `list`/`retrieve` show
    only the caller's own sessions: their account's if authenticated,
    otherwise whatever matches the guest_id they pass. POST /start/
    gets-or-creates the open one; /message/ and /escalate/ act on a
    specific session; /claim_guest/ folds a guest's conversation into
    their account right after they sign in.
    """

    serializer_class = SupportSessionSerializer
    permission_classes = [permissions.AllowAny]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_queryset(self):
        qs = SupportSession.objects.prefetch_related("messages")
        if self.request.user and self.request.user.is_authenticated:
            return qs.filter(user=self.request.user)
        guest_id = _guest_id(self.request)
        if not guest_id:
            return qs.none()
        return qs.filter(guest_id=guest_id)

    @action(detail=False, methods=["post"])
    def start(self, request):
        if request.user.is_authenticated:
            session = services.start_session(request.user)
        else:
            guest_id = _guest_id(request)
            if not guest_id:
                raise serializers.ValidationError({"guest_id": "Required when not signed in."})
            session = services.start_guest_session(guest_id)
        return Response(self.get_serializer(session).data)

    @action(detail=True, methods=["post"])
    def message(self, request, pk=None):
        body = (request.data.get("body") or "").strip()
        attachment = request.FILES.get("attachment")
        if not body and not attachment:
            raise serializers.ValidationError({"body": "Message can't be empty."})
        kwargs = {}
        if request.user.is_authenticated:
            kwargs["user"] = request.user
        else:
            guest_id = _guest_id(request)
            if not guest_id:
                raise serializers.ValidationError({"guest_id": "Required when not signed in."})
            kwargs["guest_id"] = guest_id
        try:
            services.post_user_message(pk, body=body, attachment=attachment, **kwargs)
        except services.SupportError as exc:
            raise serializers.ValidationError(exc.message)
        session = self.get_object()
        return Response(self.get_serializer(session).data)

    @action(detail=True, methods=["post"])
    def escalate(self, request, pk=None):
        """The user explicitly asked for a human — always honoured immediately."""
        session = self.get_object()  # 404s (via get_queryset scoping) before we ever touch services
        try:
            session = services.escalate(
                pk, actor=None, reason=SupportSession.EscalationReason.USER_REQUESTED
            )
        except services.SupportError as exc:
            raise serializers.ValidationError(exc.message)
        return Response(self.get_serializer(session).data)

    @action(detail=False, methods=["post"], permission_classes=[permissions.IsAuthenticated])
    def claim_guest(self, request):
        """
        Call this right after login/signup if the client had a guest_id
        with an open session — folds it into the now-authenticated
        account. Body: {guest_id}. Returns null (not an error) if there
        was nothing to claim.
        """
        raw = request.data.get("guest_id")
        if not raw:
            raise serializers.ValidationError({"guest_id": "Required."})
        try:
            guest_id = str(uuid.UUID(str(raw)))
        except (ValueError, TypeError):
            raise serializers.ValidationError({"guest_id": "Must be a valid UUID."})
        session = services.claim_guest_session(guest_id, user=request.user)
        if not session:
            return Response(None)
        return Response(self.get_serializer(session).data)


class AdminSupportSessionViewSet(viewsets.ReadOnlyModelViewSet):
    """The staff queue — same claim/act/audit pattern as gift cards and KYC."""

    serializer_class = AdminSupportSessionSerializer
    permission_classes = [IsStaffWith2FA]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def get_queryset(self):
        qs = SupportSession.objects.select_related("user", "assigned_admin").prefetch_related("messages")
        # The status filter (default: escalated) is for browsing the queue
        # list only. Detail actions — claim, message, resolve, retrieve —
        # must never apply it: claiming a session moves it to admin_active,
        # and if this filter still applied there, the very next action on
        # that same session (replying, resolving) would 404 because the
        # session no longer matches "status=escalated". Confirmed live:
        # this was a real bug before this fix, not a hypothetical one.
        if self.action == "list":
            status_filter = self.request.query_params.get("status", SupportSession.Status.ESCALATED)
            if status_filter:
                qs = qs.filter(status=status_filter)
        return qs

    @action(detail=True, methods=["post"])
    def claim(self, request, pk=None):
        try:
            session = services.claim(pk, actor=request.user)
        except services.SupportError as exc:
            raise serializers.ValidationError(exc.message)
        return Response(self.get_serializer(session).data)

    @action(detail=True, methods=["post"])
    def message(self, request, pk=None):
        body = (request.data.get("body") or "").strip()
        attachment = request.FILES.get("attachment")
        if not body and not attachment:
            raise serializers.ValidationError({"body": "Message can't be empty."})
        try:
            services.post_admin_message(pk, actor=request.user, body=body, attachment=attachment)
        except services.SupportError as exc:
            raise serializers.ValidationError(exc.message)
        session = self.get_object()
        return Response(self.get_serializer(session).data)

    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        try:
            session = services.resolve(pk, actor=request.user, notes=request.data.get("notes", ""))
        except services.SupportError as exc:
            raise serializers.ValidationError(exc.message)
        return Response(self.get_serializer(session).data)
