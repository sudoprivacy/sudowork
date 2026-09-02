"""Shared UI-readiness probe: is the chat send-box present and interactive?

Single source of truth for "the app is in a usable conversation view",
consumed by `wait_for_app_ready` and `reset_conversation`. Locale-independent
by design — it keys off the send-box <textarea>'s visibility
(offsetHeight/Width > 0), never a localized label. The login screen and the
InitLoading dialog carry no visible chat textarea (only hidden inputs), so a
visible one is a reliable "ready" signal in any language.
"""

from ai_dev_browser.core.page import js_evaluate

_VISIBLE_SENDBOX_JS = """
(function() {
    var tas = Array.prototype.slice.call(document.querySelectorAll('textarea'));
    return tas.some(function(ta) { return ta.offsetHeight > 0 && ta.offsetWidth > 0; });
})()
"""


async def has_visible_sendbox(tab) -> bool:
    """True when a visible (interactive) chat send-box textarea is on screen."""
    r = await js_evaluate(tab, _VISIBLE_SENDBOX_JS)
    return bool(r.get("result"))
