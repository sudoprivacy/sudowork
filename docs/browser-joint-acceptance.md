# Browser and Sudograph joint acceptance

Evidence snapshot: 29 October 2026. This records the browser owner's response to
[the shared checklist](https://github.com/sudoprivacy/sudograph/blob/main/docs/review-session-events.md#browser-acceptance-to-share-with-its-owner).
Passing a transport or component fixture does not establish the corresponding
production, real graph, authenticated comment or device journey.

## Responsibility

The browser owns session identity, viewers, input exclusion and transport.
SudoWork/Sudograph own conversation/project/revision/share bindings, comment
anchors and notification delivery. Use the existing conversation, checked tool
interfaces and durable inbox; a browser notification cannot release a human
input lease. Semantic edits must use the authoritative model source and its
checked edit/compile/publish path.

## Checklist

| Requirement                   | Status                                                           | Actual evidence and remaining acceptance                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Independent review window     | Supported; final release acceptance pending                      | Source Desktop can reveal the existing local Chrome target. WebUI opens the authenticated viewer for the same cloud browser. Earlier public WebUI form/profile/model journeys preserved the browser and input lease across refresh. Verify the final application package and current production route with the actual graph.                                                                                                                                                      |
| Precise text and comments     | Needs adaptation and joint acceptance                            | Real viewer fixtures select exact text and copy it. The actual Northwind page exposed cross-origin command gaps, now covered by SDK frame regressions. Native Sudograph integration has separate authenticated comment evidence. WebUI must still create a real comment and recover its target after zoom, field expansion and language changes.                                                                                                                                  |
| Clipboard and Chinese input   | Supported browser paths; device acceptance pending               | Real shared Desktop and public WebUI journeys passed Unicode input, exact clipboard content, one trusted submission and Chromium composition. Touch-pointer selection passed in a 390 by 844 reviewer viewport. These do not establish OS IME or physical iPhone keyboard, clipboard and TouchEvent behavior.                                                                                                                                                                     |
| Human and AI collaboration    | Supported; final application acceptance pending                  | Native questions, ordinary Stop and chat continuation coordinate the task. Main/child tool barriers and checked control/target epochs retain exclusion. Reload, reconnect, notifications and idle time never grant AI input. No business-level Take/Return buttons are part of the UX.                                                                                                                                                                                            |
| Real interaction latency      | Needs joint acceptance; public cold load currently fails         | Earlier actual graph component runs observed changed pixels during held drags over CDP and signed extension. Those local results exclude WAN latency. The public graph's 6,865,571-byte gzip response still failed the unchanged thirty-second content budget in a fresh VM read. Public drag, zoom, selection and comment feedback need separate page/render, transfer and network observations.                                                                                 |
| Device and transport coverage | Supported combinations recorded; remaining combinations explicit | Desktop standalone CDP and existing-Chrome extension have real SDK/host and source-application evidence. Cloud CDP/headless and signed extension/headful have real worker/component evidence. Public WebUI profile/model acceptance used the cloud extension. A native review/comment page needs no extension when no browser control is requested. Physical iPhone/Safari browser input remains unaccepted; cloud-to-local personal Chrome relay is a later optional capability. |

## Evidence boundaries

- [Shared window and page surfaces](browser-window-stream-acceptance.md) records
  the actual React, noVNC, public SDK, graph and earlier public WebUI journeys.
- [SudoWork #1323](https://github.com/sudoprivacy/sudowork/pull/1323) merged live
  page drag integration and public SDK 0.58.11 qualification. The audited
  0.2.40 release candidate predates this change; merging it did not update
  installed applications or the production WebUI.
- [SDK #47](https://github.com/sudoprivacy/ai-dev-browser/pull/47) covers selected-tab
  child frames, controlled MCP selectors, large DOM messages and provisional
  child metadata. The local Windows CI-equivalent run passed 35 tests with 14
  existing platform/environment skips, including all nine startup cases. Its
  failed earlier run is retained separately. SDK merge/publication and exact
  public artifact qualification are release gates.
  The integrated recovery base passed 317 unit/real-browser checks with two
  signed-fixture environment skips and the full Windows viewer command again
  passed 35 cases with 14 existing skips. Public SDK 0.58.12 contains recovery
  changes from SDK #45, without the frame changes; this consumer update targets
  the subsequent release and must remain unpublished until it is qualified.
  The integrated installed candidate also passed 20 Linux signed Chrome cases
  with two existing fixture skips. Its 204 installed files and signed extension
  assets matched the wheel; the graceful-upgrade and forced-crash checks retained
  cookies, extension identity, input exclusion and the first frame MCP result.
- [Moss #467](https://github.com/sudoprivacy/moss/pull/467) merged actual signed
  persistent-profile upgrade/crash recovery checks. Candidate image acceptance
  retained cookies, extension identity, exclusive ownership and the first frame
  command. This does not establish the new production model/tool-discovery path.
- [SudoWork #1304](https://github.com/sudoprivacy/sudowork/pull/1304) supplies native
  Sudograph integration evidence. Do not reuse it as proof of cloud bindings,
  durable comment delivery or anchors in the remote viewer.

Host context refresh is separately in progress in
[SudoWork #1326](https://github.com/sudoprivacy/sudowork/pull/1326) and
[Sudo Code #1106](https://github.com/sudoprivacy/sudocode/pull/1106). The product
runtime pin and execution-time context capability are explicit release gates;
local deterministic provider tests are not real production comment delivery.
Profile occupancy work in SudoWork #1325/Moss #464 is also independent: an
explicit move between conversations does not add business-level human/AI handoff
buttons or make idle time an authorization signal.

## Remaining joint journey

1. Qualify the exact public SDK and consumer artifacts; promote the managed
   browser and application through their normal deployment paths. Preserve
   persistent profiles and any running co-host execution during maintenance.
2. Open the actual Northwind share through the public WebUI and its independent
   viewer. Establish content readiness within the original bound, then observe
   pan, zoom and text selection through the viewer rather than direct page JS.
3. Sign in through the ordinary ShareOne UI, add a uniquely identified test
   comment to exact graph text, and recover that same anchor after view changes.
   Keep graph/model facts and existing comments intact.
4. Verify the displayed project, view, source revision and conversation against
   the agent's checked context. Deliver the comment to that conversation once,
   using the existing inbox; retain human input exclusion while it is handled.
5. Continue through the ordinary conversation. Run the same deployed flow on the
   physical iPhone when the server-side journey is ready, keeping touch/keyboard
   evidence distinct from browser emulation.

The complete experience matrix remains open until these gates have evidence.

## Cold-content diagnosis

The same public `/file` API returned a 6,865,571-byte gzip representation. A fresh
local read completed in 3.792 seconds; the VM received 2,106,880 bytes before the
unchanged 30-second budget expired. No routing or access settings changed. This
locates a cloud-path delivery problem; it does not establish the particular
network hop or replace real viewer latency measurements.

Most of the exported graph payload belongs to the complete source snapshot,
including its encoded record segments and dictionary. Removing records, editing
generated HTML or relaxing readiness would invalidate this acceptance. Content
delivery and graph interaction remain separate open gates.
