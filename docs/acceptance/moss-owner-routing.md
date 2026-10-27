# Moss owner routing acceptance

## Failure and behavior

Moss returns a `moss_route` query parameter when its load balancer must route a
session WebSocket to its live owner. SudoWork rejected all query parameters, so
the normal WebUI send reached the coordinator but failed before the upstream
socket opened. The browser received `UPSTREAM_FAILED`; the server logged
`ws_url must not carry query credentials`.

The shared client now preserves one nonempty `moss_route` hint. Authentication
continues through the Authorization header. It rejects query credentials,
unknown or duplicate parameters, a different host or session, URL credentials,
fragments, and a TLS downgrade.

## Regression protection

- Contract tests reproduce the legitimate routed URL rejection before the fix
  and cover the accepted URL and rejected alternatives.
- The real PostgreSQL/WebSocket integration test completes a routed turn,
  checks the original session path and hint, verifies header authentication,
  and checks that exactly one user message reaches the upstream.
- Each integration module owns a unique scratch database. The conversation
  fixture waits for the current takeover turn to finish and closes its owned
  sockets before closing the database.

## Live acceptance

`apps/webui/tests/e2e/live_moss_owner_routing.ts` accepts a JSON object on stdin
containing `baseUrl` and an operator-owned `accessToken`. Run it with Bun from
the repository root. It creates its own co-host session and terminates that
session in cleanup. Use a temporary scoped credential and revoke it afterward.
The script never reads credentials from the repository.

On 2026-10-27, this actual shared-client producer passed against the production
Moss API: two real model turns, a disconnected/resumed WebSocket, the preserved
routing hint, and exact context recall. Its fresh session was terminated and
its temporary key and login tokens were revoked or logged out.

This result qualifies the shared-client protocol fix. The deployed WebUI must
still pass the normal browser conversation and browser continuation workflow
after its release; this client test does not replace that UI acceptance.
