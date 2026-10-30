# Browser and Sudograph joint acceptance

Evidence snapshot: 30 October 2026. This is the browser owner's response to
[the shared checklist](https://github.com/sudoprivacy/sudograph/blob/main/docs/review-session-events.md#browser-acceptance-to-share-with-its-owner).
The complete experience matrix remains open. Component, source application,
public deployment and physical-device results are separate acceptance gates.

## Responsibility and interaction

The browser owns session identity, viewers, input exclusion and transport.
SudoWork/Sudograph own conversation/project/revision/share bindings, comment
anchors and notification delivery. Use the existing conversation and durable
inbox. Notifications, reconnect and idle time cannot release a human input lease.
Model edits must use the authoritative source and checked edit/compile/publish
interfaces. A system prompt alone does not enforce this boundary.

AI and the user operate the same browser, profile and selected target. The model
chooses headless/headful from the task and available capabilities. A headless
page still has a viewer; a headful cloud browser additionally has a full-window
stream. The cloud runtime uses isolated persistent profiles and signed Chrome
extension integration. Desktop supports standalone Chrome/CDP and explicit
attachment to the user's existing Chrome/extension.

Human/AI coordination uses native questions, ordinary Stop and chat continuation.
There are no required business-level Take/Return buttons. Main/child tool pause
acknowledgements, operation epochs and input leases remain enforced underneath.
A user may inspect the shared panel or open its independent view. A native
Desktop Chrome window can also become a tab in that browser through Chrome's
normal UI; it does not create another model version or browser session.

## Experience matrix

| Combination                                                             | Implementation and actual evidence                                                                                                                                                                                                                                                                                                            | Remaining acceptance                                                                                                                  |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop standalone CDP, embedded panel                                  | The shared React panel passed a real GPT 6 Luna/scode 0.2.37 journey with selection/copy, trusted multiline paste/composition, one trusted submission, native question cancellation and same-conversation model readback.                                                                                                                     | Final official application package and cold first-use tool timing.                                                                    |
| Desktop standalone CDP, native Chrome window                            | SDK #51's released 0.58.16 helper and this consumer passed the actual application/GPT 6 Luna journey: a physical Windows mouse click revealed the same Chrome window within the original 10-second foreground bound. The normal cold installer produced 205 files matching the public wheel.                                                  | Final official application package. The earlier activation and first application startup failures remain recorded.                    |
| Desktop existing personal Chrome/extension                              | Explicit attachment, identity checks, input exclusion and detach have real SDK evidence. SDK #51's physical mouse component journey covers both WebSocket backends and preserves Chrome on detach.                                                                                                                                            | Final SudoWork selection/connection/native-window journey and official package.                                                       |
| WebUI cloud extension/headful, panel and independent full-window viewer | Official SudoWork #1331 assets are deployed with Moss 0.1.91 and SDK 0.58.14. The isolated public canary passed streamed pixels, lease-preserving refresh, clipboard/Chinese input, persistent login, two model completions and chat reload. The default route passed the browser checks but its observation prompt did not reach the engine. | Resolve the default-route chat delivery failure, then Windows WAN viewer interaction/latency, real graph comments and joint bindings. |
| WebUI headless page viewer and cloud CDP                                | Actual worker/component suites cover input, session lifecycle and shared page display. Headless does not start an X11/VNC service.                                                                                                                                                                                                            | Final deployed model choice, public page-view journey and application artifacts.                                                      |
| Independent native review/comment page without browser control          | Native Sudograph integration has separate authenticated review evidence; viewing/commenting this page needs no extension.                                                                                                                                                                                                                     | Joint project/revision/conversation and durable comment-delivery acceptance on the final runtime.                                     |
| Physical iPhone browser                                                 | The user's iPhone Chrome passed login, model selection and a real chat response. A 390 by 844 test viewport passed touch-pointer selection.                                                                                                                                                                                                   | Real device browser-viewer touch, keyboard, clipboard and ordinary continuation. Emulation does not qualify this row.                 |
| Cloud to local personal Chrome relay                                    | Explicitly deferred optional capability. Cloud profile sign-in is not equivalent to a device-bound local profile.                                                                                                                                                                                                                             | Separate authenticated relay design and acceptance when this capability is scheduled.                                                 |

## Shared checklist

| Requirement                   | Current status                                                | Actual evidence and next gate                                                                                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Independent review window     | Source Desktop native presentation passed; final package open | Cloud viewer refresh retains the same browser and human lease. A physical click in the built Desktop application passed the native foreground and same-session model journey with public SDK 0.58.16.                              |
| Precise text and comments     | Browser selection supported; actual graph joint journey open  | Public form selection and exact clipboard content passed. Use the actual Northwind viewer to comment on exact text and recover its anchor after zoom, field expansion and language changes.                                        |
| Clipboard and Chinese input   | Browser journeys passed; OS/device coverage open              | Trusted Unicode paste/composition and a single submission passed. These results do not establish the physical iPhone keyboard or every desktop OS IME.                                                                             |
| Human and AI collaboration    | Native conversation flow supported                            | Ordinary Stop and chat continuation passed with real model readback. Reload, notifications and inactivity never authorize AI input.                                                                                                |
| Real interaction latency      | Full graph content gate passed; WAN interactions open         | Signed cloud Chrome loaded all 19 Northwind nodes and 18 edges in 10,092 ms within the unchanged 30-second content bound. Public viewer drag, zoom, selection and comment feedback need page/render, transport and network timing. |
| Device and transport coverage | Explicit matrix above                                         | A successful SDK or VM reviewer fixture does not qualify the final application package, Windows WAN surface or physical phone.                                                                                                     |

## Release and production evidence

- [SDK #49](https://github.com/sudoprivacy/ai-dev-browser/pull/49) released
  `0.58.14`. Its public wheel and signed extension assets matched the tested
  source. Installed Windows passed 35 cases with 14 existing skips; managed
  Linux passed 20 with two existing fixture skips. Profile upgrade/crash checks
  retained cookies, identity, input exclusion and the first frame command.
- [Moss #470](https://github.com/sudoprivacy/moss/pull/470) and
  [Ladder #133](https://github.com/sudoprivacy/ladder/pull/133) merged that public
  package. The coupled production cutover deployed official Moss `0.1.91` and
  the qualified Chrome/SDK `0.58.14` worker. Existing database rows, configuration
  and persistent browser profile were preserved. The separately pinned native
  execution runtime remains `0.1.85`; this is not an upgrade of every component
  to `0.1.91`. The public form/profile/model journey passed after the cutover.
- [SudoWork #1331](https://github.com/sudoprivacy/sudowork/pull/1331) integrates
  the public SDK and input completion barrier. Exact rebased source passed all
  applicable CI and the local canonical suite (3,629 passed, 30 existing skips).
  Its official WebUI image is deployed. Canary profile and chat journeys passed;
  default-route model observation exposed an unsent-message failure that remains
  open. Native presentation and final Desktop packaging are independent gates.
- [ShareOne #324](https://github.com/sudoprivacy/shareone/pull/324) deployed early
  document loading. A real cloud signed Chrome then passed the complete
  Northwind content gate. The earlier 30-second content failure is retained;
  records were not removed, generated HTML was not edited and the deadline was
  not extended. This does not establish public viewer interaction latency.
- [SDK #51](https://github.com/sudoprivacy/ai-dev-browser/pull/51) adds checked
  Windows native presentation and released `0.58.16`. All ten CI jobs passed;
  GitHub/PyPI artifacts match the tested source. The built SudoWork consumer
  passed the original real-model/physical-mouse journey with its normal cold
  installer, exact public wheel, native question, clipboard, Chinese input and
  ordinary Stop/chat continuation. Its canonical suite passed 3,636 tests with
  28 existing skips. Temporary model credentials and owned services were cleaned.

## Remaining joint journey

1. Deliver and accept the official Desktop application package. Retain the
   earlier cold runtime tool-budget and first application startup failures for
   diagnosis. Fix the public default-route chat delivery race and repeat the
   original browser/profile/model journey without extending its deadline.
2. Open the actual Northwind share through the public WebUI and independent
   viewer. Record the first usable pixels and actual held drag, zoom and text
   selection. Preserve the distinction between content readiness, stream setup
   and interaction latency.
3. Sign in through the ordinary ShareOne UI, add a uniquely identified test
   comment to exact graph text, and recover that anchor after view changes.
   Keep graph/model facts and existing comments intact.
4. Compare the visible project, view, revision and conversation with the agent's
   checked context. Deliver the comment once through the existing session inbox,
   retaining input exclusion. Continue through ordinary conversation.
5. Run the deployed browser journey on the physical iPhone when the server-side
   flow is ready. Keep real touch/keyboard evidence separate from emulation.

Host context refresh remains in
[SudoWork #1326](https://github.com/sudoprivacy/sudowork/pull/1326) and
[Sudo Code #1106](https://github.com/sudoprivacy/sudocode/pull/1106). Release/pin
and execution-time context capability are gates. New database tables and local
provider tests do not establish production bindings or durable comment delivery.
The wider session design remains in [the browser design](sudowork-browser-sessions.md)
and shared surface evidence in [window stream acceptance](browser-window-stream-acceptance.md).
