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

Both Node proxy hops also test an unsolicited first RFB banner sent in the same
TCP write as the HTTP upgrade. Each upstream is paused synchronously on open and
resumed after both relay directions are installed. This preserves upgrade-head
frames while keeping the existing queue bounds and authorization checks.

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

Public authenticated WebUI/Moss streaming, a real Sudograph review and measured
interaction latency, fresh model continuity, and physical phone acceptance
remain release gates. Passing SDK or component tests does not satisfy them.
