"""
Shared helper for the two vision-based assists (KYC, gift cards). Both
tasks.py functions call ask_vision_json — this is the ONLY place that
talks to the model for either of them, so the "never raise past this
point, JSON-only, treat failure as no-assessment" contract lives in one
place instead of being reimplemented twice.
"""

import base64
import json
import logging

from django.conf import settings

logger = logging.getLogger(__name__)

MODEL = "claude-sonnet-4-6"

_EXT_TO_MEDIA_TYPE = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
}


def image_block(field):
    """A Django ImageField/FileField -> an Anthropic image content block, or None if absent/unreadable."""
    if not field:
        return None
    try:
        field.open("rb")
        data = field.read()
    except Exception:
        logger.exception("Couldn't read image field for vision assessment: %s", getattr(field, "name", field))
        return None
    finally:
        try:
            field.close()
        except Exception:
            pass

    ext = (field.name.rsplit(".", 1)[-1] if "." in field.name else "").lower()
    media_type = _EXT_TO_MEDIA_TYPE.get(ext, "image/jpeg")
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": media_type, "data": base64.b64encode(data).decode("ascii")},
    }


def ask_vision_json(*, system: str, text_prompt: str, images: list, max_tokens: int = 500):
    """
    Sends the given images plus a prompt, asking for a JSON-only reply, and
    parses it. Returns None — never raises — if the model isn't configured,
    there are no usable images, the call fails, or the reply isn't valid
    JSON. Every caller treats None as "no assessment yet", a normal state
    the reviewer's UI already handles, since this is always a hint layered
    on a human review step and never a required part of the review flow.
    """
    if not settings.ANTHROPIC_API_KEY:
        return None
    blocks = [img for img in images if img is not None]
    if not blocks:
        return None

    import anthropic

    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    try:
        response = client.messages.create(
            model=MODEL,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": blocks + [{"type": "text", "text": text_prompt}]}],
        )
        text = "".join(b.text for b in response.content if b.type == "text").strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text.lower().startswith("json"):
                text = text[4:]
        return json.loads(text)
    except Exception:
        logger.exception("Vision assessment call failed")
        return None
