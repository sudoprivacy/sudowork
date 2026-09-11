"""Shared UI-readiness probes: how far has the renderer actually got?

Single source of truth for two questions the rest of the framework keeps
asking, consumed by `wait_for_app_ready`, `reset_conversation`,
`dismiss_init_dialog` and the auth seeding in `restart_electron.py`:

- `has_visible_sendbox` — "is the app in a usable conversation view", the
  readiness gate. It keys off the send-box <textarea>'s visibility
  (offsetHeight/Width > 0), never a localized label. The login screen and the
  InitLoading dialog carry no visible chat textarea (only hidden inputs), so a
  visible one is a reliable "ready" signal in any language.
- `shell_state` — the coarser "has the shell mounted, and are we past the
  login screen", for callers that must tell "still booting" apart from
  "booted, just not on a chat route".

Both are locale-independent by design.
"""

import asyncio

from ai_dev_browser.core.page import js_evaluate

_VISIBLE_SENDBOX_JS = """
(function() {
    var tas = Array.prototype.slice.call(document.querySelectorAll('textarea'));
    return tas.some(function(ta) { return ta.offsetHeight > 0 && ta.offsetWidth > 0; });
})()
"""

# 'pending' (renderer not mounted) | 'login' | 'in-app'. Any route but the
# login screen counts as in-app, rather than an allowlist of in-app routes
# that would go stale the next time a route is renamed.
SHELL_STATE_JS = """
(function() {
    var root = document.getElementById('root');
    if (!root || root.childElementCount === 0) return 'pending';
    return (location.hash || '').indexOf('#/login') === 0 ? 'login' : 'in-app';
})()
"""


async def has_visible_sendbox(tab) -> bool:
    """True when a visible (interactive) chat send-box textarea is on screen."""
    r = await js_evaluate(tab, _VISIBLE_SENDBOX_JS)
    return bool(r.get("result"))


async def shell_state(tab) -> str:
    """Current shell state: 'pending', 'login' or 'in-app'."""
    r = await js_evaluate(tab, SHELL_STATE_JS)
    return r.get("result") if isinstance(r, dict) else str(r)


async def wait_for_shell_state(tab, wanted: set, timeout: float, poll_interval: float = 1) -> bool:
    """Poll until the shell reaches one of `wanted`, or `timeout` elapses."""
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        if await shell_state(tab) in wanted:
            return True
        await asyncio.sleep(poll_interval)
    return False
