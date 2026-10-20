# Live shared-browser acceptance

## Mobile task creation and model selection

Add `--exercise-model-unavailable` to verify the unavailable-model entry before
the normal live journey. It replaces only the model list in a successful real
catalog response with an empty list. The phone-width UI must show the service
error, disable model selection and Send, and keep the draft after Enter without
creating a session. The test removes that fault, reloads, and completes the
usual two real model turns and history readback. Evidence explicitly labels
this failure phase as fault injection; login, APIs and the subsequent model
turns remain real. Keep the interceptor registered throughout the journey and
disable only its fault flag before reloading. Removing the last route changes
Chromium's interception/cache state while requests are in flight. Public
acceptance also exposed an uncompressed 5.4 MB entry module and `no-store`
responses for immutable assets. The gateway snippets under `deploy/nginx/`
compress public assets and cache successful responses; HTML, API responses and
missing assets retain `no-store`. Navigation deadlines remain unchanged.
Failed-request paths and pending request types are recorded without credentials
or request bodies. This does not claim to validate a rejected provider key.

`live_mobile_onboarding.py` starts at the real password login screen with an
isolated acceptance account. At 320, 375 and 390 CSS pixels, it opens the phone
navigation, starts a new task on the same route, checks the composer width and
the readable 44px model control, and chooses an actual available model by touch.
The selection must survive a reload. One visible Send then creates one real
conversation, the selected model returns a fresh marker, and another reload
must restore that exact assistant response. The owned test conversation is
terminated even when a later assertion fails.
It also checks the desktop composer, verifies that the phone conversation stays
wide after reload, and opens the workspace and Browser tabs in a full-width
drawer before returning to chat. It first selects a different available model
and reloads, then selects the requested model, so a pre-existing preference
cannot satisfy the selection check. The creation request must include the
selected qualified model, and the same model must be read back from the new
conversation and the real model-preference API. ACP currently omits model identity from its stream
and history; this UI test records that limit and verifies a real completed turn.
It then uses the phone conversation's visible 44px Send control for a second
fresh turn and checks that both replies survive another reload in the same session.

Use a private configuration with `origin`, `username` and `password`, a real
model account, and a new evidence directory:

```sh
python apps/webui/tests/e2e/live_mobile_onboarding.py \
  --config /private/mobile-acceptance.json \
  --model gpt-6-luna \
  --output /private/evidence/mobile-onboarding-001
```

`--assets-dir apps/webui/dist/client` checks a compiled candidate SPA before
deployment. It replaces only that browser's document and static asset responses;
authentication, model preferences, session APIs and WebSockets still use the
configured real origin. This option does not establish a production deployment.
Run the same journey without the option after deployment. The script changes
the isolated account's model preference and sends two real model turns, which
may incur charges.
It closes its own viewing browser and retains screenshots and failure evidence.
An iPhone-sized Chromium context is recorded as emulation; physical iOS Chrome
and Safari results require their own device runs.

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

## Remote window responsiveness and human login

`live_browser_view_performance.py` measures the actual shared viewer through
authenticated production or staging APIs. It creates a fresh conversation,
launches headful extension Chrome through the UI, samples changing window
pixels, switches to Page view, and submits an exact random Unicode value with
a trusted browser click. It verifies the visible login result and exactly one
server receipt. The fixture must be reachable from the cloud browser; use the
same private tunnel/fixture-origin setup as the handoff journey above.

Cleanup explicitly stops the owned browser, returns its persistent human lease,
waits for a real model acknowledgement, and terminates the fixture conversation.
This requires a real configured model account. Merely terminating a conversation
does not prove that a persistent browser's human lease was returned.

The private config accepts the existing `origin`/`username`/`password` form or
`origin`/`apiKey` for the normal API-key login form. Use an isolated test owner.
An already-running browser is rejected unless every tab belongs to an explicitly
configured `allowedExistingFixtureOrigins` entry. Candidate SPA files may be
served using `--assets-dir`; authentication, session APIs, browser and model
remain real, and the receipt identifies this as candidate acceptance.

```sh
python apps/webui/tests/e2e/live_browser_view_performance.py \
  --config /private/browser-live.json \
  --output /private/evidence/window-response-001 \
  --fixture-origin http://private-fixture-host:port
```

Receipts contain rendered/distinct frame rates, frame intervals, click-to-visible
feedback, exact trusted Unicode submission, model usage and cleanup status.
Screenshots show the native Chrome window and successful human login. Raw
credentials, browser cookies and base64 frame contents are excluded. The
functional assertions always run; `--minimum-fps` adds an environment-specific
rate requirement when the deployment has a stable measured network budget.

Add `--verify-profile-persistence` to complete the isolated sign-in workflow:
stop through the real confirmation dialog, start the same profile again, verify
its login cookie reaches the fixture, then Return through the panel with a note
asking AI to inspect the current page. The expected human value is not supplied
in that note. The test handles scoped one-time browser permissions with the same
helper as the other live journeys and requires exact model readback from actual
browser tools. A proxy used for this fixture must forward its `Cookie` request
header as well as the `Set-Cookie` response header. Cleanup also overlaps metadata
reads with termination and checks that subsequent reads do not resurrect it.

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

This journey starts with a stopped browser and no previous human lease. A
persistent browser can outlive a terminated conversation, so stop and explicitly
return an owned fixture before creating the next session. Prepare fresh fixtures
through the normal owner API without opening the previous conversation during
login. The live lifecycle and file journeys share the same visible one-time
approval helper; a pending tool permission must be answered before expecting
the real model's completion.

## External human viewer

`live_browser_handoff.py --manual-human` prepares the same real model journey
and writes `manual-human-ready.json` with the authenticated viewer URL, random
expected value and handoff note. A person opens that viewer on another device,
takes control, enters the value through the panel and returns control with the
provided note. The harness performs the scoped one-time approvals in its chat,
then requires exact AI readback, one trusted submission, persistent identity and
restored conversation history. It does not type or return control for the person.

The harness requests a 1440 by 900 desktop controller viewport and records
its actual dimensions when ready. The external phone or viewer keeps its own
viewport. The shared panel helper opens a collapsed workspace through the
normal visible button before selecting Browser. On failure, the harness reconnects
to its owned Chrome to capture the actual session before stopping it.

Use `--turn-timeout 1800` while coordinating a physical iPhone/Safari journey.
Prepare a dedicated test account and share its login privately. The ready JSON
contains no password. An external desktop viewer can verify the manual harness;
that result does not count as physical iPhone or Safari acceptance.

## Browser file transfer

`live_browser_files.py` drives a real model and the shared WebUI panel. Use a
fresh conversation and a stopped managed worker with the file-transfer
capability. Release any previous human lease and recover any worker restart
through the supported human controls before running the journey.

Pending-approval reload acceptance waits for the refreshed document and the
visible conversation browser tab. The page-wide load event is not the
readiness boundary; the visible approval and completed model history remain
required after reconnection.

```sh
python apps/webui/tests/e2e/live_browser_files.py \
  --config /private/browser-live.json \
  --locale en-US \
  --fixture-origin http://worker-reachable-fixture:50181 \
  --output /private/evidence/browser-files-001
```

The AI launches headful extension Chrome and opens a native file chooser. The
user takes control and selects a generated local file through the actual
viewer file picker. The website verifies its Unicode filename, exact contents,
trusted change event and login cookie. Return to AI triggers fresh observation
and a real download; the viewer saves and verifies its exact bytes and SHA-256.
The same browser/profile identity must persist. Stale uploads return 409 and
anonymous uploads return 401. The chat must settle after both real AI turns.

The local fixture uses `/review`, `/submit` and `/receipts`; a private relay must
forward those paths and cookies. Output includes two screenshots, synthetic
receipts, identities and safe transfer/stream summaries. It closes only the
test's viewing Chrome; explicitly stop the managed browser during cleanup.

The default client uses an owned Chrome through ai-dev-browser. Add
`--client-browser firefox` to use a real Firefox viewer against the same
cloud-managed extension Chrome. Install that test client with
`python -m playwright install firefox`. Use a test account whose application
language matches `--locale`. Firefox receives its locale and viewport when its
context is created; its popup inherits the size, avoiding the headless driver's
popup resize stall observed during actual acceptance.

Add `--viewer-return --reconnect-approval` to close the original chat before
returning from the independent viewer, reopen the chat, and reload it while a
real single-use browser permission is pending. The model must complete after
the recovered visible permission is answered. The exact upload/download and
single-submit checks still apply; the evidence records both boundaries.
Use `--stop-existing` only for an owned, completed fixture. It takes control
and stops a running browser through the real panel. A retained recovery error
requires an explicit panel Start before Stop; another controller's lease is
refused. A held lease is returned with a fresh stopped-state model turn before
the file journey starts. A recovery observation warning may remain after Start;
the explicit Return clears it after observing the stopped state. The test never
clears that warning or restores AI admission directly.

Add `--verify-text-edit` with a frontend and managed worker using public SDK
v0.57.5 or later. The actual AI first fills Browser note in a separate turn and
confirms its trusted input before opening the chooser. The second turn keeps
that same page and value. After the file upload,
the human selects the page surface, clicks that field, sends Ctrl+A through
`PageSurface`, and replaces the value with exact Unicode text. Return requires
the model to report the edited value. The downloaded receipt is built from the
actual uploaded bytes and the trusted note, so its exact bytes and SHA-256
protect both changes. This flag can be combined with independent-viewer Return
and pending-approval reconnect.

The website records the value at the human's trusted pointer-down before
Ctrl+A, so the test proves an actual AI-filled value was replaced. After the
model finishes, it checks the complete persisted assistant reply and the
visible chat bubble. Stream deltas and assistant snapshots are observed
separately. Evidence includes the client engine/version, the value at human
focus, completed reply source and visible readback.

Keep the profile's download history when verifying viewport behavior. Before
page input, the live test requires at least 95% of the page image to be visible.
Its evidence records the retained download count. This protects the actual
Firefox regression where a long, unbounded download list collapsed the page
surface and intercepted trusted clicks. Download and tab lists scroll within
their own bounds so the page keeps usable space.

Add `--delay-first-page-click-ms 450` to exercise this workflow over a slow
connection. It delays one actual human click request while keeping the model,
Chrome, trusted input and file transport real. Click, SelectAll, text insertion
and Return must retain their order; the former concurrent implementation fails
this journey. `interaction-diagnostics.json` retains local focus/keyboard events
and browser input requests so a failure can be investigated without replaying it.

If the fixture origin uses a reverse proxy or tunnel, forward `/note` together
with `/review`, `/submit` and `/receipts`. `fixture-summary.json` records the
actual trusted note and upload events even when the journey fails.
