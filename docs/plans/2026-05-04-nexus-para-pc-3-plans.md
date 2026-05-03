# nexus-para-pc-3 plans — historical + active

> Plans are append-only / revise-not-delete. Sections that are 100% landed get
> compressed to a one-line status; pending follow-ups stay in full. Active
> plan is at the bottom of this file.

## Historical (merged) PR plans

### feat/audit-zone-agent-registry — ✅ MERGED via PR #3912
Audit zone wiring + AgentRegistry Rust SSOT (Phase 1).

### feat/dt-link-primitive — ✅ MERGED via PR #3977
DT_LINK kernel primitive, MailboxStampingHook + WorkspaceBoundaryHook, ServiceRegistry Rust services support, ManagedAgentService + AcpService Rust ports.

### feat/agent-registry-python-fold — ✅ MERGED via PR #3993 (+ sudowork PR #532)
Phase 2 of AgentRegistry SSOT: deleted Python shim, folded all 9 missing methods into Rust, switched 32 in-process callers.

### refactor/managed-agent-procfs-resolver — ✅ MERGED via PR #4009 (+ sudowork PR #534)
Six commits: AgentDescriptor.repos field, ProcWorkspaceResolver PathResolver (later reverted in #4013, see below), session/task DashMap deletion, session_id == pid collapse, cancel(Session) → AgentRegistry::kill, agent → agent_id rename. Architectural correction noted post-merge: workspace shortcut should be plain DT_LINK rows in metastore, not resolver-rendered procfs views — fully addressed in #4013.

### Pending follow-ups carried over from the merged plans

- **Replication policy fix** — `rust/kernel/src/replication.rs` deleted as YAGNI in python-fold PR; if/when path-first replication is needed, rebuild in Rust:
  ```rust
  pub(crate) enum ReplicationTarget { AllVoters, Nodes(Vec<String>), Mount(String) }
  pub(crate) struct MountReplicationPolicy { pub path_prefix: String, pub target: ReplicationTarget }
  fn resolve_policy<'a>(path: &str, policies: &'a [MountReplicationPolicy]) -> Option<&'a MountReplicationPolicy> {
      policies.iter().filter(|p| path.starts_with(&p.path_prefix)).max_by_key(|p| p.path_prefix.len())
  }
  ```
  Plus `PeerBlobClient::fetch_path_async()` over NexusVFS Read RPC (port 2028).
- **ACP lease-revocation Rust rewrite** — if the Python→Rust ACP cutover used a callback shim instead of porting lease revocation to Rust, follow up to rewrite `_perm_lease_table.invalidate_agent` paths in Rust.
- **Sudowork TS gRPC client** — transport migration; design doc references this as future work.
- **Long-branch rebase sweep** — verify no other long-lived branch is hiding bug-already-fixed-on-develop staleness like the wal flake hit during the feat/dt-link-primitive rebase.

---

## Architectural decisions (apply to every plan in this file)

### Doc principles (apply to every `docs/` write)

1. **SSOT** — facts live in one doc per workspace; cross-doc references encouraged, no duplication
2. **No negative statements** — describe what something *is*, not what it isn't
3. **Group related content** together
4. **No status/state info** — strip "Active", "Issue #...", "Phase N", "(R20.18.5)", commit refs, "currently/now/as of"; final-form only
5. **Out-of-scope content stays out** — design docs describe target shape, not in-flight refactors

### Code principles

- Architecturally correct, no boundary leaks, data SSOT, DRY
- Rust-first, perf-first; Python debt stays in Python
- Systematic root-cause fixes, no patches-on-patches
- YAGNI: prefer deletion over patching dead/unused code

### PR / merge hygiene

1. **One PR per repo per plan series** — plan-file `PR-X` labels are commit-history groupings, not separate PRs to open. Multiple parallel PRs to merge together are easy to break (interleaved merges, conflict order, divergent CI state, half-landing). Decision recorded 2026-05-04 after a PR-D D1 PR was opened separately and had to be folded back into the keeper.
2. Resolve conflicts (conflicts don't trigger CI re-run)
3. Fix all CI errors (develop is all-green by team policy; pre-existing failures are still ours to fix)
4. Merge only when CI all green; use `--merge` to preserve full commit history (no squash)
5. Prefer ours (elfenlieds7) on rebase
6. Watch for silent reverts in non-conflicting files (snapshot pre/post diff + file lists across rebases)

### `sudo-code` is in-process Rust, called directly — no DI trait

ManagedAgentService → `sudo_code::spawn_task` is a plain Rust function call, not dispatched through a `Box<dyn AgentRuntime>` registry. The trait abstraction is YAGNI until a second in-process runtime exists. Reaffirmed 2026-05-04 before PR-C kickoff.

### `/proc/{pid}/` topology lives in metastore as DT entries

`AgentStatusResolver` rendering `/proc/{pid}/status` as JSON is the right pattern for content that's a function of live process state. For static-per-lifetime data (workspace shortcut, per-repo aliases), DT_LINK rows in metastore are the right primitive — VFSRouter follows them transparently and the existing hooks have correct path-suffix matching. Reserve PathResolver for content that's strictly procfs-style.

---

## Active plans

### PR-A — `/proc/{pid}/` complete lifecycle + DT_LINK reversion — ✅ LANDED in nexus PR #4013

Six commits already on `feat/proc-pid-lifecycle-complete`:
- A1 — delete `ProcWorkspaceResolver`, restore DT_LINK rows
- A2 — canonical `/proc/{pid}/chat-with-me` DT_STREAM + `/agent` DT_LINK + `sessions/`/`tasks/` DT_DIRs; `chat_stream_profile()` picks `wal` vs `memory` by federation readiness probe
- A3 — cross-link smoke (metastore-level)
- A4 — e2e cross-link sys_write→sys_read (registers a default `/proc` mount on the test fixture's VFSRouter so `route()` succeeds)
- A5 — kernel `HookOutcome::Replace` threaded through `sys_write_with_link_depth` EXECUTE phase: new `dispatch_native_pre_with_replacement` returns the replacement bytes, `has_mutating_hook_match` clone gate keeps the no-hook hot path allocation-free, every EXECUTE site (DT_LINK forward recursion, DT_PIPE/DT_STREAM push, DT_FILE backend write) uses `effective_content`. e2e test: forged `from` field rewritten to caller's agent_id when sys_write goes through the workspace shortcut DT_LINK.

Tests: `cargo test -p kernel` 341/341; `cargo test -p services --features service-managed-agent` 62/62.

Pending follow-ups:
- Federation e2e covering `io_profile=wal` selection
- AuditHook on DT_STREAM writes (DT_STREAM short-circuits the post-hook today; AuditHook never sees chat-with-me bytes)

---

### PR-B — sudowork docs — ✅ LANDED in sudowork PR #535

Four commits on `docs/managed-agent-procfs-resolver`:
- §1 ASCII / §2.1 / §2.2 / §3.x — drop ProcWorkspaceResolver references; DT_LINK is the workspace-shortcut primitive
- §2.2 spawn lifecycle rewrite + §2.3 drop runtime-registry trait + §4.2 Matrix C-S adapter spec (positive form)
- §2.4 sudo-code state placement — ground-truth mapping after surveying [sudoprivacy/sudocode](https://github.com/sudoprivacy/sudocode): `SessionStore::from_data_dir` configurable, `workspace_hash` is FNV-1a 64-bit, prompts walk `AGENTS.md` parent-dir scan, ConfigLoader honours `$SUDO_CODE_CONFIG_HOME`. Each surface tagged READS UNCHANGED / NEEDS PATCH / NEW.
- OPEN-ITEMS Matrix C-S adapter D1–D4 rollout entry

---

### PR-D — Matrix C-S adapter — ✅ D1+D2+D3 LANDED in nexus PR #4013

Seven commits on `feat/proc-pid-lifecycle-complete` (same branch as PR-A, single-PR-per-repo rule):

- **D1** — skeleton + auth (`login` / `logout` / `whoami`); axum router; AuthBackend trait + StubAuthBackend for tests; AdapterError → Matrix errcode JSON; access-token middleware stamps `AuthSession` into request extensions.
- **D2/1** — room-id ↔ stream-path base32 codec
- **D2/2** — PDU envelope ↔ chat envelope translator (sender stripped from request body so MailboxStampingHook re-stamps from OperationContext — adapter cannot forge)
- **D2/3-4** — 8 room read/write endpoints (state, state/{type}/{key}, messages, joined_members, send, join, leave, createRoom). spawn_blocking around every kernel syscall. Shared kernel via `OnceLock<Arc<Kernel>>` so per-test Kernel drop doesn't panic in async context.
- **D3/1** — `/sync` long-poll + per-user `JoinedRooms` map. Polling fallback (50ms slice) instead of `sys_watch` because kernel's `FileWatchRegistry::wait_for_event` is currently a stub returning `None` — kernel watch impl is a follow-up.
- **D3/2** — media repo (upload/download/thumbnail). Uses DT_STREAM for byte storage at D3 (works against stock `Kernel::new()` without a separately-wired CAS backend); HTTP surface is upgrade-compatible with future DT_FILE+CAS once an in-process backend lands.
- **D3/3** — push gateway stubs (read-only `pushrules` + `pushers` endpoints; enough to keep stock chat clients from erroring on startup; active push delivery is a future PR).

Tests: 49/49 matrix tests across the surface; `cargo test -p services --features service-managed-agent --features service-matrix-adapter --lib` 111/111 total.

Pending follow-ups:
- **D4 Element smoke test** — manual / scripted: local Element pointed at the adapter, login → join → send → image upload. Spec'd as manual or headless-browser CI; not a unit test commit.
- **Real `sys_watch` impl in kernel** — `FileWatchRegistry::wait_for_event` currently returns `None`; once it actually waits, /sync polling fallback drops out.
- **DT_FILE+CAS for media** — replace the DT_STREAM-backed storage once an in-process CAS-or-PathLocal ObjectStore lands for the `/media` mount.
- **ReBAC-backed membership** — `JoinedRooms` is in-memory today; a future PR wires real ReBAC predicates so /sync membership and join/leave permission share an SSOT.

---

### PR-C — sudo-code crate integration (active 2026-05-04)

> **Repos**: nexus #4013 (same branch, more commits), sudoprivacy/sudocode (own PR, own branch)
> **Goal**: `ManagedAgentService::start_session` calls `sudo_code::spawn_task(kernel, descriptor)` so a freshly-allocated pid actually has an LLM loop attached. End-to-end: sudowork → start_session_v1 → sudocode spawns task → sudo-code reads `/proc/{pid}/chat-with-me` → calls real LLM → writes response → sudowork's UI sees it via sys_watch / /sync.

#### Decisions (2026-05-04)

1. **In-process Rust call, no trait, no DI**. `nexus → sudocode` Cargo edge (path dep `sudocode = { path = "../sudocode" }`); `sudo_code::spawn_task` is a plain `pub fn`. Trait abstraction is YAGNI until a second in-process runtime exists.
2. **Spawn-task entry lives in sudocode** because the LLM loop, prompts, sessions, skills are sudocode's domain. ManagedAgentService manages OS-layer agent state (pid / procfs / AgentRegistry / cancel events) — it doesn't know LLM API or session jsonl format.
3. **Signature**: `pub fn spawn_task(kernel: Arc<Kernel>, desc: AgentDescriptor) -> SpawnHandle`. sudocode adds path dep `kernel = { path = "../nexus-para-pc-3/rust/kernel" }`. Local-layout dep is fine for our dev setup.
4. **Cancellation = `tokio_util::sync::CancellationToken`**, not `JoinHandle::abort` (abort leaks HTTP connections / partial writes):
   ```rust
   pub struct SpawnHandle {
       pub cancel_turn: CancellationToken,    // ESC: interrupt current LLM stream, keep session
       pub cancel_session: CancellationToken, // session terminate
       pub join: tokio::task::JoinHandle<()>,
   }
   ```
5. **First version reuses sudocode's existing infrastructure**:
   - `runtime::Conversation::run_turn(user_input, ...)` is the proven LLM-turn driver (conversation.rs:330; ~2000 LOC tested machinery)
   - `api::AnthropicClient` is the LLM HTTP client
   - `nexus-vfs-client` (sudocode-side gRPC client) stays for the standalone-CLI use case, NOT used by spawn_task — spawn_task uses direct `kernel.sys_*` syscalls.

#### Open design point: ESC interrupt granularity

`run_turn` is sync and 2061 LOC; making ESC interrupt cancel mid-stream-chunk requires refactoring its internal LLM stream loop to honour a `CancellationToken`. Two options:

- **(A) First-version pragmatic**: spawn_task wraps `run_turn` in `spawn_blocking`. `cancel_turn` token is checked at turn boundaries (next prompt loop iteration). `cancel_session` aborts the spawn_blocking thread (or relies on the next turn-boundary check). ESC = "stop after current LLM response finishes streaming". Less responsive but small surface area.
- **(B) Stream-aware cancellation now**: refactor `run_turn`'s LLM stream loop in sudocode to take an optional `CancellationToken`; check between SSE chunks. ESC = immediate mid-stream interrupt. Larger sudocode surgery (touches conversation.rs, api crate's stream collection, possibly tests).

**Decision pending user input.** If (A): land PR-C now in 2 commits, ship behavior in days. If (B): land PR-C in 4-5 commits, sudocode-side surgery first then nexus wiring.

#### Commit sequence (assuming option A)

**sudocode repo (own PR)**:
- C1/sudocode — add `pub fn spawn_task(kernel, desc) -> SpawnHandle` module wrapping `Conversation::run_turn` in spawn_blocking; CancellationToken-aware turn boundary; reads `/proc/{pid}/chat-with-me` via direct kernel sys_read; writes response to `/agents/{user}/chat-with-me` (parsed from envelope's `from`). Add path dep on kernel.
- C2/sudocode — replace `std::fs` reads in `session.rs` and `prompt.rs` (AGENTS.md scan) with `kernel.sys_read` when running in spawn_task mode (so session jsonl + prompts live in nexus VFS). Standalone CLI mode keeps `std::fs`.

**nexus #4013 (same branch)**:
- C3/nexus — add `sudocode = { path = "../sudocode" }` Cargo edge. Extend `ManagedAgentService` with `spawn_handles: DashMap<String, SpawnHandle>`. `start_session` calls `sudo_code::spawn_task` after `register_proc_entry` succeeds, stores SpawnHandle. `cancel(Turn)` → `handle.cancel_turn.cancel()`. `cancel(Session)` → `handle.cancel_session.cancel()` + remove from map. on_terminate observer also fires `cancel_session`.
- C4/nexus — e2e test: install ManagedAgentService, start_session, sys_write a prompt to `/proc/{pid}/chat-with-me`, assert a response lands in `/agents/{user}/chat-with-me` within timeout. LLM mocked via sudocode's existing `mock-anthropic-service` crate.

#### Risks

1. **Compile-time blast radius**: nexus pulling in sudocode pulls in tokio runtime's full multi-thread stack (already present), api crate (Anthropic HTTP), keyring, sha2, etc. Acceptable — these end up in the cdylib anyway when the cluster profile ships sudo-code.
2. **`nexus-vfs-phase3` branch state in sudocode**: spawn_task and gRPC-VFS path coexist. Boot mode picks one — env var or feature flag. Document the switch in spawn_task module docs.
3. **CancellationToken vs run_turn sync**: spawn_blocking JoinHandle is awaitable from async; cancellation is checked at turn boundaries (option A). Mid-LLM-stream ESC requires option B's sudocode surgery.
4. **Test flake under multi-thread runtime + Kernel drop**: D2/D3 tests already use `OnceLock<Arc<Kernel>>` shared fixture to avoid the Kernel-drop-in-async-context panic. C4's e2e test uses the same pattern.

---

## Decisions added by 2026-05-04 round

### Single PR per repo per task series

Plan file `PR-A` / `PR-B` / `PR-C` / `PR-D` labels are commit-history groupings within ONE PR per repo, not multiple parallel PRs. The user was bitten by interleaved merges and divergent CI. Confirmed after a PR-D D1 separate PR was opened and folded back into the keeper.

### Kernel `wait_for_event` is currently a stub

`FileWatchRegistry::wait_for_event` returns `None` immediately. Anything that depends on real `sys_watch` blocking (Matrix /sync long-poll today, future managed-agent watch use cases) needs polling fallback until the kernel impl lands. `/sync` ships with a 50ms-slice polling loop; document explicitly so the rebuild is straightforward.

### Media storage interim shape

D3 ships `/media/{id}` as DT_STREAM (capacity = upload size, single push, single read). HTTP surface is upgrade-compatible with the spec'd DT_FILE + CAS once an in-process CAS-or-PathLocal ObjectStore is wired for the `/media` mount.
