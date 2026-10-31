# Browser and Sudograph joint acceptance

Evidence snapshot: 31 October 2026. This is the browser owner's response to
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

| Combination                                                             | Implementation and actual evidence                                                                                                                                                                                                                                  | Remaining acceptance                                                                           |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Desktop standalone CDP, embedded panel                                  | Real Luna/scode 0.2.37 with Electron 42.11.18 and the normal cold SDK 0.58.16 installer passed selection/copy, trusted multiline paste/composition, one submission, native question cancellation and exact model readback.                                          | Official application package and stable release.                                               |
| Desktop standalone CDP, native Chrome window                            | A physical Windows mouse click revealed the same Chrome within the original 10-second foreground bound. Ordinary taskbar selection handles window occlusion without test-only background-throttling switches. All 205 installed SDK files matched the public wheel. | Final official application package. Earlier failed startup/input receipts remain preserved.    |
| Desktop existing personal Chrome/extension                              | The built Electron 42.11.18 application passed actual existing-Chrome connection, native question/Stop, physical native-window selection, clipboard/composition, exact model readback and disconnect. Chrome and cookies survived application shutdown.             | Final official package and stable release.                                                     |
| Desktop connected to a cloud browser                                    | Shared React panel and remote host contract; a dedicated real cloud application journey exists.                                                                                                                                                                     | Repeat against the final application and production runtime, retaining the same owner/session. |
| WebUI cloud extension/headful, panel and independent full-window viewer | Official source 219ba880, Moss 0.1.92 and worker SDK 0.58.14 passed the public canary and default route: stream refresh, human lease, Chinese clipboard/composition, persistent login, two model turns and chat reload.                                             | Final Windows-client graph latency and project/view/revision/comment-delivery binding.         |
| WebUI headless page viewer and cloud CDP                                | Real worker/host suites cover input, lifecycle and page display; shared UI regressions cover mode selection before explicit Start.                                                                                                                                  | Final deployed real-model and public page-view journeys for these modes.                       |
| Independent native review/comment page without browser control          | Native Sudograph authenticated review has separate evidence and needs no extension for ordinary viewing/commenting.                                                                                                                                                 | Joint project/revision/conversation and durable delivery on the final runtime.                 |
| Physical iPhone browser                                                 | User's iPhone Chrome passed login, model choice and real chat. Emulated 390 by 844 pointer input also passed.                                                                                                                                                       | Physical viewer touch, keyboard/IME, clipboard and ordinary continuation.                      |
| Cloud to local personal Chrome relay                                    | Explicitly deferred optional capability. Cloud sign-in does not replace device-bound local profile credentials.                                                                                                                                                     | Separate authenticated relay design and acceptance when scheduled.                             |

## Shared checklist

| Requirement                   | Current status                                                             | Actual evidence and next gate                                                                                                                                                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Independent review window     | Source Desktop standalone/personal presentation passed; final package open | Cloud viewer refresh retains the same browser and human lease. Physical clicks in the built Desktop application passed native foreground and same-session model journeys with public SDK 0.58.16; existing Chrome survived disconnect and application shutdown. |
| Precise text and comments     | Source-field graph comment/recovery passed; joint bindings open            | Public form selection and exact clipboard content passed. Actual Northwind ProductSales source-field comment/recovery passed across language changes, expansion and reload; its temporary Chinese comment was removed and all original threads preserved.       |
| Clipboard and Chinese input   | Browser journeys passed; OS/device coverage open                           | Trusted Unicode paste/composition and a single submission passed. These results do not establish the physical iPhone keyboard or every desktop OS IME.                                                                                                          |
| Human and AI collaboration    | Native conversation flow supported                                         | Ordinary Stop and chat continuation passed with real model readback. Reload, notifications and inactivity never authorize AI input.                                                                                                                             |
| Real interaction latency      | Controlled graph feedback improved; production WAN samples open            | Controlled same-graph zoom improved from 2567 to 193 ms, selection from 2953 to 877 ms and held pan from 2188 to 566-816 ms. The official relay is deployed. Repeated startup and final Windows-client production samples remain open.                          |
| Device and transport coverage | Explicit matrix above                                                      | A successful SDK or VM reviewer fixture does not qualify the final application package, Windows WAN surface or physical phone.                                                                                                                                  |

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
  default-route model observation exposed an unsent-message failure. The later
  #1341/#1344 production journeys below passed; the earlier receipt is retained.
  Native presentation and final Desktop packaging are independent gates.
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

1. Complete the final Desktop runtime/native-shutdown update and verify the
   official application package. The built personal-Chrome application passed
   disconnect and shutdown after fixing clipped source-settings controls. Preserve earlier cold-start and first-use
   installation failures with their actual cause and coverage limits.
2. Repeat actual Northwind gestures through the default production Windows
   viewer. Keep content readiness, stream setup, page handling and first changed
   pixels distinct. The controlled comparison is not a production percentile.
3. Retain source-field comment recovery across language changes and reload.
   Expand joint acceptance to view/zoom changes on the final publication without
   altering existing comments or model facts.
4. Compare the user's project, view, revision and conversation with the agent's
   authorized context. Deliver a real comment exactly once to the existing inbox,
   preserving input exclusion and provider prefix caching. Continue through
   ordinary conversation.
5. Exercise headless page view, cloud CDP and the Desktop cloud connection on
   final application artifacts, then complete physical iPhone viewer input.
   Emulated touch and the user's earlier basic chat receipt remain separate.

Host context refresh remains in
[SudoWork #1326](https://github.com/sudoprivacy/sudowork/pull/1326) and
[Sudo Code #1106](https://github.com/sudoprivacy/sudocode/pull/1106). Release/pin
and execution-time context capability are gates. New database tables and local
provider tests do not establish production bindings or durable comment delivery.
The wider session design remains in [the browser design](sudowork-browser-sessions.md)
and shared surface evidence in [window stream acceptance](browser-window-stream-acceptance.md).

## 31 October production and graph update

Moss 0.1.92 and official SudoWork #1341 fixed passive profile ownership and
windowed mode selection before Start. Both the public canary and default route
passed their complete profile/window/clipboard/Chinese-input/model journey.
SudoWork #1344 subsequently passed the merge queue and official image publisher,
then the same real canary and default-route acceptance. Production now runs
source `219ba88022f23f2a9f72c357f15a95e50f6f88a1`; private backup validation,
environment/mount preservation and exact canary/database cleanup all passed.
The earlier unsent-message failures remain historical receipts.

Sudograph #21 and publication #22 pinned the original Northwind share to
`6fad925f93b09f9c9b28fe673a32fd7d9ea6d732`. The real signed-cloud-Chrome viewer
posted a uniquely identified Chinese comment on ProductSales and recovered the
same source field after language switching, expansion and reload. Its selector
and quote stayed unchanged. The comment was deleted; all 48 original threads
were byte-equivalent before and after promotion. Source-field names now use a
language-independent passage. Translated captions retain strict language and
version checks; unrelated or changed text is not silently reattached.

The controlled graph-feedback samples and their limits are in
[the stream report](browser-stream-authorization.md). A later original-page
startup completed in 5,777 ms, but repeated startup reliability is still open.
Final Windows-client production measurements remain separate from the managed
VM reviewer fixture.

Execution-time context remains a release dependency. Engine #1106 currently
replaces the appended system prompt when a model snapshot changes, before the
retained history. That needs a reusable-prefix check against the agreed
conversation-tail update contract and real provider cache-usage acceptance
before the host adapter is promoted. No provider cost or hit-rate result is
claimed from the source review.
