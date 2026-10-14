# Live shared-browser acceptance

`live_browser_handoff.py` drives the actual WebUI, its real Moss conversation,
the configured model account, and the browser shared with the user. It does not
replace the agent or browser with a test double.

The journey opens a synthetic review page through chat, opens the authenticated
viewer tab, takes control, enters a random value through the viewer, and checks
that an AI write is rejected. Clicking Return to AI sends the handoff note to
the real conversation automatically. The AI reads the same page and clicks
Submit exactly once, without another chat instruction. The fixture verifies
the random value, original cookie, and trusted browser click. Both views must
retain the same browser and profile identities. Finally, the journey reloads
the conversation and checks that its completed model history and random human
input remain visible, with the same browser and profile still attached.

Prerequisites:

- A running WebUI and Moss configured with the managed browser gateway.
- A fresh test conversation with a real model account and no unfinished turn.
- Python with `ai-dev-browser >= 0.55.0` and Playwright.
- An isolated test profile. The journey navigates and types into its current tab.

Create a private JSON file outside the repository:

```json
{
  "origin": "http://127.0.0.1:26809",
  "username": "test-user",
  "password": "<test account password>",
  "sessionId": "<test conversation ID>",
  "model": "<actual configured model>"
}
```

```sh
python apps/webui/tests/e2e/live_browser_handoff.py \
  --config /private/browser-live.json \
  --locale en-US \
  --output /private/evidence/browser-handoff-001
```

`--locale` must match the running UI. For a browser worker in Docker or on a
remote VM, set `--fixture-bind` and `--fixture-host` so that worker can reach this
synthetic fixture. The default uses loopback for an entirely local deployment.
An authenticated SSH tunnel or a private fixture relay can expose a different
worker-facing origin. In that case, set `--fixture-port` for the local listener
and `--fixture-origin` for the address reachable from the worker.
The output directory must be new; earlier evidence is never overwritten.

Add `--headful` to exercise managed Chrome's native window. This journey requires
the worker and public browser core to support the window surface. The model
launches headful extension Chrome, the viewer operates its native address bar,
and then switches to Page only for the same form and handoff workflow. It checks
the selected transport, headful state, and window capability explicitly.

Evidence includes three screenshots, the single submission receipt, identities,
model usage summaries, and page errors. Raw WebSocket traffic, authorization
headers, page screenshots in base64, and model credentials are excluded from
the saved stream summary. The test closes only its own viewing Chrome.
Headful runs also save the native window screenshot. Failures retain available
UI screenshots and usage summaries before the viewing Chrome closes.

Turn completion is accepted only after a causal tool result for the current
fixture, rejected write or random human input. Historical event replay cannot
satisfy the test. Use `--manual-continuation` only when separately exercising
explicit chat continuation; the default protects automatic handoff notification.

This journey covers the browser write gate and automatic return notification.
Headful window views are covered when `--headful` is selected.
Runtime-wide pause/resume, child agents, file transfer,
local extension relay, and phone input require their separate live journeys.

## Browser lifecycle controls

`live_browser_lifecycle.py` covers the actual shared panel's Start, Restart,
Stop and Return to AI controls. Use a fresh real-model conversation with a
stopped managed worker, both extension/CDP transports and the window surface.
The test sends no initial chat message: the first AI turn must come from the
browser handoff, and its new random receipt must appear in the conversation.

```sh
python apps/webui/tests/e2e/live_browser_lifecycle.py \
  --config /private/browser-live.json \
  --locale en-US \
  --fixture-origin http://worker-reachable-fixture:50181 \
  --output /private/evidence/browser-lifecycle-001
```

The synthetic fixture listens on local loopback at `--fixture-port` (50181 by
default). A remote worker needs an authenticated tunnel or private relay to this
listener. The journey starts headful extension Chrome, restarts it headless,
then explicitly changes to headful CDP. A unique login cookie is issued once;
both restarts must preserve it in the same persistent profile. Every restart
must create a different browser session. Stop must keep the human control lease
until Return to AI; the real model must finish without reopening Chrome.

Evidence includes five UI screenshots, profile/browser identities, a random
assistant receipt, usage and page errors. Output directories must be new.
Failures retain their screenshot; the test closes only its own viewing Chrome.
The managed browser is left stopped for explicit fixture cleanup.
