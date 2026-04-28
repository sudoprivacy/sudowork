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
authenticated `agent_id` so LLMs cannot forge identity. Kernel-side
hook struct lives in `rust/kernel/src/mailbox_stamping_hook.rs`,
delegates the rewrite policy to `services::agents::mailbox_stamping::
maybe_stamp_chat_envelope` in the services rlib. Kernel owns "how to
be a hook"; services owns "what to rewrite".

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

## nostr-backend-driver

`NostrBackend` — bidirectional VFS storage driver. Outbound: NIP-04 EVENT, encrypted
to recipient npub, signed with sender's nexus identity key. Inbound: relay subscription
filter, decrypt, append to local mirror, emit FileEvent for sys_watch.

Stub landed in `nexi-lab/nexus#3922` (`rust/kernel/src/nostr_backend.rs`):
the ObjectStore impl is in place and surfaces `StorageError::NotSupported`
on every method until the relay client wires up. Mount registration is
deliberately not added yet — keeps misconfigured nostr mounts from
dispatching into the stub at runtime.

Remaining: tokio-tungstenite relay client, NIP-04 encrypt/decrypt
(reuse `k256` already pulled in for the `nostr` feature), local-mirror
write + FileEvent emission so `sys_watch` callers see relay deliveries
through the same surface as any other VFS write, mount-side wiring.

Owner: nexus repo. Blocks: cross-instance A2A and human-on-Damus reach.

## sudo-code-grpc-service

gRPC `SudoCodeService` — narrow surface (`StartSession`, `Cancel`,
`GetSession`). Prompt + event flow uses the existing chat-with-me VFS
surface, not duplicate RPCs. Replaces the prior ACP-child-process
integration path.

Landed in `nexi-lab/nexus#3922`:
- proto contract (`proto/nexus/grpc/sudo_code/sudo_code.proto`)
- `SudoCodeRPCService` Python impl wired into `AgentRegistry` —
  spawn / cancel / liveness with session_id ↔ pid map. Fails loudly
  (reaps the AgentRegistry pid + raises `RuntimeError`) when no
  runtime is registered for the agent name; silent failure was the
  earlier behaviour and broke sudowork's UI assumption that a
  returned session_id means the agent is alive.
- `AgentRuntimeRegistry` Python class — name-keyed slot map the
  sudo-code crate registers into. The Rust trait counterpart is
  deliberately deferred until the crate ships, so the cross-repo
  dependency direction stays `sudo-code → nexus` only.

Remaining:
- sudo-code Rust crate (separate repo, worktree at
  `sudocode-sudowork-2-tmp`) that satisfies the `AgentRuntime`
  Protocol via PyO3 and registers itself at module init.
- Workspace materialization at `start_session`: building
  `/proc/{pid}/workspace/` with the requested repos visible inside,
  plus the DT_LINK shortcut at `/proc/{pid}/workspace/chat-with-me`.
  Reaping on `cancel_session` / kill.
- TypeScript gRPC client in this repo + wire-up from the renderer.

Owner: split — sudo-code repo for runtime crate; nexus repo for
workspace setup; this repo for TS client. Blocks: sudowork ↔
sudo-code integration.

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
