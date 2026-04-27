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

DT_LINK kernel primitive — VFS-internal symlink. Two phases:

- **Phase 1 (landed in nexi-lab/nexus#3922)**: entry type (`DT_LINK = 6`),
  `FileMetadata.link_target` field across proto / Rust / Python contracts,
  `DCache::resolve_link` one-hop resolver with `LinkResolveError`
  (Chained / SelfLoop / MissingTarget) variants, unit tests.
- **Phase 2 (pending)**: `route()` integration so every `sys_*` resolves
  links transparently. `sys_setattr` accepts the `link_target` arg and
  rejects self-loops at write time. `sys_stat` surfaces `link_target`
  for callers that want raw link metadata (Linux `lstat` analogue).

Owner: nexus repo. Blocks: chat-with-me workspace shortcut, `/proc/{pid}/agent`
back-reference to the agent profile.

## mailbox-stamping-hook

`MailboxStampingHook` — INTERCEPT pre-write hook on every path matching `*/chat-with-me`.
Reads `caller_agent_id` from kernel auth context; rewrites the envelope's `from` field
in place. LLMs cannot author the field.

Owner: nexus repo (kernel hook crate). Blocks: A2A sender identity guarantee.

## workspace-boundary-hook

`WorkspaceBoundaryHook` — INTERCEPT pre-write hook scoped to `/proc/{pid}/workspace/`.
Compares caller `agent_id` to workspace owner derived from path; on mismatch returns
`Err(EPERM)` with the structured teaching payload (see design doc §3.4).

Implementation landed in `nexi-lab/nexus#3922` with eight unit tests covering the
boundary, the chat-with-me carve-out, runtime-metadata pass-through, and the
empty-caller escape hatch. Registration into `Kernel::register_native_hook` at
boot is the remaining one-line follow-up — kept out of the same commit so the
rule and its proof land before the wire-up.

Owner: nexus repo. Blocks: cross-agent boundary teaching at runtime.

## nostr-backend-driver

`NostrBackend` — bidirectional VFS storage driver. Outbound: NIP-04 EVENT, encrypted
to recipient npub, signed with sender's nexus identity key. Inbound: relay subscription
filter, decrypt, append to local mirror, emit FileEvent for sys_watch.

Owner: nexus repo (likely `rust/kernel/src/nostr_backend.rs`). Blocks: cross-instance
A2A and human-on-Damus reach.

## sudo-code-grpc-service

gRPC `SudoCodeService` — narrow surface (`StartSession`, `Cancel`,
`GetSession`). Prompt + event flow uses the existing chat-with-me VFS
surface, not duplicate RPCs. Replaces the prior ACP-child-process
integration path.

Landed in `nexi-lab/nexus#3922`:
- proto contract (`proto/nexus/grpc/sudo_code/sudo_code.proto`)
- `SudoCodeRPCService` Python impl wired into AgentRegistry — spawn /
  cancel / liveness with session_id ↔ pid map. Best-effort
  `AgentRuntimeRegistry` dispatch for the in-process sudo-code crate;
  when no runtime is registered the agent record is created and a
  warning is logged so a follow-up runtime install can pick it up.

Remaining:
- `AgentRuntimeRegistry` trait + slot in nexus services rlib (the
  kernel-side anchor of the trait DI hook).
- sudo-code Rust crate that implements the trait and registers itself
  at module init (in-process — same process as nexusd, no stdio bind).
- Workspace materialization at start_session: OS symlinks for each
  `WorkspaceRepo` under `/proc/{pid}/workspace/{alias}` plus the
  DT_LINK shortcut at `/proc/{pid}/workspace/chat-with-me`.
- TypeScript gRPC client in this repo + wire-up from the renderer.

Owner: split — nexus repo for runtime trait + workspace setup, this
repo for TS client. Blocks: sudowork ↔ sudo-code integration.

## agent-chat-multi-instance-read

Multi-pid merge for **reads** of `/agents/{name}/chat-with-me` when
more than one pid is active for the agent. Write-side broadcast already
landed in `nexi-lab/nexus#3922`
(`services::agents::agent_chat::list_active_pid_chat_paths` + kernel
`sys_write` fan-out): a write addressed at the agent name reaches every
active `/proc/{pid}/chat-with-me`. Reads still surface the structured
Ambiguous error pointing at the candidate pids.

The remaining follow-up implements interleaved tail merge — pulling
the most-recent N entries off each active pid's stream and emitting
them in timestamp order so a reader using the agent name sees one
unified conversation surface across instances. Skipped when the path
is mounted with `NostrBackend` (remote identity case).

Owner: nexus repo. Blocks: reading a multi-instance agent by name
without picking a pid.

## sudocode-config-migration

sudo-code currently writes user-global settings to `~/.nexus/sudocode/settings.toml`
on the host filesystem. Migrate to `/agents/{name}/config.toml` inside nexus VFS
so configuration sits under the same SSOT as the rest of agent identity.

Owner: sudo-code repo. Blocks: full SSOT for agent identity surface.

## auth-fallback

When the `SudoCodeService` gRPC client lands in this repo (see
`sudo-code-grpc-service`), the assumption that nexus runs with
`--auth-type none` (sudowork profile default) needs to be guarded. The
client should try unauthenticated first and fall back to a bearer token
from a sudowork-side credential store on `Unauthenticated`.

Pre-revert this file used to point at `src/common/nexus/agentRegistry.ts`,
which was the HTTP client for the wrong-direction ACP integration. That
file was removed in the revert; the auth fallback is a guardrail for
the future gRPC client.

Owner: this repo. Blocks: hardening sudowork against multi-tenant
deployment. Cannot start until `sudo-code-grpc-service` lands the
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
