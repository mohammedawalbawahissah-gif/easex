"""
The staff-facing natural-language query surface over compliance flags,
transactions, and the review queues. Same tool-calling shape as
apps/support/ai.py, but for staff, with broader cross-user read access,
and stateless (see AdminCopilotView — the client resends the whole
conversation each turn, same as the raw Anthropic API).

Every tool here is READ-ONLY. This module cannot approve, reject, settle,
flag, or change anything — it answers questions. If it ever needs to act,
that's a materially different trust boundary and deserves its own review,
not a tool quietly added here.
"""

import json
import logging

from django.conf import settings

logger = logging.getLogger(__name__)

MODEL = "claude-sonnet-4-6"
MAX_TOOL_ITERATIONS = 5

SYSTEM_PROMPT = """You are an internal assistant for EaseX staff (compliance and support \
reviewers). You answer questions about compliance flags, transactions, and the KYC / gift-card \
review queues using your tools — never guess a number or status. Keep answers short and \
concrete; reviewers are using you between other tasks, not reading a report. If a question is \
ambiguous, make a reasonable assumption and briefly say what you assumed rather than asking a \
clarifying question."""

TOOLS = [
    {
        "name": "count_compliance_flags",
        "description": "Count compliance flags, optionally filtered by status and/or reason.",
        "input_schema": {
            "type": "object",
            "properties": {
                "status": {"type": "string", "enum": ["open", "reviewing", "cleared", "escalated"]},
                "reason": {
                    "type": "string",
                    "enum": ["structuring", "duplicate_card", "velocity", "manual", "other"],
                },
            },
        },
    },
    {
        "name": "list_compliance_flags",
        "description": "List recent compliance flags (username, reason, status, notes, date), optionally filtered.",
        "input_schema": {
            "type": "object",
            "properties": {
                "status": {"type": "string", "enum": ["open", "reviewing", "cleared", "escalated"]},
                "reason": {
                    "type": "string",
                    "enum": ["structuring", "duplicate_card", "velocity", "manual", "other"],
                },
                "limit": {"type": "integer", "description": "1-25, default 10"},
            },
        },
    },
    {
        "name": "search_transactions",
        "description": "Search transactions by status, type, GHS amount range, and recency.",
        "input_schema": {
            "type": "object",
            "properties": {
                "status": {"type": "string"},
                "transaction_type": {"type": "string"},
                "min_ghs": {"type": "number"},
                "max_ghs": {"type": "number"},
                "since_hours": {"type": "integer", "description": "Only transactions created within this many hours"},
                "limit": {"type": "integer", "description": "1-25, default 10"},
            },
        },
    },
    {
        "name": "queue_counts",
        "description": "Current counts of items waiting in the KYC and gift-card review queues.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_user_summary",
        "description": "KYC tier, flag status, and recent transaction count for a user, by username.",
        "input_schema": {
            "type": "object",
            "properties": {"username": {"type": "string"}},
            "required": ["username"],
        },
    },
]


class CopilotError(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


def _run_tool(name: str, tool_input: dict) -> dict:
    from django.contrib.auth import get_user_model

    from apps.compliance.models import ComplianceFlag, KYCSubmission
    from apps.giftcards.models import GiftCardSubmission
    from apps.transactions.models import Transaction

    User = get_user_model()

    if name == "count_compliance_flags":
        qs = ComplianceFlag.objects.all()
        if tool_input.get("status"):
            qs = qs.filter(status=tool_input["status"])
        if tool_input.get("reason"):
            qs = qs.filter(reason=tool_input["reason"])
        return {"count": qs.count()}

    if name == "list_compliance_flags":
        qs = ComplianceFlag.objects.select_related("user").order_by("-created_at")
        if tool_input.get("status"):
            qs = qs.filter(status=tool_input["status"])
        if tool_input.get("reason"):
            qs = qs.filter(reason=tool_input["reason"])
        limit = max(1, min(int(tool_input.get("limit") or 10), 25))
        return {
            "flags": [
                {
                    "username": f.user.username,
                    "reason": f.reason,
                    "status": f.status,
                    "notes": f.notes[:200],
                    "created_at": f.created_at.isoformat(),
                }
                for f in qs[:limit]
            ]
        }

    if name == "search_transactions":
        qs = Transaction.objects.select_related("user").order_by("-created_at")
        if tool_input.get("status"):
            qs = qs.filter(status=tool_input["status"])
        if tool_input.get("transaction_type"):
            qs = qs.filter(transaction_type=tool_input["transaction_type"])
        if tool_input.get("min_ghs") is not None:
            qs = qs.filter(ghs_value__gte=tool_input["min_ghs"])
        if tool_input.get("max_ghs") is not None:
            qs = qs.filter(ghs_value__lte=tool_input["max_ghs"])
        if tool_input.get("since_hours") is not None:
            from django.utils import timezone

            qs = qs.filter(
                created_at__gte=timezone.now() - timezone.timedelta(hours=int(tool_input["since_hours"]))
            )
        limit = max(1, min(int(tool_input.get("limit") or 10), 25))
        return {
            "transactions": [
                {
                    "username": t.user.username,
                    "type": t.transaction_type,
                    "status": t.status,
                    "amount": str(t.amount),
                    "currency": t.currency,
                    "ghs_value": str(t.ghs_value) if t.ghs_value is not None else None,
                    "created_at": t.created_at.isoformat(),
                }
                for t in qs[:limit]
            ]
        }

    if name == "queue_counts":
        return {
            "kyc_pending": KYCSubmission.objects.filter(status=KYCSubmission.Status.PENDING).count(),
            "giftcards_under_review": GiftCardSubmission.objects.filter(
                transaction__status=Transaction.Status.UNDER_REVIEW
            ).count(),
        }

    if name == "get_user_summary":
        from django.utils import timezone

        username = tool_input.get("username", "")
        try:
            user = User.objects.get(username=username)
        except User.DoesNotExist:
            return {"found": False}
        return {
            "found": True,
            "username": user.username,
            "kyc_tier": user.kyc_tier,
            "is_flagged": user.is_flagged,
            "open_flag_count": ComplianceFlag.objects.filter(
                user=user, status__in=[ComplianceFlag.Status.OPEN, ComplianceFlag.Status.REVIEWING]
            ).count(),
            "transactions_last_30d": Transaction.objects.filter(
                user=user, created_at__gte=timezone.now() - timezone.timedelta(days=30)
            ).count(),
        }

    return {"error": f"unknown tool '{name}'"}


def run_turn(messages: list) -> str:
    """
    `messages` is the whole conversation so far, [{"role": ..., "content": ...}],
    oldest first, ending in the newest user turn. Returns the assistant's
    reply text for this turn.
    """
    if not settings.ANTHROPIC_API_KEY:
        raise CopilotError("The copilot isn't configured yet — set ANTHROPIC_API_KEY.")

    import anthropic

    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    convo = [dict(m) for m in messages]

    for _ in range(MAX_TOOL_ITERATIONS):
        response = client.messages.create(
            model=MODEL, max_tokens=800, system=SYSTEM_PROMPT, tools=TOOLS, messages=convo,
        )
        tool_uses = [b for b in response.content if b.type == "tool_use"]
        text = "\n".join(b.text for b in response.content if b.type == "text").strip()
        if not tool_uses:
            return text or "I don't have an answer for that."

        convo.append({"role": "assistant", "content": response.content})
        results = []
        for call in tool_uses:
            try:
                result = _run_tool(call.name, call.input)
            except Exception:
                logger.exception("Copilot tool %s raised", call.name)
                result = {"error": "lookup failed"}
            results.append({"type": "tool_result", "tool_use_id": call.id, "content": json.dumps(result, default=str)})
        convo.append({"role": "user", "content": results})

    return "That took more digging than I could finish — try narrowing the question."
