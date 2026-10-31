# Browser stream authorization and graph feedback

## Transport

The authenticated WebUI relay carries an RFB byte stream. A single screen update
can arrive as many small WebSocket messages. Previously, forwarding each message
waited for a separate cookie, owner and session authorization query. A burst of
rectangles accumulated these serial round trips before noVNC could display it.

The relay now collects the bytes already queued when a fresh authorization
finishes and sends them together, in order. Each following batch receives a new
authorization. The queue includes in-flight data in its limits of 64 messages
and 16 MiB. Revocation closes both sockets before the next batch is forwarded.

The real TCP WebSocket regressions in
`apps/webui/tests/unit/server/browserStream.test.ts` cover a queued burst, logout,
owner checks, the first RFB banner, upstream refusal, and both queue limits.
The burst test gates authorization explicitly, so its result does not depend on
an artificial sleep or a machine-speed threshold. The WebUI CI runs these tests.

## Actual public graph comparison, 2026-10-31

The reviewer used the production HTTPS WebUI, the same managed Chrome profile,
a 1280 by 900 native window, and the published
[Northwind graph](https://shareone.vip/s/sudograph-northwind). The baseline was
WebUI source `6bea303b`; an isolated deployment added the compiled relay patch
to that exact image. The public graph remained pinned to Sudograph source
`9d8f14425a4591610144af0be3cc917eb7236763`.

| Gesture                                           | Baseline first visible feedback | Candidate first visible feedback |
| ------------------------------------------------- | ------------------------------: | -------------------------------: |
| Zoom into the source fields                       |                        2,567 ms |                           193 ms |
| Select `ProductSales` and open its target comment |                        2,953 ms |                           877 ms |
| Pan the expanded English graph, 49 nodes          |                        2,188 ms |            816, 566, 623, 626 ms |

These are small samples of changed graph pixels at the reviewer, including
input dispatch, page work and return transport. The drag includes a 200 ms
held press. They establish neither a network-only duration nor a production
percentile. Native window frames confirmed the completed zoom and the exact
`ProductSales` target dialog. A sample taken while the loading animation was
visible was excluded and retained as an invalid measurement.

The ordinary ShareOne login survived a browser restart. On the baseline, a real
comment with Chinese text was submitted through the viewer, read through the
ShareOne skill, and revealed at its original field after zoom, expansion and
reload. The test comment was deleted; the original 48 threads were preserved.
Switching language retained the object, while its versioned text selector became
unresolved; switching back restored the passage. Those measurements used the earlier passage implementation; the subsequent
source-field publication is described below.

Public graph startup still failed its existing 30-second gate. The candidate's
real browser recorded 6,886,564 transferred bytes and 214,727 ms for the ShareOne
document download. Startup and graph feedback must remain separate acceptance
results. The controlled comparison preceded the official promotion described below.

## Official production deployment

SudoWork #1344 merged as
`219ba88022f23f2a9f72c357f15a95e50f6f88a1` after the merge queue's full checks.
The official WebUI image is
`sha256:92044075cd6bed57645648b0508e246c5f10e4863bd09df8a1735fec239f6d9a`;
its compiled relay SHA-256 is
`ed96e0ef20e4bba0cf84c1a55e9b701a22716c660ad6478334d2afbc4365056b`.
Both architectures published successfully. The isolated public canary and the
default production route passed the complete window/profile/clipboard/Chinese
input and real-model continuation journey. The cutover preserved the database,
environment, mounts and gateway. Its private database backup was validated
before replacement; the canary and its database were removed afterward.

The subsequent Sudograph source-field passage fix is separately published as
`6fad925f93b09f9c9b28fe673a32fd7d9ea6d732`. Exact source names now recover across
language changes and reload on the original public graph. The real fixture
comment was deleted without rewriting any of its 48 original threads.

The earlier download and latency samples above remain historical measurements.
One later graph startup completed in 5,777 ms; repeated 30-second startup failures
still require diagnosis. The production functional pass does not establish a
latency percentile or close the Windows-client gesture benchmark.

## Default production Windows viewer, 31 October

A Windows Chrome reviewer subsequently operated the default production route,
the same persistent profile and the original Northwind share at source
`6fad925f93b09f9c9b28fe673a32fd7d9ea6d732`. The actual full-window stream showed
zoom feedback after 437 ms for a single-notch-sized gesture. Three held pans
showed first changed graph pixels after 563, 629 and 561 ms. Native window
frames confirmed completed camera movement. The mouse was positioned before
measurement; loading animation was absent. These small samples include the
200 ms held press, dispatch, page handling and return transport.

The original 30-second content gate failed again. A real read-only model
diagnosis recorded 81,988.5 ms and 6,868,626 transferred bytes for the ShareOne
document, while its shell JavaScript and CSS completed in about 20 and 12 ms.
The later successful interactions do not convert that startup failure to a pass.
The subsequent timing diagnosis is below.

Another drag from a different starting point produced no changed graph pixels
within its original five-second observation bound. That receipt is retained as
an unresolved interaction, separate from the successful pan samples. The run
posted no comments and changed no model facts. All five cleanup checks passed:
browser stopped, fixture conversation removed, local reviewer closed, temporary
key revoked and operator logged out. Startup reliability, the unresolved drag
and physical-device input keep the full experience matrix open.

### Document transfer diagnosis

A separate fresh production session retained the same 30-second content failure.
The real model read the already-loaded tab's Resource Timing entries without
navigating, refetching or changing Chrome's connection settings. The exact
versioned graph document recorded:

| Phase or size                  | Actual observation |
| ------------------------------ | -----------------: |
| Request to first response byte |           842.4 ms |
| Response body transfer         |        52,284.2 ms |
| Encoded body                   |    6,868,326 bytes |
| Decoded body                   |   12,006,223 bytes |

The shell assets were cached and completed in about 17 and 8 ms. In this sample,
body transfer dominates the load rather than time to first byte. It does not
establish the bottleneck for every route or imply the browser relay is fixed.
The generated public artifact contains about 8.49 MB of source-schema JSON,
including 30 snapshots and 3,481 encoded segments. This is a payload diagnosis,
not permission to remove schema data or alter generated HTML by hand. Comments,
model facts and the publication were unchanged; all five cleanup checks passed.
