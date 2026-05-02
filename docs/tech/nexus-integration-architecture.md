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
│  │  AgentRegistry (state)  │   │  (linked Rust crate,        │         │
│  │  mailbox stamping    │   │   trait DI registered into  │         │
│  │                      │   │   AgentRuntimeRegistry)     │         │
│  └────────┬─────────────┘   │  one tokio task per pid     │         │
│           │                 │  cwd = /proc/{pid}/workspace│         │
│  ┌────────▼─────────────┐   │  direct kernel syscalls,    │         │
│  │  Rust service tier   │   │  no stdio, no JSON-RPC      │         │
│  │  ManagedAgentService │   └─────────────────────────────┘         │
│  │  AcpService          │                                           │
│  │   (claude/codex/…)   │   FastAPI bricks (mount, rebac, …)        │
│  │  + AgentRegistry     │   AgentRegistry is a Rust SSOT reachable │
│  │    (Rust SSOT;       │   from Python via `kernel.agent_registry`;│
│  │     PyAgentRegistry) │   ACP / managed_agent reach it directly.  │
│  └──────────────────────┘                                           │
│                                                                      │
│  AcpService spawns external ACP backends as subprocesses with        │
│  StdioPipeBackend → /proc/{pid}/fd/{0,1,2}; managed-agent runtimes   │
│  do NOT use that path because they share the process with nexusd.    │
│                                                                      │
│  gRPC port 2028: NexusVFSService.Call routes ACP +                  │
│    ManagedAgent methods through Rust dispatch                        │
└─────────────────────────────────────────────────────────────────────┘
```

### Constraints

- **One nexusd per sudowork instance.** sudowork starts nexusd at launch and tears it down on quit.
- **Single Python-facing cdylib.** `nexus_kernel` is the only PyO3 extension module. Service-tier rlibs (`services`, `raft`, `library`, `contracts`) link into it.
- **State SSOT.** Agent runtime state (`pid → AgentState`, condvar wakeup, signal semantics, parent/child links, transition validation) lives in `kernel::core::agents::registry::AgentRegistry`. Python callers reach it through `kernel.agent_registry` — a thin PyO3 wrapper handing back `nexus_runtime.AgentDescriptor` instances with attribute getters mirroring `contracts/process_types.py`. There is no Python-side state mirror or dual-write step. Profile config lives on disk under `/agents/{name}/`.
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

`/agents/{name}/` is the stable identity an outsider addresses (other agents, humans on Element). One agent name can spawn many `pid`s — different worktrees, parallel work — and all of them share the same profile.

### 2.1 Agent-name namespace

```
/agents/scode-standard/          ← profile (DT_DIR)
   config.toml                   ← model selection, MCP endpoints, default workspace recipe
   prompts/                      ← system-prompt overrides, per-skill prompts
   skills/                       ← which tool sets are loadable
```

(`/agents/{name}/chat-with-me` exists only for **human** identities —
e.g. `/agents/human-ethan/chat-with-me` is a real DT_STREAM. For agent
names like `scode-standard` it is intentionally absent; addressing
goes through the pid level. See §3.6.)

`chat-with-me` lives at the pid level — `/proc/{pid}/chat-with-me` is
the canonical address, and `/proc/{pid}/workspace/chat-with-me` is a
DT_LINK shortcut to it. The agent-name level (`/agents/{name}/chat-with-me`)
is **not a writable path** — the kernel does not maintain a name-level
aggregator. Callers always have a pid by the time they need to address
an agent (sudowork gets it from `ManagedAgentService.start_session_v1`; in-process
runtimes have their own `pid`); requiring the pid keeps the addressing
model unambiguous and avoids the design questions around multi-instance
fan-out / fan-in.

Three kinds of recipient still share the same DT_STREAM-backed surface:

- **Local agent pid** (e.g. `/proc/p_42/chat-with-me` for the active
  scode-standard instance): real DT_STREAM. Writes append; `sys_watch`
  wakes up readers.
- **Remote identity** (e.g. `human-bob` on a stock Matrix client like
  Element): same DT_STREAM under the hood; reach across instances goes
  through the Matrix C-S adapter (§4) which translates Element's HTTP
  REST traffic into nexus VFS reads / writes against this stream.
- **Local persistent identity** (e.g. `/agents/human-ethan/chat-with-me`):
  a long-lived DT_STREAM owned by the user, not a transient pid. The
  sudowork UI reads it for inbox display, writes for outgoing messages.
  This is the one place `/agents/{name}/...` resolves directly to a
  stream, because the "user" agent has no spawn lifecycle.

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

`/proc/{pid}/status` is served by `AgentStatusResolver` (kernel), reading from the Rust `AgentRegistry`. The pid descriptor — state, exit code, agent name, parent pid, timestamps — stays in `AgentRegistry`; the resolver renders it as JSON at read time.

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
   │ gRPC: NexusVFSService.Call(method="managed_agent.start_session_v1",
   │       payload={agent:"scode-standard", repos:[…], model, owner_id, zone_id})
   ▼
nexusd:
   tonic Call handler
      │ resolve_rust_dispatch -> ("managed_agent", "start_session_v1")
      │ Kernel::dispatch_rust_call -> ManagedAgentService::dispatch
      │ ManagedAgentService::start_session
      │   → AgentRegistry.register (Rust SSOT — no PyO3 boundary)
      │   → AgentRegistry.update_state(WARMING_UP)
      │   → session_id = "sess-" + uuid4()[:12]
      │   → workspace_path = "/proc/{pid}/workspace/"
      ▼
   {session_id, agent_id=pid, workspace_path} → sudowork
```

The actual managed-agent runtime crate (the Rust task that spawns
once `start_session_v1` returns and drives the LLM loop) is wired
separately. ManagedAgentService just plants the AgentRegistry record
+ session row; runtime wire-up evolves on its own cadence.

The provisioner step that builds `/proc/{pid}/workspace/` with OS-level
symlinks for each `WorkspaceRepo` and plants the DT_LINK shortcut at
`/proc/{pid}/workspace/chat-with-me` is tracked separately in
`OPEN-ITEMS.md / sudo-code-grpc-service`. Until it lands, `workspace_path`
is just the path string — the runtime task can still take cwd at it once
nexus VFS exposes the directory.

After spawn, prompts and responses flow through the chat-with-me VFS
surface — same A2A primitive every other agent uses (§3). sudowork
writes prompts to `/proc/{pid}/chat-with-me` (using the `agent_id` it
got from `StartSession`); the kernel rewrites the envelope's `from`
field to sudowork's caller identity (§3.3). The sudo-code task in
nexusd `sys_watch`es its own `/proc/{pid}/chat-with-me` for incoming
prompts and writes responses to `/agents/{user}/chat-with-me`. sudowork's
UI `sys_watch`es the user's chat-with-me for those responses.

**ManagedAgentService surface is intentionally narrow** — only spawn /
cancel / liveness, exposed over `NexusVFSService.Call`:

- `start_session_v1` — payload `{agent, repos, model, owner_id, zone_id}` →
  `{session_id, agent_id, workspace_path}`
- `cancel_v1` — payload `{session_id, mode}` → `{cancelled}`.
  `mode ∈ {turn, session}` — turn aborts the current generation,
  session also reaps the pid.
- `get_session_v1` — payload `{session_id}` →
  `{session_id, agent_id, agent, workspace_path, model, state}`

The dotted form (`managed_agent.start_session_v1`) is canonical;
flat-name fallback (`managed_agent_start_session_v1`) is wired for
backward compat in the gRPC `Call` handler (KERNEL-ARCHITECTURE §8.1).
Prompt / event flow uses the existing `NexusVFSService` gRPC
(`sys_write`, `sys_watch`, `sys_read`) over the chat-with-me paths.
There is no `SendPrompt` or `SubscribeEvents` gRPC — those would
duplicate the A2A surface the rest of the system uses.

#### Runtime registry

The runtime-side trait that ManagedAgentService dispatches against
once `start_session_v1` returns lives next to the service in
`rust/services/src/managed_agent/`. Its DI slot mirrors
`NativeInterceptHook` registration: register a `Box<dyn AgentRuntime>`
for each agent name, the service looks it up at spawn time. Today the
trait surface is:

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

User-global agent settings live at `/agents/{name}/config.toml` inside nexus VFS, sharing the same SSOT as the rest of agent identity.

---

## 3. A2A Communication

A2A, H2A, and A2H share one primitive: write a message to the recipient's `chat-with-me`.

### 3.1 Mailbox

`/agents/{name}/chat-with-me` and `/proc/{pid}/chat-with-me` are append-only message streams. They are normal DT_STREAMs that any caller can write to and the owner can read with `sys_watch`. Federation Raft replicates them across zone members; reach to clients outside the federation (e.g. Element on a stock Matrix server) goes through the Matrix C-S adapter (§4).

### 3.2 The chat-with-me link inside a workspace

Every workspace exposes a sibling `chat-with-me` entry as a DT_LINK to the owning pid's chat:

```
/proc/{pid}/workspace/chat-with-me  ← DT_LINK → /proc/{pid}/chat-with-me
```

So an agent inside another's workspace — say agent A is staged at `/proc/p_other/workspace/projects/nexus/` and wants to talk to whoever owns this nexus repo — writes to `chat-with-me` relative to wherever it stands; the link follows back to the workspace owner's stream.

The link target is resolved by the kernel `route()` step (one hop, with cycle detection). All hooks fire on the resolved target path, so audit, sender stamping, and boundary checks behave identically to a direct `/proc/{pid}/chat-with-me` write.

### 3.3 Sender identity

Mailbox envelope stamping rewrites the message envelope's `from` field
to the caller's authenticated `agent_id` before the write reaches the
backend. LLMs cannot forge identity because the field is overwritten
in-kernel — they do not author it.

The rewrite is implemented as a registered `NativeInterceptHook`
(`MailboxStampingHook`) that delegates the actual envelope policy to
`mailbox_stamping_policy::maybe_stamp_chat_envelope`. Both live under
`rust/services/src/managed_agent/` — owned by `ManagedAgentService`
(the chat-with-me mailbox is a managed-agent concern, not a generic
agent-table concern). The hook struct owns "how to be a hook"
(dispatch wiring + content-clone bypass); the policy module owns
"what to rewrite" (envelope schema, identity guarantee). The hook
trait was widened to
support content rewriting — `on_pre` returns
`Result<HookOutcome, String>` where `HookOutcome::Replace(bytes)` is
the new variant that substitutes write content. Accept/reject hooks
(audit, permission, workspace boundary) all return `HookOutcome::Pass`.

To keep the hot path allocation-free for the writes that don't need
rewriting, hooks declare a `mutating_path_suffix` and the dispatcher
uses it as a double bypass:

- **Layer 1 (no mutating hooks registered)**: empty-Vec check, dispatcher
  goes straight to `WriteHookCtx::content = vec![]` — identical to the
  pre-widening cost.
- **Layer 2 (mutating hook registered, write path doesn't match)**:
  suffix scan returns false, dispatcher still passes `vec![]`. Only
  writes whose path ends in a registered suffix (today: `*/chat-with-me`)
  pay the content clone.

```
agent A writes envelope { to: "scode-standard", body: "ping" }
   │
   ▼
sys_write
   has_mutating_hook_match(path) → true (suffix matches "/chat-with-me")
   clone content into WriteHookCtx
   │
   ▼
dispatch_native_pre → MailboxStampingHook.on_pre
   reads ctx.agent_id = "human-ethan"
   delegates to maybe_stamp_chat_envelope
   returns HookOutcome::Replace({ from:"human-ethan", to:"scode-standard", … })
   │
   ▼
DT_STREAM append (the per-pid stream — `/proc/{pid}/chat-with-me`,
                  possibly reached via the workspace DT_LINK shortcut)
```

### 3.4 Boundary teaching UX

`WorkspaceBoundaryHook` is registered as an `INTERCEPT pre-write` hook scoped to `/proc/{pid}/workspace/{...}`. It compares the caller's `agent_id` to the workspace owner derived from the path (`pid → AgentRegistry.lookup(pid).name`). On mismatch the hook returns `Err(EPERM)` with a structured payload:

```
EPERM at /proc/p_scode/workspace/projects/nexus/src/main.rs:
  This workspace is owned by agent 'scode-standard' (pid p_scode).
  You are 'human-ethan'. To send a message about this workspace, write to:
     /proc/p_scode/workspace/chat-with-me
  (Resolves to /proc/p_scode/chat-with-me via DT_LINK.)
```

The error is intentionally instructive. LLMs that hit it once learn the convention without memory or system-prompt edits — the path layout itself is the SSOT for permissions.

### 3.5 Same primitive across humans and agents

`/agents/human-ethan/chat-with-me` is the canonical Ethan address —
"human" identities have no spawn lifecycle so the path resolves
directly to a long-lived DT_STREAM, no pid indirection needed. From
sudowork's UI Ethan sends through gRPC writes to other agents'
`/proc/{pid}/chat-with-me`; he reads his own through `sys_watch` over
`/agents/human-ethan/chat-with-me`. Other humans (Bob on Element)
reach the same DT_STREAM through the Matrix C-S adapter (§4); the
adapter speaks Matrix REST at the edge and nexus VFS underneath, so
the recipient's transport is invisible to the sender.

### 3.6 Addressing non-human agents

Non-human agent names (`scode-standard`, `claude`, etc.) can map to
zero, one, or many running pids in parallel — different worktrees,
sessions, supervisors. The chat-with-me surface for these agents is
per-pid:

- `/proc/{pid}/chat-with-me` — direct DT_STREAM at the per-pid path.
- `/proc/{pid}/workspace/chat-with-me` — DT_LINK shortcut into the
  same stream from inside the workspace tree.

Callers reach the pid through the lifecycle surface: sudowork from
`managed_agent.start_session_v1` (§2.3); in-process runtimes from
`self.pid`. Per-pid addressing keeps the routing model unambiguous
for the supervised, parallel-worktree workflows this integration
runs.

---

## 4. Cross-instance Transport

Two layers compose. **Within** a federation, raft replicates the
chat-with-me DT_STREAM across every nexus instance voted into the
zone — recipients on any peer node read through their local kernel
just like a same-host write. **Outside** the federation, a Matrix
Client-Server adapter exposes the same DT_STREAMs over Matrix REST so
unmodified third-party clients (Element, FluffyChat, Cinny) can join
conversations without nexus needing a bespoke client.

### 4.1 Federation-internal — raft replication

Every chat-with-me DT_STREAM lives inside its zone's raft cluster. The
write path is `sys_write` → `WalStreamCore` → `Command::AppendStreamEntry`
→ raft commit → state-machine apply on every voter, including remote
peers. Cross-instance reach is the same `sys_watch` wake-up that a
same-host caller sees. Read § 6 for the broader DT_STREAM /
WalStreamBackend contract — there is no separate transport for the
in-federation case.

### 4.2 Federation-external — Matrix C-S adapter

The Matrix C-S adapter is a nexus services-tier component
(`services::matrix_adapter`) that hosts the Matrix Client-Server REST
surface at the edge and translates each call into a nexus VFS gRPC
call underneath. Element opens a TCP socket to the adapter's
`/_matrix/...` HTTP endpoints; the adapter walks the room state and
DT_STREAM contents through `sys_read` / `sys_write` / `stream_read_batch`.

```
Element   ──HTTP REST + JSON──►  services::matrix_adapter  ──gRPC──►  nexus kernel
                                  /_matrix/client/v3/sync                sys_read /
                                  /_matrix/client/v3/rooms/.../send      sys_write /
                                  /_matrix/media/v3/...                  stream_read_batch
                                                                          on chat-with-me
                                                                          DT_STREAMs
```

The adapter ports the Matrix protocol mechanics from upstream
implementations (Tuwunel — Conduit fork, Apache-2.0) — room state DAG
resolution, PDU validation + canonical JSON, `/sync` long-poll, media
repo, push gateway hooks. It does not reuse Tuwunel's storage layer
(RocksDB → ZoneMetaStore + DT_STREAM instead) or its server-to-server
federation (Matrix S2S → raft instead). Identity passes through
nexus's existing `AuthService`: Matrix `/login` returns a session
token that the adapter accepts on subsequent calls and stamps into
`OperationContext`.

### 4.3 Properties retained across both layers

Both layers preserve the kernel-level surfaces that make the
chat-with-me primitive uniform:

- **Permissions** — ReBAC on the DT_STREAM path governs who may write
  / read. Matrix room membership is derived from the same ReBAC
  decision on each `/send` call.
- **Audit** — Every Matrix-originated write reaches the kernel through
  `sys_write`, so `AuditHook` captures it like any other VFS write
  with no Matrix-specific bookkeeping.
- **Single SSOT** — The DT_STREAM at `/agents/human-bob/chat-with-me`
  is authoritative. The Matrix room view, the sudowork chat UI, and a
  federation peer's `sys_watch` all resolve to the same byte sequence;
  the adapter does not maintain a parallel store.

Native sudowork clients keep talking gRPC directly to nexus; only
external Matrix clients touch the adapter.

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

Two storage mechanisms cover everything in this integration; the
Matrix C-S adapter is an edge surface that consumes them, not a third
storage path:

| Mechanism | Where in this doc | Semantics |
|-----------|-------------------|-----------|
| **DT_FILE** (regular file) | sudo-code sessions, profile configs, task lists | Metadata + content via CAS; random read; intra-zone |
| **DT_STREAM + WalStreamBackend** | `chat-with-me`, `/audit/traces/` | Append-only; offset-based read; intra-zone, raft-replicated |

`WalStreamBackend` puts ordered, durable conversation streams (audit, chat) directly into the raft log — the right tradeoff for traffic that needs total order across replicas. `DT_FILE` keeps metadata coordination in raft and stores content in the backend. External clients (Element on Matrix; §4.2) reach the same DT_STREAMs through the Matrix C-S adapter; the adapter holds no state of its own.

---

## 7. Messenger Surface

Three clients sit over the same chat-with-me DT_STREAMs:

- **sudowork chat UI** — talks gRPC directly to nexus. Reads each
  `/agents/{name}/chat-with-me` and `/proc/{pid}/chat-with-me` through
  `stream_read_batch` + `sys_watch`; writes via `sys_write`.
- **Stock Matrix clients** (Element, FluffyChat, Cinny) — connect to
  the Matrix C-S adapter (§4.2) over HTTP. Each Matrix room id maps
  1:1 to a chat-with-me path; `m.room.message` events serialize into
  the same envelope schema sudowork's UI emits.
- **In-process agent runtimes** — read / write `chat-with-me` directly
  through the kernel like any other VFS surface; no gateway involved.

The chat-with-me DT_STREAM is the SSOT. None of the three clients
maintain a parallel inbox; identity, ordering, and audit all derive
from the kernel.

---

## 8. Appendix A: Kernel Dispatch Hook Lifecycle

```
syscall (sys_write, sys_read, …)
    │
    ├─► [CLONE GATE — sys_write only] mutating-suffix bypass
    │         has_mutating_hook_match(path)
    │         → false: WriteHookCtx.content = vec![] (no clone)
    │         → true:  WriteHookCtx.content = clone(content)
    │
    ├─► [PRE] NativeInterceptHook chain
    │         on_pre(ctx) → Result<HookOutcome, String>
    │         → Err to abort  (PermissionHook, WorkspaceBoundaryHook)
    │         → HookOutcome::Pass to proceed unchanged
    │         → HookOutcome::Replace(bytes) to rewrite write content
    │           (MailboxStampingHook on */chat-with-me)
    │
    ├─► [EXECUTE] backend write with replacement.unwrap_or(content)
    │             (redb / CAS / MemoryStreamBackend / WalStreamBackend / …)
    │
    ├─► [POST] NativeInterceptHook chain
    │         on_post(ctx)  ← AuditHook fires here
    │         → fire-and-forget, non-blocking (mpsc try_send)
    │
    └─► [OBSERVE] MutationObserver::on_mutation(FileEvent)
              → StreamEventObserver writes to DT_STREAM (sys_watch wakeup)
              → FileWatcher wakes sys_watch subscribers
```

The clone gate keeps the hot path allocation-free for writes that
do not need rewriting. Each hook declares a `mutating_path_suffix`
at registration; the dispatcher scans the registered suffixes
against the write path and only clones content into `WriteHookCtx`
when one matches. `MailboxStampingHook` declares `/chat-with-me`;
accept/reject hooks (audit, permission, workspace boundary) declare
`None` and the dispatcher passes them an empty content vec. When
multiple mutating hooks register, the chain semantics are
last-write-wins on `HookOutcome::Replace`.

---

## 9. Appendix B: Raft Command Taxonomy

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

In a chat zone the `AppendStreamEntry` traffic is the conversation itself — every envelope (with its `from` field rewritten by `MailboxStampingHook` on `*/chat-with-me`, see §3.3) replicates to every voter and learner in the zone.
