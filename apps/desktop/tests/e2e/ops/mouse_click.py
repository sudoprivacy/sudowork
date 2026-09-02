"""Click an element by its visible text.

Thin delegation to ai-dev-browser's `click_by_text`. We used to hand-roll the
matcher here, and it was the wrong kind of clever: it required an element's
*direct* child text node to equal the target, with a `children.length < 3`
fallback on `textContent`. React nests labels — `<button><Icon/><span>Sudo
Code</span></button>` has no direct text node — so the primary match skipped
every icon+label button in the app, and the fallback's arbitrary child-count
cap dropped more. Cases hit `Element not found` on buttons that were plainly
on screen.

Upstream (>= 0.13.0) locates by *accessible name*, which is what a human
reads off the button. Split labels, icon+span, nested spans, `<div onclick>`
and same-origin iframes all resolve, and `find_by_text` / `click_by_text`
are guaranteed to return the same element. Ambiguous text is scored, so
"Search" prefers the button over a "Search products..." input. A DOM search
is kept upstream as a tier-2 fallback, so attribute-located elements that
the old matcher happened to catch are not lost.

Coordinates are deliberately NOT handled here: the `click` op owns
coordinate clicks (WebDriver §12.5.1). Two ops taking x/y at the same layer
would be the duplicate-API-at-one-level problem, so this op does one thing.
"""

from ai_dev_browser.core.elements import click_by_text
from ai_dev_browser.core.page import js_evaluate


# DOM-structural fallback for when the accessible-name locator can't see a
# target. React renders clickable rows/cards as a bare `<div class="cursor-
# pointer">` with an onClick handler and NO role/aria/onclick attribute — e.g.
# the "Sudo Code" agent card on /guid. Such a div is not in the accessibility
# tree, so click_by_text (accessible-name) returns nothing even though the text
# is plainly on screen. This finds the smallest visible element whose text
# matches, walks up to the nearest clickable ancestor (button / role=button /
# cursor:pointer / onclick), and dispatches a native click — which React's
# root-level delegated listener picks up.
_DOM_CLICK_JS = """(() => {
    const target = %s;
    const vis = (e) => e.offsetHeight > 0 && e.offsetWidth > 0;
    const matches = Array.prototype.slice.call(document.querySelectorAll('*'))
        .filter(e => vis(e) && (e.textContent || '').trim() === target);
    if (!matches.length) return { clicked: false };
    // Smallest match = the most specific (leaf) label, not an outer container.
    matches.sort((a, b) => (a.textContent || '').length - (b.textContent || '').length);
    let el = matches[0], click = el;
    for (let i = 0; i < 6 && click; i++) {
        const cs = getComputedStyle(click);
        if (click.tagName === 'BUTTON' || click.getAttribute('role') === 'button'
            || click.onclick || cs.cursor === 'pointer') break;
        click = click.parentElement;
    }
    (click || el).click();
    return { clicked: true, via: 'dom-fallback', tag: (click || el).tagName };
})()"""


async def mouse_click(tab, text: str = "", wait: float = 1) -> dict:
    """Click the element whose accessible name matches `text`.

    Args:
        tab: Browser tab.
        text: Visible text / accessible name of the target element.
        wait: Seconds to settle after the click (kept for case compatibility;
              upstream already waits for the click to commit).

    Returns:
        {"clicked": True, "ref": ..., "navigated": ...} on success,
        {"error": "Element not found: <text>"} when nothing matches.
    """
    if not text:
        return {"error": "mouse_click requires `text` (use the `click` op for coordinates)"}

    result = await click_by_text(tab, text, timeout=max(wait, 1))
    if result.get("clicked"):
        return result

    # Accessible-name locator missed — try the DOM-structural fallback for
    # React cursor-pointer divs the a11y tree doesn't expose.
    r = await js_evaluate(tab, _DOM_CLICK_JS % repr(text))
    fallback = r.get("result") if isinstance(r, dict) else None
    if isinstance(fallback, dict) and fallback.get("clicked"):
        return fallback

    return {"error": f"Element not found: {text}"}
