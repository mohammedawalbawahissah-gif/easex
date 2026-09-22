"""
The assistant's model-facing surface: what it's told, what it's allowed
to look up, and how a turn runs. Kept separate from tasks.py so the
Celery plumbing and the "what can the model actually do" question can
change independently.

Design choices worth knowing before you touch this:

* The model NEVER sees anything it could use to move money or that's
  sensitive PII — no card codes, no ID numbers, no document images, no
  other users' data. Every tool below is read-only and scoped to
  `user` (the session's owner). If you add a tool, keep that invariant.
* Escalation is a tool call (`escalate_to_human`), not a side-channel
  classifier — the model decides mid-conversation, with the same
  context it's already reasoning over, and the reason it gives becomes
  the `SupportSession.escalation_reason` a human reviewer sees.
* A DETERMINISTIC pre-check runs before the model is even called (see
  tasks.py) for the small set of topics that should never go through
  an LLM's judgment call: a flagged account, or a message that reads
  like a dispute/fraud/appeal. That's not this file's job — it's
  cheaper and more reliable as a keyword/state check than as a model
  decision, and it means those cases can't be talked out of escalating.
"""

import json
import logging
from decimal import Decimal

from django.conf import settings
from django.db import models as dj_models

logger = logging.getLogger(__name__)

MODEL = "claude-sonnet-4-6"
MAX_TOOL_ITERATIONS = 4

SYSTEM_PROMPT = """You are the in-app support assistant for EaseX, a Ghanaian GHS wallet, \
crypto trading, and gift card exchange app.

What you can help with: explaining how wallet loading, transfers, crypto trading, and gift \
card selling work; looking up the user's own balances, recent transactions, KYC tier and \
limit, and current rates; general how-do-I questions about the app.

Ground every account-specific answer in a tool call — never guess a balance, rate, status, or \
limit. If a tool returns nothing relevant, say so plainly rather than filling the gap.

The user may not be signed in (a guest). Account-specific tools will tell you plainly if that's \
the case — when they do, tell the user they'll need to sign in or create an account for that, \
and keep helping with anything else you can (rates, how things work, general questions).

You cannot move money, change account settings, or override any decision (KYC review, gift \
card review, a payout) — only a human agent can. Call escalate_to_human whenever:
- the user asks to speak to a person, agent, or human, in any words
- resolving this genuinely requires an agent (reversing/investigating a transaction, appealing \
a rejected KYC or gift card, anything you can't fully answer from your tools)
- you've tried and still can't help after a couple of turns

When you call escalate_to_human, keep your own reply brief and reassuring — you don't need to \
solve the problem yourself once you've handed it off. Keep all replies short and plain; this is \
a chat window, not an essay."""

TOOLS = [
    {
        "name": "get_wallet_balances",
        "description": "The user's wallet balances, one row per currency they hold.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_recent_transactions",
        "description": "The user's most recent transactions (type, status, amount, date).",
        "input_schema": {
            "type": "object",
            "properties": {"limit": {"type": "integer", "description": "1-10, default 5"}},
        },
    },
    {
        "name": "get_kyc_status",
        "description": "The user's KYC tier, daily transaction limit in GHS, and their latest verification submission's status.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_giftcard_rate",
        "description": "Current GHS payout rate for a gift card brand or subcategory, matched by name.",
        "input_schema": {
            "type": "object",
            "properties": {"brand_or_subcategory": {"type": "string"}},
            "required": ["brand_or_subcategory"],
        },
    },
    {
        "name": "get_exchange_rate",
        "description": "Current buy/sell GHS rate for a tradable crypto currency, by its code (e.g. BTC, USDT).",
        "input_schema": {
            "type": "object",
            "properties": {"currency": {"type": "string"}},
            "required": ["currency"],
        },
    },
    {
        "name": "escalate_to_human",
        "description": "Connect the user to a live agent. See system prompt for when to use this.",
        "input_schema": {
            "type": "object",
            "properties": {
                "reason": {
                    "type": "string",
                    "enum": ["user_requested", "restricted_intent", "low_confidence"],
                },
                "notes": {
                    "type": "string",
                    "description": "One sentence summarising the issue, for the agent picking this up.",
                },
            },
            "required": ["reason", "notes"],
        },
    },
]


def _json_default(value):
    if isinstance(value, Decimal):
        return str(value)
    raise TypeError(f"not serializable: {value!r}")


ACCOUNT_TOOLS = {"get_wallet_balances", "get_recent_transactions", "get_kyc_status"}


def _run_tool(name: str, tool_input: dict, *, user) -> dict:
    # Guests have no account — these three tools are meaningless without
    # one, so return a clear "not signed in" result the model can relay,
    # rather than crashing on a None user.
    if user is None and name in ACCOUNT_TOOLS:
        return {"error": "not_signed_in", "message": "This needs an account — the user isn't signed in."}

    if name == "get_wallet_balances":
        from apps.wallets.models import Wallet

        return {
            "wallets": [
                {"currency": w.currency, "balance": str(w.balance)}
                for w in Wallet.objects.filter(user=user).order_by("currency")
            ]
        }

    if name == "get_recent_transactions":
        from apps.transactions.models import Transaction

        limit = tool_input.get("limit") or 5
        try:
            limit = max(1, min(int(limit), 10))
        except (TypeError, ValueError):
            limit = 5
        qs = Transaction.objects.filter(user=user).order_by("-created_at")[:limit]
        return {
            "transactions": [
                {
                    "type": t.transaction_type,
                    "status": t.status,
                    "amount": str(t.amount),
                    "currency": t.currency,
                    "created_at": t.created_at.isoformat(),
                }
                for t in qs
            ]
        }

    if name == "get_kyc_status":
        latest = user.kyc_submissions.order_by("-submitted_at").first()
        return {
            "tier": user.kyc_tier,
            "daily_limit_ghs": user.daily_limit(),
            "latest_submission_status": latest.status if latest else None,
        }

    if name == "get_giftcard_rate":
        from apps.giftcards.models import GiftCardSubcategory

        query = (tool_input.get("brand_or_subcategory") or "").strip()
        if not query:
            return {"found": False}
        sub = (
            GiftCardSubcategory.objects.filter(is_active=True, brand__is_active=True)
            .filter(dj_models.Q(name__icontains=query) | dj_models.Q(brand__name__icontains=query))
            .select_related("brand")
            .order_by("sort_order")
            .first()
        )
        if not sub or sub.rate is None:
            return {"found": False}
        return {
            "found": True,
            "brand": sub.brand.name,
            "subcategory": sub.name,
            "card_currency": sub.currency,
            "rate_ghs_per_unit": str(sub.rate),
        }

    if name == "get_exchange_rate":
        from apps.exchange.models import ExchangeRate

        code = (tool_input.get("currency") or "").strip().upper()
        rate = ExchangeRate.objects.filter(currency=code).first()
        if not rate:
            return {"found": False}
        return {
            "found": True,
            "currency": code,
            "buy_rate_ghs": str(rate.buy_rate),
            "sell_rate_ghs": str(rate.sell_rate),
        }

    return {"error": f"unknown tool '{name}'"}


class AssistantTurnResult:
    """What tasks.py needs back from run_turn, nothing more."""

    def __init__(self, *, reply_text: str | None, escalation: dict | None):
        self.reply_text = reply_text
        self.escalation = escalation  # {"reason": ..., "notes": ...} or None


def run_turn(history: list[dict], *, user) -> AssistantTurnResult:
    """
    `history` is the session's messages as {"role": "user"|"assistant", "content": str},
    oldest first. Runs the tool-call loop and returns once the model produces a plain
    reply or calls escalate_to_human — whichever comes first.
    """
    import anthropic

    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    messages = [dict(m) for m in history]

    for _ in range(MAX_TOOL_ITERATIONS):
        response = client.messages.create(
            model=MODEL,
            max_tokens=600,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages,
        )

        tool_uses = [b for b in response.content if b.type == "tool_use"]
        text = "\n".join(b.text for b in response.content if b.type == "text").strip()

        if not tool_uses:
            return AssistantTurnResult(reply_text=text or None, escalation=None)

        escalate_call = next((t for t in tool_uses if t.name == "escalate_to_human"), None)

        messages.append({"role": "assistant", "content": response.content})
        tool_results = []
        for call in tool_uses:
            if call.name == "escalate_to_human":
                result = {"status": "handing off to an agent"}
            else:
                try:
                    result = _run_tool(call.name, call.input, user=user)
                except Exception:
                    logger.exception("Support tool %s raised", call.name)
                    result = {"error": "lookup failed"}
            tool_results.append(
                {"type": "tool_result", "tool_use_id": call.id, "content": json.dumps(result, default=_json_default)}
            )
        messages.append({"role": "user", "content": tool_results})

        if escalate_call:
            reason = escalate_call.input.get("reason") or "low_confidence"
            notes = escalate_call.input.get("notes", "")
            return AssistantTurnResult(
                reply_text=text or None,
                escalation={"reason": reason, "notes": notes},
            )

    # Exhausted the tool-call budget without a plain answer or an explicit
    # escalation — don't leave the user stuck with the bot indefinitely.
    return AssistantTurnResult(
        reply_text=None,
        escalation={"reason": "low_confidence", "notes": "Assistant didn't resolve this within its tool-call budget."},
    )
