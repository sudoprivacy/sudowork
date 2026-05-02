# Open Items

Architectural decisions that are agreed and documented but not yet implemented.
Each entry is a single anchor — code that depends on the future implementation
should leave a `// OPEN-ITEM(<anchor>)` comment so grep brings them up alongside
this list.

The `tests/openItems.test.ts` sentinel runs as part of the suite and fails
until this file is empty. Resolve an item by removing it from the list (and the
matching `// OPEN-ITEM(...)` comments). Once the list is empty, delete the
sentinel test and this file.

---

## dt-link

`DT_LINK` kernel primitive — VFS-internal symlink. Landed in
`nexi-lab/nexus#3922`:

- New entry type (`DT_LINK = 6`), `FileMetadata.link_target` field
  across proto / Rust / Python contracts.
- `DCache::resolve_link` one-hop resolver with `LinkResolveError`
  (Chained / SelfLoop / MissingTarget) variants.
- `sys_setattr` accepts `link_target` and rejects self-loops at write
  time.
- `sys_stat` surfaces `link_target` (Linux `lstat` analogue).
- `route()` / `sys_read` / `sys_write` / `sys_copy` follow the link
  transparently for content-touching syscalls.

Owner: nexus repo. Closed.

## mailbox-stamping-hook

`MailboxStampingHook` — registered `NativeInterceptHook` that rewrites
the envelope's `from` field on `*/chat-with-me` writes to the caller's
authenticated `agent_id` so LLMs cannot forge identity. Hook struct +
rewrite policy live together at `rust/kernel/src/managed_agent/`
(`mailbox_stamping_hook.rs` for the dispatch wiring,
`mailbox_stamping_policy.rs` for the envelope schema / identity
guarantee). Both are owned by `ManagedAgentService` since the
chat-with-me surface is a managed-agent concern, not a generic
agent-table concern.

The trait was widened in the same PR to support content rewriting
(`HookOutcome::Replace(bytes)`). A double bypass (no mutating hooks
registered, or write path doesn't match any registered suffix) keeps
the hot path allocation-free.

Landed in `nexi-lab/nexus#3922`. Owner: nexus repo.

## workspace-boundary-hook

`WorkspaceBoundaryHook` — INTERCEPT pre-write hook scoped to
`/proc/{pid}/workspace/`. Compares caller `agent_id` to the workspace
owner derived from path; on mismatch returns `Err(EPERM)` with the
structured teaching payload (see design doc §3.4). Implementation +
boot-time registration into `Kernel::register_native_hook` both landed
in `nexi-lab/nexus#3922`.

Owner: nexus repo. Closed.

## managed-agent-grpc-service

`ManagedAgentService` — narrow surface (`start_session_v1`,
`cancel_v1`, `get_session_v1`) reachable through
`NexusVFSService.Call` Rust dispatch. Prompt + event flow uses the
existing chat-with-me VFS surface, not duplicate RPCs.

Landed:
- Service struct + lifecycle in `rust/kernel/src/managed_agent/`,
  registered into `ServiceRegistry` at boot. State writes go to
  `services::agent_table::AgentTable` directly (no Python hop).
- gRPC `Call` handler resolves Rust services first
  (`Kernel::dispatch_rust_call`) and falls back to Python @rpc_expose
  on miss. Both dotted (`managed_agent.start_session_v1`) and flat
  (`managed_agent_start_session_v1`) method names are accepted.
- `AcpService` follows the same dispatch pattern (`acp_call`,
  `acp_kill`, …); the Python `services.acp` package + `AcpRPCService`
  + `agent_runtime` are gone, replaced by `AcpAdapter` (~50 LOC) +
  `nx_acp_dispatch` PyO3 hook for in-process callers.

Remaining:
- managed-agent runtime Rust crate that drives the LLM loop after
  `start_session_v1` returns. Registers against the service's runtime
  slot at module init.
- Workspace materialization at `start_session`: building
  `/proc/{pid}/workspace/` with the requested repos visible inside,
  plus the DT_LINK shortcut at `/proc/{pid}/workspace/chat-with-me`.
  Reaping on `cancel_session` / kill.
- TypeScript gRPC client in this repo + wire-up from the renderer.
- Permission-lease revocation through `nx_acp_register_on_terminate`
  is wired but the cross-PR with the lease table is still WIP — keep
  an eye on regressions if `_perm_lease_table.invalidate_agent`
  changes signature.

Owner: split — managed-agent runtime crate; nexus repo for workspace
setup; this repo for TS client. Blocks: sudowork ↔ managed-agent
integration.

## sudocode-config-migration

sudo-code currently writes user-global settings to `~/.nexus/sudocode/settings.toml`
on the host filesystem. Migrate to `/agents/{name}/config.toml` inside nexus VFS
so configuration sits under the same SSOT as the rest of agent identity.

Owner: sudo-code repo. Blocks: full SSOT for agent identity surface.

## auth-fallback

When the `ManagedAgentService` gRPC client lands in this repo (see
`managed-agent-grpc-service`), the assumption that nexus runs with
`--auth-type none` (sudowork profile default) needs to be guarded. The
client should try unauthenticated first and fall back to a bearer token
from a sudowork-side credential store on `Unauthenticated`.

Pre-revert this file used to point at `src/common/nexus/agentRegistry.ts`,
which was the HTTP client for the wrong-direction ACP integration. That
file was removed in the revert; the auth fallback is a guardrail for
the future gRPC client.

Owner: this repo. Blocks: hardening sudowork against multi-tenant
deployment. Cannot start until `managed-agent-grpc-service` lands the
client surface to attach the fallback to.

## password-not-in-cluster-profile

`pwd_login` / password-related bricks must stay OUT of nexus's `CLUSTER` profile
(`src/nexus/contracts/deployment_profile.py: _CLUSTER_BRICKS`). The cluster
profile is what sudowork ships, and the password integration phasing is being
decided separately on the password-agent track (see memory:
`feedback_browser_ai_vs_zhoujinjing.md` and `project_password_agent_integration.md`).
Future commits adding nexus-side gRPC service impl or audit-node setup must
not pull this in.

Owner: nexus repo (deployment_profile.py). Blocks: nothing today; this is a
guardrail entry, not a TODO. Remove only when password integration is ready
to ship inside cluster profile.
