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
as v0.58.6; this candidate pins that version and its matching source commit.
Public package and release-artifact verification must pass before rollout. Public authenticated
WebUI/Moss streaming, a real Sudograph review and measured interaction latency,
fresh model continuity, and physical phone acceptance remain release gates.
Passing SDK or component tests does not satisfy these gates.
