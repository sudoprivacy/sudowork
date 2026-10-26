# Authenticated full-window streaming

The shared BrowserPanel can display the current cloud Chrome window through a
read-only noVNC decoder. Page views keep the existing JPEG adapter. Desktop's
current IPC adapter also keeps JPEG viewing until it has a socket adapter.

## Ownership and input

1. A window viewer requests `window-stream` using its attached viewer ID and
   current control and target epochs. This does not take or return control.
2. WebUI returns a relative `/ws/browser/:sessionId` path. The upgrade uses the
   existing origin check, HttpOnly session cookie and exact personal task owner.
   Conversation management permission does not grant access to another user's
   Chrome profile. No privileged bearer token is exposed in the URL or renderer.
3. The server-held Moss credential opens the exact task's worker channel. Both
   proxy hops bound binary queues and revalidate authorization during traffic and
   while idle. The worker invalidates streams when their binding or epochs change.
4. x11vnc rejects raw pointer, keyboard and clipboard writes server-side. The
   React decoder is also view-only. The public `InputSurface` maps canvas and JPEG
   gestures to the same checked input API, existing input queue and task control.
5. Stop, ordinary conversation continuation and native questions coordinate work.
   Closing or refreshing a viewer preserves Chrome, cookies and the human lease.
   Notifications, reconnects and idle time never return control to AI.

The decoder is loaded only for an active streamed window. Headless sessions do
not allocate a display stream. The exact noVNC 1.5.0 dependency builds with the
existing application browser targets. Later package versions were rejected by
actual builds because of top-level-await incompatibility; application targets
were not raised. The decoder's legacy mouse capture is suppressed because the
shared PointerEvent input mapper owns gestures.

## Real component acceptance

`apps/desktop/tests/e2e/live_window_stream_surface.py` drives the actual built
React component, npm decoder, public worker and real isolated Chrome. Its signed
extension and CDP journeys verify:

- A decoded, nonempty real window before input becomes ready.
- Trusted remote clicks and text, with exact submission counts and profile cookie.
- Gesture changes, blocked disabled input and correct 150% coordinate mapping.
- Actual document reload and reconnection to the same browser and human lease.
- Exact owned browser shutdown, service cleanup and cgroup resource evidence.

The isolated fixture host uses an HttpOnly cookie. It is component acceptance,
not proof of the production WebUI/Moss routing, real model, graph or phone flow.
Separate real binary WebSocket tests check bound credentials, revoked permission,
binary-only forwarding and HTTP refusal without retries. The shared-browser CI
workflow builds and runs both Chrome component journeys in the managed image.

### Published Sudograph graph and interaction timing

Pass `--graph-html /absolute/path/to/northwind.html` to the same component
journey to inspect a frozen, actual compiled graph. It reuses the existing
authenticated fixture host and shared React component. The graph helper reads
Cytoscape state as an oracle; every pan and zoom travels through the actual
viewer, checked host API and trusted native Chrome input.

On 26 October, the installed public SDK 0.58.6 passed both CDP and signed
extension journeys with the published Northwind artifact
`0c982ecf553f00421323d6439e25d0fc4dfccae7d7cc3e66ec996e85ab9d259f`.
The graph has 19 nodes and 18 relationships. Each journey pans by 100 by 50
pixels, locates a visible Orders field, zooms around it, and reloads the viewer
while preserving graph state, browser identity and the human lease. Decoded
graph images match the source browser, and the preceding real frame is rejected
after each changed view. Image comparison calibrates the fixed display offset
once before input and uses normalized luminance correlation to tolerate raster
differences; later pan or zoom discrepancies are never realigned away.

The complete graph run took 63.69 seconds at one CPU, 1,536 MiB and 384 PIDs.
Peak PID use was 327, with no PID-limit events or OOMs. The unchanged default
surface journeys also passed after adding the optional graph path. Owned
containers, viewers and fixture services were removed after both runs.

The extension run first showed changed graph pixels after 528 ms for the
scripted drag and 203 ms for zoom. Native graph input to its first render took
6 ms and 25 ms, respectively. These are local observations, without production
network latency or an absolute performance-budget claim. The drag itself took
464 ms to dispatch; the shared input mapper buffers a drag until pointer-up.
The recorded final-image verification bound includes screenshot and measurement
overhead and must not be reported as pure transport latency. Proxy byte counters
can include other screen updates and do not alone identify a graph frame.

Source measurements capture the complete viewport and crop only the comparison
image. A prior clipped-CDP-capture experiment disturbed the visible Chrome
compositor; its passing script result was rejected during screenshot review.
This fixture does not establish current project/version bindings, authenticated
comments, source-record privacy, production routing or physical phone behavior.

Both Node proxy hops also test an unsolicited first RFB banner sent in the same
TCP write as the HTTP upgrade. Each upstream is paused synchronously on open and
resumed after both relay directions are installed. This preserves upgrade-head
frames while keeping the existing queue bounds and authorization checks.

### Live drag candidate (26 October)

SDK [PR #42](https://github.com/sudoprivacy/ai-dev-browser/pull/42) adds
capability-gated, acknowledged motion while the pointer remains pressed. The
shared Desktop/WebUI component passes the attached viewer ID and waits for the
checked input reply. JPEG views and workers without `liveDragInput` retain the
bounded gesture. Pixel transport remains read-only.

The installed candidate wheel passed 29 managed-browser/control regressions,
with one existing conditional extension-fixture skip, and 306 unit tests. The
real React/noVNC component also passed both CDP and signed-extension journeys
against the compiled Northwind graph and the original form fixture. Both graph
journeys verify the exact 100 by 50 pixel pan and matching decoded graph pixels
before pointer release, then zoom and reconnect to the same browser and lease.

For this local run, first changed graph pixels appeared after 89 ms over CDP
and 104 ms over extension. Native input to the first graph render took 6 ms and
8 ms. These observations include the local fixture and measurement path; they
are neither a production network budget nor a controlled speed comparison with
the earlier release. Full screenshot verification includes additional overhead.

The candidate also prevents X server resets between initial readiness probes
and the window manager's connection. A real X11 regression fails against the
older wheel and passes with the fix. Disconnects and Stop release held input
without granting AI control. SDK publication, the final consumer release pin,
production deployment and physical phone acceptance remain delivery gates.

A later shared-component journey reproduced a held drag whose cancellation was
blocked while an input-mode change temporarily disabled new input. The adapter
now lets that cancellation reach the ordinary checked queue; browser/profile,
generation, epochs and human-controller checks remain required. The old component
fails the actual Chrome regression. The corrected CDP and extension journeys
both acknowledge cancellation, reconnect to the same graph and pass the original
form workflow. The mode change is driven by a component fixture; it does not
establish physical-phone touch behavior. The accompanying host regression also
requires ordinary motion to stay blocked until a fresh frame arrives.

## Delivery gates

The stream remains optional and capability-gated. SDK PR #39 is merged and tagged
as v0.58.6. The GitHub and PyPI wheels have the same verified digest; all 200
installed package files and the signed extension archive match the release.
SudoWork #1294 and Moss #431 are merged. Their socket regressions preserve the
first RFB frame received with the HTTP upgrade.

The real React/noVNC component passed with both CDP and extension against the
installed public SDK. These journeys observe actual changed canvas pixels,
trusted input, reload/reconnect and the same profile and human lease.

On 25 October, a normally built Desktop using public SDK 0.58.6, scode 0.2.36 and
GPT 6 Luna passed the personal Chrome journey, native question cancellation,
selection/clipboard/composition, exact model readback and 20 distinct browser
status responses. SudoWork #1297 fixes repeated ShareOne CLI discovery during
virtualized message remounts; its regression reproduces 621 probes before the
fix and requires one afterward. The combined current-base suite passed 3,389
tests with 29 existing conditional skips before merge.

The production VM's candidate SDK 0.58.6 image passed a real upgrade from SDK
0.58.2 / Chrome 155 to Chrome 156 and extension 0.4.6 with the same profile,
cookies, signed extension ID and persisted human lease, including crash
recovery. This was an isolated fixture. The production controller and default
browser image have not changed as a result of this qualification.

The final official Desktop and WebUI builds target SudoWork commit
`329a2b332389c6485f6e6ff153998d1d6a35660e`. Both WebUI image builds passed, and
the checksum-verified AMD image was deployed on 25 October. The rollout kept the
existing PostgreSQL and gateway containers, server entry point, migrations,
environment and old immutable assets. Its public journey passed model selection
at 320/375/390px, two fresh real Luna turns, history restoration and the browser
drawer. This is Chromium touch emulation, not physical-phone browser acceptance.
The owned session was terminated and its temporary API key revoked. A second
turn reported 8,064 cached input tokens; this establishes an ordinary-chat cache
hit, not acceptance of dynamic Sudograph context refresh.

A separate source qualification used the installed production Chrome
155.0.8059.84 with CDP and an isolated profile. AI launch/prefill, the native
question, interrupt/cancellation persistence, shared viewer, Unicode clipboard,
composition and one trusted submission succeeded. Its final model readback
missed the unchanged 180-second deadline, so that complete journey remains
unaccepted. An earlier cold-runtime journey also missed its 240-second model
preparation deadline. These partial results do not replace a passing complete
Desktop journey; the existing personal-profile result remains separate.

An earlier successful build from
`324a76b0` does not contain the CLI discovery fix and is not the final promotion
candidate. Browser rollout also requires Moss's per-owner immutable image pins
so existing profiles can retain their accepted runtime during the canary.

Public authenticated WebUI/Moss streaming, a bound Sudograph review and measured
production-path interaction latency, fresh model continuity, and physical phone acceptance
remain release gates. Passing SDK or component tests does not satisfy them.
