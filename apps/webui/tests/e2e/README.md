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
retain the same browser and profile identities.

Prerequisites:

- A running WebUI and Moss configured with the managed browser gateway.
- A fresh test conversation with a real model account and no unfinished turn.
- Python with `ai-dev-browser >= 0.54.0` and Playwright.
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
The output directory must be new; earlier evidence is never overwritten.

Evidence includes three screenshots, the single submission receipt, identities,
model usage summaries, and page errors. Raw WebSocket traffic, authorization
headers, page screenshots in base64, and model credentials are excluded from
the saved stream summary. The test closes only its own viewing Chrome.

Turn completion is accepted only after a causal tool result for the current
fixture, rejected write or random human input. Historical event replay cannot
satisfy the test. Use `--manual-continuation` only when separately exercising
explicit chat continuation; the default protects automatic handoff notification.

This journey covers the browser write gate and automatic return notification.
Runtime-wide pause/resume, child agents, headful window views, file transfer,
local extension relay, and phone input require their separate live journeys.
