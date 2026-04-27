# Nexus Integration Architecture

End-state architecture for the sudowork ↔ nexus ↔ sudo-code surface — agent identity,
A2A messaging, audit trace, cross-instance transport.

Cross-references:

- nexus repo (`nexi-lab/nexus`) — `docs/architecture/KERNEL-ARCHITECTURE.md`: kernel primitives, syscall surface, dispatch model
- nexus repo — `docs/architecture/federation-memo.md`: Raft, zone topology, gRPC transport
- this repo — `OPEN-ITEMS.md`: items not yet implemented; xfail sentinel keeps the list visible in CI

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         sudowork (Electron)                          │
│   Renderer (React UI)  ←IPC bridge→  Main process (Node/TS)         │
│        │                                      │                      │
│   chat UI, audit viewer,           starts nexusd, manages sessions  │
│   messenger UI                     via gRPC                          │
└───────────────────────────────────────┬─────────────────────────────┘
                                        │ gRPC (localhost:2028)
                                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│              nexusd + sudo-code  (single process, always-on)         │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Rust Kernel cdylib  (nexus_kernel)                         │    │
│  │  VFSRouter · DCache · Metastore(redb) · LockManager         │    │
│  │  PipeManager(DT_PIPE) · StreamManager(DT_STREAM)            │    │
│  │  FileWatchRegistry(sys_watch) · KernelDispatch(hooks)       │    │
│  │  AuditHook · AgentStatusResolver · DT_LINK resolver         │    │
│  └────────────┬────────────────────────┬────────────────────────┘   │
│               │                        │                             │
│  ┌────────────▼─────────┐   ┌──────────▼──────────────────┐         │
│  │  services rlib       │   │  sudo-code runtime          │         │
│  │  AgentTable (state)  │   │  (linked Rust crate,        │         │
│  │  agent_chat resolver │   │   trait DI registered into  │         │
│  │  mailbox stamping    │   │   AgentRuntimeRegistry)     │         │
│  └────────┬─────────────┘   │  one tokio task per pid     │         │
│           │                 │  cwd = /proc/{pid}/workspace│         │
│  ┌────────▼─────────────┐   │  direct kernel syscalls,    │         │
│  │  Python service tier │   │  no stdio, no JSON-RPC      │         │
│  │  AgentRegistry shim  │   └─────────────────────────────┘         │
│  │  SudoCodeService     │                                           │
│  │  AcpService          │   FastAPI bricks (mount, rebac, …)        │
│  │   (claude/codex/…)   │                                           │
│  └──────────────────────┘                                           │
│                                                                      │
│  AcpService spawns external ACP backends as subprocesses with        │
│  StdioPipeBackend → /proc/{pid}/fd/{0,1,2}; sudo-code does NOT use   │
│  that path because it shares the process with nexusd.                │
│                                                                      │
│  gRPC port 2028: NexusVFSService + SudoCodeService                  │
└─────────────────────────────────────────────────────────────────────┘
```

### Constraints

- **One nexusd per sudowork instance.** sudowork starts nexusd at launch and tears it down on quit.
- **Single Python-facing cdylib.** `nexus_kernel` is the only PyO3 extension module. Service-tier rlibs (`services`, `raft`, `library`, `contracts`) link into it.
- **State SSOT.** Agent runtime state (`pid → AgentState`, condvar wakeup) lives in `services::agents::agent_table::AgentTable`; the Python `AgentRegistry` is a shim that dual-writes through the kernel `agent_*` syscalls. Profile config lives on disk under `/agents/{name}/`.
- **gRPC is the integration surface.** sudowork (Node/TS) reaches nexusd through tonic-served gRPC at port 2028; HTTP is reserved for human-facing dashboards.
- **Cluster profile.** sudowork uses Nexus's cluster profile — bricks: IPC, FEDERATION.
- **Zone = VFS path mount point.** A zone's visibility boundary is its mount path. ReBAC governs sub-path access within a zone.

---

## 2. Agent Identity & Runtime

Two namespaces, the same Linux distinction between an executable on disk and a running process:

| Namespace | Lifetime | Content | Backing store |
|-----------|----------|---------|---------------|
| `/agents/{name}/` | Persistent | Profile config: `config.toml`, `prompts/`, `skills/`, `chat-with-me` | Metastore (DT_FILE / DT_DIR) |
| `/proc/{pid}/` | Ephemeral | Runtime: `status`, `agent` link, `chat-with-me`, `sessions/`, `tasks/`, `workspace/` | In-memory + WAL while pid alive |

`/agents/{name}/` is the stable identity an outsider addresses (other agents, humans on Damus). One agent name can spawn many `pid`s — different worktrees, parallel work — and all of them share the same profile.

### 2.1 Agent-name namespace

```
/agents/scode-standard/          ← profile (DT_DIR)
   config.toml                   ← model selection, MCP endpoints, default workspace recipe
   prompts/                      ← system-prompt overrides, per-skill prompts
   skills/                       ← which tool sets are loadable
   chat-with-me                  ← agent-name conversation endpoint
```

`chat-with-me` resolution at the agent-name level depends on the kind of agent:

- **Local agent with one-or-more running pids** (e.g. `scode-standard`): kernel-internal aggregator (`services::agents::agent_chat`) routes writes to the matching `/proc/{pid}/chat-with-me` when exactly one instance is active; ambiguous (>1 active pid) and missing (0 active pid) cases surface a structured error pointing at `/proc/{pid}/chat-with-me`.
- **Remote identity** (e.g. `human-bob` reached via Damus, or `alice@damus`): the path is mounted with `NostrBackend` (§4). Writes become NIP-04 DMs to the configured npub; incoming DMs surface as `sys_watch` wake-ups.
- **Local persistent identity** (e.g. `human-ethan` running in this nexusd): real DT_STREAM. The sudowork UI reads it for inbox display, writes for outgoing messages.

### 2.2 Runtime namespace

```
/proc/{pid}/
   status                        ← virtual file: AgentStatusResolver returns descriptor JSON
   agent                         ← DT_LINK → /agents/{name}/   (Linux /proc/{pid}/exe analogue)
   chat-with-me                  ← DT_STREAM: this pid's conversation
   sessions/                     ← jsonl files written by sudo-code (cwd-driven)
   tasks/                        ← named task lists for this pid
   workspace/                    ← real DT_DIR; OS-level symlinks point at host repos
      chat-with-me               ← DT_LINK → /proc/{pid}/chat-with-me
      project-x/                 ← OS symlink → host repo checkout
      project-y/                 ← OS symlink → another host repo checkout
```

`/proc/{pid}/status` is served by `AgentStatusResolver` (kernel), reading from the Rust `AgentTable`. The pid descriptor — state, exit code, agent name, parent pid, timestamps — stays in `AgentTable`; the resolver renders it as JSON at read time.

`/proc/{pid}/agent` is a kernel-resolved DT_LINK to the agent-name directory. `readlink` returns `/agents/{name}/`; `stat` follows. This is the single SSOT pointer from a runtime back to its profile — no metadata duplication.

### 2.3 Spawn lifecycle

sudo-code is in-process: a Rust crate linked into nexusd, driven as a tokio
task per pid. There is no subprocess and no stdio plumbing — that machinery
exists in `AcpService` only because external ACP agents (claude / codex /
codebuddy / nanobot) run in separate OS processes and the only protocol
those binaries support is JSON-RPC over stdio. sudo-code is our own code in
our own process, so it talks to the kernel through direct Rust syscalls
(`kernel.sys_read`, `kernel.sys_write`, `kernel.sys_watch`, …) and to the
dispatch hooks through the same in-process channel every kernel observer
uses.

```
sudowork (Electron, TS)
   │ gRPC: SudoCodeService.StartSession(agent="scode-standard", repos=[…])
   ▼
nexusd:
   SudoCodeRPCService.sudo_code_start_session
      │ AgentRegistry.spawn(name, owner, zone, kind=MANAGED, labels)
      │   → allocates pid; AgentTable in services rlib carries the
      │     authoritative state; Python AgentRegistry holds the PCB shim
      │ session_id = "sess-" + uuid4()[:12]
      │ workspace_path = "/proc/{pid}/workspace/"
      │ AgentRuntimeRegistry.get(agent) → AgentRuntime | None
      │   • None: log a warning, keep the AgentRegistry record, return.
      │     A follow-up runtime install can pick the agent up — the
      │     gRPC contract is decoupled from runtime wire-up timing.
      │   • Some(runtime): runtime.spawn(pid, workspace_path, repos, model).
      │     Spawn failure reaps the pid and surfaces RuntimeError to
      │     sudowork so the session is never reported as live.
      ▼
   {session_id, agent_id=pid, workspace_path} → sudowork
```

The provisioner step that builds `/proc/{pid}/workspace/` with OS-level
symlinks for each `WorkspaceRepo` and plants the DT_LINK shortcut at
`/proc/{pid}/workspace/chat-with-me` is tracked separately in
`OPEN-ITEMS.md / sudo-code-grpc-service`. Until it lands, `workspace_path`
is just the path string — the runtime task can still take cwd at it once
nexus VFS exposes the directory.

After spawn, prompts and responses flow through the chat-with-me VFS surface
— same A2A primitive every other agent uses (§3). sudowork writes prompts to
`/agents/scode-standard/chat-with-me`; the kernel's agent_chat resolver
routes single-pid writes and broadcasts multi-pid writes; the kernel rewrites
the envelope's `from` field to sudowork's `agent_id` (§3.3). The sudo-code
task in nexusd `sys_watch`es its own `/proc/{pid}/chat-with-me` for incoming
prompts and writes responses to `/agents/{user}/chat-with-me`. sudowork's UI
`sys_watch`es the user's chat-with-me for those responses.

**`SudoCodeService` gRPC surface is intentionally narrow** — only spawn /
cancel / liveness:

- `StartSession(agent, repos, model)` → `{session_id, agent_id, workspace_path}`
- `Cancel(session_id, mode)` → `{cancelled}`. `mode ∈ {cancel_turn, cancel_session}`
  — turn aborts the current generation, session also reaps the pid.
- `GetSession(session_id)` → `{session_id, agent_id, agent, workspace_path, model, state}`

Prompt / event flow uses the existing `NexusVFSService` gRPC (`sys_write`,
`sys_watch`, `sys_read`) over the chat-with-me paths. There is no
`SendPrompt` or `SubscribeEvents` gRPC — those would duplicate the A2A
surface the rest of the system uses.

#### AgentRuntimeRegistry

`AgentRuntimeRegistry` is the kernel-knows DI slot the
`SudoCodeRPCService` handler dispatches through, parallel to
`NativeInterceptHook` registration. It lives in
`nexus.services.sudo_code.runtime_registry` and exposes a small surface:

```python
class AgentRuntime(Protocol):
    def spawn(self, *, pid: str, workspace_path: str,
              repos: list[dict[str, Any]], model: str) -> None: ...
    def cancel(self, *, pid: str, mode: str) -> None: ...

class AgentRuntimeRegistry:
    def register(self, agent_name: str, runtime: AgentRuntime) -> None: ...
    def unregister(self, agent_name: str) -> None: ...
    def get(self, agent_name: str) -> AgentRuntime | None: ...
    def list(self) -> list[str]: ...
```

The trait is declared as a Python `Protocol` (duck-typed) so the same
slot accepts both an in-process Rust impl bound through PyO3 (the
shape sudo-code's runtime crate will use) and pure-Python implementations
useful for testing. The Rust counterpart trait — `pub trait AgentRuntime:
Send + Sync` in the services rlib — is deferred until the sudo-code crate
itself lands, so the dependency direction stays `sudo-code → nexus` only
and nexus carries no Cargo edge into sudo-code.

`AgentState` lifecycle: `REGISTERED → WARMING_UP → READY ↔ BUSY → SUSPENDED → TERMINATED`.
`kernel.agent_wait(pid, target_state, timeout_ms)` releases the GIL and
parks on the per-pid condvar — Python supervisors get a blocking wait
without pinning the interpreter.

### 2.4 sudo-code state placement

sudo-code keeps its existing JSONL session format and on-disk task layout. The integration places that storage inside nexus VFS rather than rewriting sudo-code:

| State | Path | Backing |
|-------|------|---------|
| Conversation jsonl | `/proc/{pid}/workspace/.scode/sessions/<workspace_hash>/{session_id}.jsonl` | DT_FILE |
| Active task list | `/proc/{pid}/tasks/{task_list_name}.json` | DT_FILE |
| Agent profile config | `/agents/{name}/config.toml` | DT_FILE |

User-global settings currently held by sudo-code in `~/.nexus/sudocode/settings.toml` remain on the host filesystem until the migration to `/agents/{name}/config.toml` lands (tracked in OPEN-ITEMS).

---

## 3. A2A Communication

A2A, H2A, and A2H share one primitive: write a message to the recipient's `chat-with-me`.

### 3.1 Mailbox

`/agents/{name}/chat-with-me` and `/proc/{pid}/chat-with-me` are append-only message streams. They are normal DT_STREAMs that any caller can write to and the owner can read with `sys_watch`. Federation Raft replicates them across zone members; cross-instance reach happens through `NostrBackend` mounts (§4).

### 3.2 The chat-with-me link inside a workspace

Every workspace exposes a sibling `chat-with-me` entry as a DT_LINK to the owning pid's chat:

```
/proc/{pid}/workspace/chat-with-me  ← DT_LINK → /proc/{pid}/chat-with-me
```

So an agent inside another's workspace — say agent A is staged at `/proc/p_other/workspace/projects/nexus/` and wants to talk to whoever owns this nexus repo — writes to `chat-with-me` relative to wherever it stands; the link follows back to the workspace owner's stream.

The link target is resolved by the kernel `route()` step (one hop, with cycle detection). All hooks fire on the resolved target path, so audit, sender stamping, and boundary checks behave identically to a direct `/proc/{pid}/chat-with-me` write.

### 3.3 Sender identity

Mailbox envelope stamping rewrites the message envelope's `from` field
before the write reaches the backend. The kernel calls
`services::agents::mailbox_stamping::maybe_stamp_chat_envelope` inline
from `sys_write` on every path matching `*/chat-with-me`; the helper
short-circuits on the path test for non-mailbox paths and on writes
without a caller `agent_id`. LLMs cannot forge identity because the
field is overwritten in-kernel — they do not author it.

The stamping is an inline call rather than a registered
`NativeInterceptHook` because the hook surface contract is read-only
(hooks see the write, accept or reject it, but do not mutate
content). Mutating the envelope before backend dispatch needs a
content-rewriting carve-out; rather than widen the hook surface for
one consumer, the kernel calls the policy function directly and
non-mailbox paths pay zero cost.

```
agent A writes envelope { to: "scode-standard", body: "ping" }
   │
   ▼
sys_write inline: maybe_stamp_chat_envelope
   reads ctx.agent_id = "human-ethan"
   rewrites envelope: { from: "human-ethan", to: "scode-standard", body: "ping", ts: now() }
   │
   ▼
DT_STREAM append (per-pid stream, possibly broadcast across pids
                  for the multi-instance agent_chat case — §3.6)
```

### 3.4 Boundary teaching UX

`WorkspaceBoundaryHook` is registered as an `INTERCEPT pre-write` hook scoped to `/proc/{pid}/workspace/{...}`. It compares the caller's `agent_id` to the workspace owner derived from the path (`pid → AgentTable.lookup(pid).name`). On mismatch the hook returns `Err(EPERM)` with a structured payload:

```
EPERM at /proc/p_scode/workspace/projects/nexus/src/main.rs:
  This workspace is owned by agent 'scode-standard' (pid p_scode).
  You are 'human-ethan'. To send a message about this workspace, write to:
     /proc/p_scode/workspace/chat-with-me
  (Or address scode-standard directly at /agents/scode-standard/chat-with-me.)
```

The error is intentionally instructive. LLMs that hit it once learn the convention without memory or system-prompt edits — the path layout itself is the SSOT for permissions.

### 3.5 Same primitive across humans and agents

`/agents/human-ethan/chat-with-me` is the canonical Ethan address. From sudowork's UI Ethan sends through gRPC writes to other agents' `chat-with-me`; he reads his own through `sys_watch` over the same path. Other humans (Bob on Damus) appear via `NostrBackend` mount (§4) — the sender does not pick the transport, the mount does.

### 3.6 Multi-instance agent_chat resolution

One agent name can have many running pids — `scode-standard` running in
two worktrees is a normal case. The agent_chat resolver
(`services::agents::agent_chat`) handles all three cardinalities:

- **0 active pids** → kernel returns a `FileNotFound` error citing the
  agent name, so callers see "no instance running" instead of the
  generic missing-path error.
- **1 active pid** → the resolver rebinds `/agents/{name}/chat-with-me`
  to the matching `/proc/{pid}/chat-with-me` and the rest of `sys_*`
  walks the resolved path.
- **N active pids** → on writes, the kernel broadcasts: every active
  pid's `/proc/{pid}/chat-with-me` receives a copy of the envelope
  (recursive `sys_write` so per-pid hooks fire normally; mailbox
  stamping happens once on the resolved path so every recipient sees
  the same `from`). On reads, the kernel surfaces an `Ambiguous` error
  pointing at the candidate pids — the multi-pid read merge that
  interleaves entries by timestamp is tracked in
  `OPEN-ITEMS.md / agent-chat-multi-instance-read`.

Active = `AgentState ∈ { WarmingUp, Ready, Busy, Suspended }`. Terminated
and Registered (not-yet-warm) pids are skipped so a stale agent record
does not intercept the path.

---

## 4. Cross-instance Transport via NostrBackend

`NostrBackend` is a bidirectional storage driver mounted at any `chat-with-me` path that needs to reach a remote identity. It is registered like any other backend through `sys_setattr(DT_MOUNT, backend=NostrBackend{npub: …, relays: […]})`.

```
/agents/human-bob/chat-with-me  ← mount: NostrBackend{npub: bob_npub, relays: [wss://relay.damus.io, …]}
```

### 4.1 Outbound

```
agent X writes envelope to /agents/human-bob/chat-with-me
      │
      │  inline kernel stamping rewrites from = "agent-X" (§3.3)
      ▼
NostrBackend::write_content(envelope)
      │
      │  build NIP-04 EVENT (kind 4), encrypt to bob_npub, sign with X's nostr key
      ▼
relay client publishes to configured relays
```

X's nostr key is the same identity nexus issues for X — one cryptographic identity covers VFS, federation, and Nostr. The recipient on Damus sees a regular encrypted DM authored by X.

### 4.2 Inbound

```
relay client subscribes to filter { kinds: [4], #p: bob_npub }
      │  EVENT arrives
      ▼
NostrBackend::on_event
      │
      │  decrypt, unwrap envelope, append to local mirror
      ▼
StreamBackend emits FileEvent → FileWatchRegistry wakes sys_watch subscribers
```

The recipient's `sys_watch("/agents/human-bob/chat-with-me")` wakes and reads the message, identical to a local DT_STREAM read. The transport is transparent.

### 4.3 Why this beats a separate Nostr API

The driver-as-backend model gives Nostr messaging the rest of the kernel's machinery for free:

- **Permissions** — ReBAC on the path governs who may send to a remote identity.
- **Audit** — every send is a normal write, captured by `AuditHook` like any other VFS write.
- **Discoverability** — `sys_readdir("/agents/")` lists local and remote identities uniformly.
- **UI reuse** — Bob's client stays Damus or Amethyst; nexus does not own that surface.

Native VFS clients (sudowork) stay on the gRPC path, indifferent to whether the recipient happens to be backed by Raft or Nostr.

---

## 5. Audit Trace

### 5.1 Surface

| Concern | What | Source |
|---------|------|--------|
| VFS operation trace | Every read/write/delete/rename through nexus kernel, including chat-with-me writes | Rust `AuditHook` on kernel dispatch (POST phase) |
| Exchange audit | Agent economic transactions | Python exchange service |

Both write to **DT_STREAM with WalStreamBackend** — ordered, durable, Raft-replicated.

### 5.2 AuditHook pipeline

```
Kernel dispatch (Rust)
      │
      │  on_post_write / on_post_read / on_post_delete (POST hook)
      ▼
AuditHook  (impl NativeInterceptHook — pure Rust, no PyO3)
      │
      │  mpsc::SyncSender::try_send()  ← ~10–50ns, non-blocking
      ▼
audit-flush  (background Rust thread)
      │
      │  serialise AuditRecord → JSON → WalStreamCore::write_nowait
      ▼
WalStreamCore  (Command::AppendStreamEntry → zone Raft cluster)
      │
      └─► registered with StreamManager at /{zone}/audit/traces/
```

### 5.3 Auto-wiring on zone create / join

`zone_create(zone_id, audit=true)` and `zone_join(zone_id, as_learner, audit=true)` are kernel syscalls that auto-wire the AuditHook from Rust before any `sys_*` mutation can race in. The legacy Python wire-up (`_init_audit_hook` in `nexus/__init__.py`) handles the boot-time root-zone hook for federation deployments; every other zone gets its hook through the syscall flag.

### 5.4 Central audit zone

Each production node shares a 1:1 zone with the audit-node. `AuditHook` writes formatted `AuditRecord` entries to `/audit/traces/` in that shared zone; the audit-node reads and gathers them locally.

```
Production nexusd (node A)
    │  AuditHook → /audit/traces/  (auto-wired by zone_create(audit=true))
    │
    └──► Shared zone: zone-A-audit
              Raft cluster: [node-A voter, audit-node learner]

Production nexusd (node B)
    │  AuditHook → /audit/traces/
    │
    └──► Shared zone: zone-B-audit
              Raft cluster: [node-B voter, audit-node learner]

Audit nexusd (audit-node)
    ├── learner of zone-A-audit  ← receives only node-A's audit stream
    ├── learner of zone-B-audit  ← receives only node-B's audit stream
    └── local collect/gather: reads all /audit/traces/ streams, aggregates
```

The 1:1 zone holds `AuditRecord` only — formatted by `AuditHook`, with no production-zone metadata or lock commands. audit-node joins via `zone_join(zone_id, as_learner=true, audit=true)` so the production zone's voter quorum is unaffected; audit loss is preferable to blocking production writes.

### 5.5 AuditRecord schema

```json
{
  "v": 1,
  "ts": "2026-04-26T10:00:00.123Z",
  "trace_id": "req_a1b2c3d4",
  "agent_id": "agent:sudo-code",
  "op": "write",
  "path": "/proc/p_scode/workspace/projects/nexus/src/main.rs",
  "zone_id": "root",
  "size_bytes": 1024,
  "status": "ok",
  "duration_us": 42
}
```

---

## 6. Data Replication Mechanisms

Three replication paths exist in the kernel; the integration uses each for a different purpose:

| Mechanism | Where in this doc | Semantics |
|-----------|-------------------|-----------|
| **DT_FILE** (regular file) | sudo-code sessions, profile configs, task lists | Metadata + content via CAS; random read; intra-zone |
| **DT_STREAM + WalStreamBackend** | `chat-with-me`, `/audit/traces/` | Append-only; offset-based read; intra-zone, Raft-replicated |
| **NostrBackend** (mount) | Remote `chat-with-me` paths | Cross-instance encrypted DM; bidirectional driver |

`WalStreamBackend` is the only mechanism that puts application data into the Raft log; this is the right tradeoff for ordered, durable conversation streams (audit, chat). DT_FILE uses Raft only for metadata coordination; content lives in the backend. `NostrBackend` is fully external — Raft is not involved.

---

## 7. Messenger Surface

The Nostr side (§4) is the kernel-level transport. The messenger product surface consumes it:

- **Damus / Amethyst / Snort** for human-facing chat. Cross-network, NIP-04 DMs and NIP-90 DVM tasks.
- **sudowork chat UI** for in-app conversations. Reads from local `chat-with-me` streams over gRPC.
- **NIP-90 DVM** kinds (5000–5999 / 6000–6999) double as a public AI task interface for agents that publish their availability over Nostr.

Identity unification: each agent's Nostr keypair == its nexus identity. One key, every surface.

| Nostr `kind` | Platform meaning |
|--------------|-----------------|
| 1 | Short text / agent status |
| 4, 44 | Encrypted DM (NIP-04 / NIP-44) |
| 9735 | Zap → nexus exchange transfer |
| 5000–5999 | NIP-90 DVM task request |
| 6000–6999 | NIP-90 DVM task result |

---

## 8. Open Items

The following items are necessary for the end-state architecture and are
tracked individually in `OPEN-ITEMS.md`. The xfail sentinel test in this
repo fails until each is resolved or struck through.

- `DT_LINK` kernel primitive — entry type, `route()` follow with cycle
  detection, `sys_setattr` wiring, `sys_stat` lstat-style surfacing of
  `link_target`. Phase 1 + most of Phase 2 landed; remaining wiring is
  scoped in OPEN-ITEMS.
- `NostrBackend` driver runtime — bidirectional, NIP-04 DM, mount-based,
  signed with sender's nexus identity key. ObjectStore stub committed
  (every method returns `NotSupported`); relay client + NIP-04
  encrypt/decrypt + local-mirror + mount wire-up still pending.
- gRPC `SudoCodeService` — `StartSession` / `Cancel` / `GetSession`
  proto + Python `SudoCodeRPCService` impl wired into AgentRegistry +
  `AgentRuntimeRegistry` Protocol have landed. Pending: sudo-code
  Rust runtime crate that implements `AgentRuntime` and registers
  itself at module init; `/proc/{pid}/workspace/` materialization
  (OS-level repo symlinks + DT_LINK chat-with-me shortcut); TS gRPC
  client in this repo.
- Multi-instance `/agents/{name}/chat-with-me` read merge — write-side
  broadcast across active pids landed; read merge that interleaves
  entries from multiple pids by timestamp is pending.
- Migration of sudo-code's `~/.nexus/sudocode/settings.toml` to
  `/agents/{name}/config.toml` — sudo-code-side change.
- Auth fallback — when the future TS gRPC client lands in this repo,
  it must try unauthenticated first and fall back to a bearer token
  on `Unauthenticated` so the `--auth-type none` assumption (cluster
  profile default) does not become load-bearing.

The following items are **closed** in nexi-lab/nexus#3922; they remain
listed here only to anchor the architecture description above:

- Mailbox envelope stamping (`services::agents::mailbox_stamping` +
  inline kernel call from `sys_write` — not a registered
  `NativeInterceptHook`; see §3.3 for why)
- `WorkspaceBoundaryHook` — INTERCEPT pre-write hook + boot-time
  registration in `Kernel::register_native_hook`

---

## 9. Appendix A: Kernel Dispatch Hook Lifecycle

```
syscall (sys_write, sys_read, …)
    │
    ├─► [INLINE REWRITE — sys_write only] mailbox stamping
    │         services::agents::mailbox_stamping::maybe_stamp_chat_envelope
    │         → rewrites envelope `from` for paths matching */chat-with-me;
    │           short-circuits on the path test for everything else.
    │
    ├─► [PRE] HookRegistry::get_pre_hook_impls(op)
    │         NativeInterceptHook::on_pre(ctx)
    │         → return Err to abort (permission, quota, WorkspaceBoundaryHook
    │                                 teaching reject)
    │
    ├─► [EXECUTE] backend write (redb / CAS / MemoryStreamBackend / NostrBackend / …)
    │
    ├─► [POST] HookRegistry::get_post_hook_impls(op)
    │         NativeInterceptHook::on_post(ctx)  ← AuditHook fires here
    │         → fire-and-forget, non-blocking (mpsc try_send)
    │
    └─► [OBSERVE] MutationObserver::on_mutation(FileEvent)
              → StreamEventObserver writes to DT_STREAM (sys_watch wakeup)
              → FileWatcher wakes sys_watch subscribers
```

The mailbox stamping step lives outside the `NativeInterceptHook`
contract because hooks see writes but cannot mutate them. Adding a
content-rewriting carve-out would have widened the hook surface for
one consumer; an inline call from `sys_write` is the smaller change.
The `[PRE]` hook list still owns everything that can reject a write
without rewriting it.

---

## 10. Appendix B: Raft Command Taxonomy

All commands in a zone's Raft cluster share a single `Command` enum (`state_machine.rs`):

```
Command::SetMetadata           — VFS file/dir metadata (path, size, etag, …)
Command::DeleteMetadata        — VFS delete
Command::AcquireLock           — distributed lock
Command::ReleaseLock           — lock release
Command::AppendStreamEntry{…}  — WalStreamBackend stream data (chat, audit)
Command::DeleteStreamEntry     — stream cleanup
… (others)
```

In the audit 1:1 zone the only `AppendStreamEntry` traffic comes from `AuditHook` writes to `/audit/traces/`; the audit-node learner applies them in order and exposes the aggregated stream to its local `collect/gather` consumer.

In a chat zone the `AppendStreamEntry` traffic is the conversation itself — every envelope (with its `from` field rewritten by the inline mailbox stamping step in `sys_write`, §3.3) replicates to every voter and learner in the zone.
