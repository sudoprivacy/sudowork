# Sudowork to Moss cloud chat validation

Validated2026-09-28 against latest dev in separate worktrees. Runtime: macOS host, scode0.2.11, claude-sonnet-4-6, simulated SMS. Billing and recharge are excluded.

## Changes

- Use current-account tenant/hub directories for agent lists, categories and stable-ID details; refresh catalogs after synchronization.
- Preserve structured startup errors and avoid duplicate bootstrap notifications. Discard rejected RemoteAgent initialization so configuration repairs can be retried in the same task.
- Consume version1 Moss artifact events in both live and historical conversations. Only validated generated finals become delivery cards; cloud card preview/download uses the authorized session API, with original image and binary bytes.
- Stop requiring body intent markers. `.drafts/` wins; JSON/CSV contents remain format-safe. Remove workspace-wide cleanup and preserve drafts on cancellation and cross-turn dependencies. Local execution retains its existing tracker; the new durable manifest is owned by Moss's host runtime.

## Verification

- `bun run test`:2635 passed,10 existing skips;252 passed test files,4 skipped. Two unrelated ontology DOM timeouts under concurrent build/test load passed in an isolated rerun and the full rerun.
- Desktop and renderer `bunx tsc --noEmit` passed. Changed TS/TSX ESLint passed (existing warnings only).
- Production Electron build passed with `NODE_OPTIONS=--max-old-space-size=8192`.
- Real desktop: three independent application-role/business-skill sessions, streaming responses, cross-turn107.50 quote, reopening history, file cards, native attachment upload, Chinese/space file names, valid final JSON/CSV/PNG, and byte-identical downloads.
- Uploaded temp_data.json preserved; explicitly requested generated temp_data.json delivered as final. Temporary Python script preserved its shebang. Drafts stayed recoverable after actual cancellation; next turn read resume=43 and released a legacy draft with collision-safe archival.
- Disabled skill produced one error per attempt; repaired configuration retried successfully in the same task on the final build. Account-switch catalog isolation is covered by the directory/IPC regression; current-account exclusive/my-agent/creation catalog is checked in the UI. Cross-organization artifact/startup API requests returned403.

The runtime artifact manifest is host-backend specific. Docker/Kubernetes and every model family are outside this E2E evidence. No historical user files were rewritten.
