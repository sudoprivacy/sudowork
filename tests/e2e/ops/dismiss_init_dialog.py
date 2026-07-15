"""Settle the boot gate: wait until the app is either past init, or sitting on
the "Starting Core Services" dialog — and dismiss the dialog if it's there.

Why this is its own op rather than a flag on `wait_for_app_ready`: the ready
gate's single job is "is the send-box interactive yet". Teaching it to click
things would make it two jobs and hide a real boot failure behind a click.
This op owns the *other* job — resolving the init gate — and leaves the
readiness assertion to `wait_for_app_ready` running after it.

The dialog appears when a runtime install fails at startup. In CI that is
expected: the Nexus install needs the `nexus-napi` native binding, which
requires a Rust + napi-rs toolchain we don't provision for the e2e job (and
the interrupt+queue path under test never touches Nexus/VFS). Skip enters the
app with the failed runtime disabled — the documented product behaviour for
"enter the app now, runtime setup continues in the background", not a hack.

On a healthy dev box every runtime installs, the dialog never renders, and
this op returns `already-booted` without clicking anything.
"""

import asyncio

from ai_dev_browser.core.page import js_evaluate


# Probe both terminal states in one round-trip: the Skip button (init gate up)
# and a visible send-box textarea (already in the app). Mirrors the visibility
# rule in wait_for_app_ready — a textarea in the DOM but offscreen (login
# screen, unmounted dialog) does not count as booted.
_PROBE = """
(function() {
    var buttons = Array.prototype.slice.call(document.querySelectorAll('button'));
    var skip = buttons.filter(function(b) {
        var t = (b.textContent || '').trim();
        return t === 'Skip' || t === '跳过';
    })[0];
    if (skip) { skip.click(); return 'dismissed'; }

    var ta = document.querySelector('textarea');
    if (ta && ta.offsetHeight > 0 && ta.offsetWidth > 0) return 'already-booted';

    return 'pending';
})()
"""


async def dismiss_init_dialog(tab, timeout: float = 180, poll_interval: float = 2) -> dict:
    """Resolve the startup gate before a case drives the UI.

    Args:
        tab: Browser tab.
        timeout: Max seconds to wait for the app to reach a known boot state.
        poll_interval: Seconds between probes.

    Returns:
        {"pass": True, "state": "dismissed"}      — init dialog was up; Skip clicked.
        {"pass": True, "state": "already-booted"} — app was already in the main UI.
        {"pass": False, "reason": ...}            — neither state within `timeout`
            (renderer never mounted, stuck on login, crashed on boot).
    """
    deadline = asyncio.get_running_loop().time() + timeout

    while asyncio.get_running_loop().time() < deadline:
        r = await js_evaluate(tab, _PROBE)
        state = r.get("result")

        if state == "dismissed":
            # Let the app tear down the dialog and mount the main UI. The
            # caller's wait_for_app_ready is the real gate; this is just to
            # avoid probing mid-transition.
            await asyncio.sleep(2)
            return {"pass": True, "state": "dismissed"}

        if state == "already-booted":
            return {"pass": True, "state": "already-booted"}

        await asyncio.sleep(poll_interval)

    return {
        "pass": False,
        "reason": (
            f"app reached neither the init dialog nor the main UI within {timeout}s "
            "— renderer likely never mounted (check the launch log for a crash, "
            "or an unexpected screen such as login)"
        ),
    }
