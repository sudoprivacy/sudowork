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
unresolved; switching back restored the passage. Cross-language passage recovery
requires further adapter work.

Public graph startup still failed its existing 30-second gate. The candidate's
real browser recorded 6,886,564 transferred bytes and 214,727 ms for the ShareOne
document download. Startup and graph feedback must remain separate acceptance
results. This transport patch is still subject to full regression, official
publication and verification of the deployed artifact.
