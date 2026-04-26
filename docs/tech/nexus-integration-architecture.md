# Nexus Integration Architecture

**Scope**: sudowork ↔ nexus ↔ sudo-code integration — agent registration, audit trace, IPC/A2A, messenger.

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         sudowork (Electron)                          │
│   Renderer (React UI)  ←IPC bridge→  Main process (Node/TS)         │
│        │                                      │                      │
│   chat UI, audit viewer,           starts nexusd, manages ACP       │
│   messenger UI                     agents, channels, webserver       │
└───────────────────────────────────────┬─────────────────────────────┘
                                        │ HTTP/gRPC (localhost)
                                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│              nexusd + sudo-code  (single process, always-on)         │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Rust Kernel cdylib  (nexus_kernel)                         │    │
│  │  VFSRouter · DCache · Metastore(redb) · LockManager         │    │
│  │  PipeManager(DT_PIPE) · StreamManager(DT_STREAM)            │    │
│  │  FileWatchRegistry(sys_watch) · KernelDispatch(hooks)       │    │
│  │  AuditHook · AgentStatusResolver (procfs view)              │    │
│  └────────────┬────────────────────────┬────────────────────────┘   │
│               │                        │                             │
│  ┌────────────▼─────────┐   ┌──────────▼──────────┐                 │
│  │  Rust services rlib  │   │  sudo-code runtime  │                 │
│  │  AgentTable (state)  │   │  (linked Rust)      │                 │
│  └────────┬─────────────┘   │  file_ops →         │                 │
│           │  PyO3 boundary  │  sys_read/sys_write │                 │
│  ┌────────▼─────────────┐   └─────────────────────┘                 │
│  │  Python service tier │                                           │
│  │  AgentRegistry shim  │   FastAPI bricks (mount, rebac, …)        │
│  │  + admin HTTP API    │                                           │
│  └──────────────────────┘                                           │
│                                                                      │
│  gRPC port 2028: NexusVFSService (Rust tonic — Read/Write/Delete/   │
│                  Ping zero-PyO3; Call still PyO3 bridge)             │
│  HTTP port 12012: nexusd admin API + agent registration              │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Design Constraints

- **One nexusd per sudowork instance.** sudowork launches nexusd at startup (`DynamicNexusService`). All integration targets this single process.
- **Single Python-facing cdylib.** `nexus_kernel` is the only PyO3 extension module; rlib crates (`services`, `raft`, `library`, `contracts`) link source code into it. Two cdylibs cannot reliably share a Python process namespace.
- **State SSOT in Rust.** Agent lifecycle state (pid → AgentState + condvar wakeup) lives in `services::agent_table::AgentTable` (`rust/services/src/agent_table.rs`). The Python `nexus.services.agents.agent_registry.AgentRegistry` is a thin shim that dual-writes every state mutation through the kernel `agent_*` syscalls.
- **Cluster profile.** sudowork uses Nexus's cluster profile — bricks: `IPC`, `FEDERATION`. No PostgreSQL, no RecordStore.
- **Zone = VFS path mount point.** A zone's visibility boundary is its mount-point path. Nodes in the same Raft cluster share that zone's VFS namespace; access to specific sub-paths is governed by ReBAC.

---

## 2. Data Replication Mechanisms

Three orthogonal replication paths exist in the kernel. The distinction matters before choosing where to store audit data or IPC.

### 2.1 Comparison Table

| Mechanism | What enters Raft | What enters Backend | Semantics | Scope |
|-----------|-----------------|---------------------|-----------|-------|
| **DT_FILE** (regular file) | `SetMetadata` (size, etag, timestamps) | Content bytes (CAS-addressed) | overwrite, random read | intra-zone |
| **DT_STREAM + WalStreamBackend** | `AppendStreamEntry` **with data** | nothing | append-only, offset read | intra-zone |
| **Path-level replication** | nothing | content bytes fetched by path or hash | eventually consistent, cross-node | cross-zone capable |

### 2.2 Where Application Data Goes

`WalStreamBackend` is the only mechanism that puts application *data* into the Raft log. This is intentional for ordered, durable, append-only sequences (audit records, event streams):

- Raft log grows with stream data — compaction pressure at high audit rates
- Stream `AppendStreamEntry` shares Raft leader bandwidth with `SetMetadata`, `AcquireLock`, etc. (one `Command` enum, one cluster per zone)

DT_FILE uses Raft only for coordination (metadata), with content in the backend — the conventional pattern. Path-level replication is fully independent of Raft.

---

## 3. Agent Registration & Lifecycle

### 3.1 Registration Flow

sudowork registers each ACP-spawned agent with nexusd's AgentRegistry before launching the child process. The kernel allocates the agent's per-agent VFS namespace and IPC inbox at registration time so the agent can address them by path on first call.

```
sudowork (AcpConnection.connectSudoCodeBackend)
    │  POST http://localhost:12012/api/v2/agents/register
    │       { agent_id, name, grants, ipc: true }
    ▼
nexusd FastAPI admin tier
    │  → AgentRegistry.spawn(...)         ← Python shim
    │       └─► kernel.agent_register(...)  ← Rust AgentTable (SSOT)
    │  → mkdir /agents/{id}/{inbox,outbox,processed,dead_letter,tasks}
    │  → mint per-agent api_key
    ▼
Response: { agent_id, api_key, ipc_inbox }
    │
sudowork
    │  inject NEXUS_AGENT_ID / NEXUS_WORKSPACE / NEXUS_API_KEY into env
    ▼
spawn sudo-code child  (env-driven)
```

The Python `AgentRegistry` owns OS behavior — PID allocation, parent/child tree, signal semantics, transition validation, IPC provisioning. The Rust `AgentTable` owns runtime state — the per-pid `AgentState` field plus a condvar that wakes blocking waiters on every transition.

### 3.2 AgentState Lifecycle

```
REGISTERED → WARMING_UP → READY ↔ BUSY → TERMINATED
                              ↓     ↓
                          SUSPENDED ─┘
                              ↓
                          TERMINATED
```

`kernel.agent_wait(pid, target_state, timeout_ms)` releases the GIL via `py.detach()` and parks on the per-pid condvar — Python callers get a blocking wait without pinning the interpreter.

### 3.3 Procfs View

`AgentStatusResolver` is a kernel-internal `PathResolver` (`rust/kernel/src/agent_status_resolver.rs`) that serves `/{zone}/proc/{pid}/status` from the `AgentTable`. Reads return the agent descriptor as JSON; the path is generated at read time, like Linux `/proc/{pid}/status`.

---

## 4. Audit Trace

### 4.1 Surface

| Concern | What | Source |
|---------|------|--------|
| **VFS operation trace** | Every file read/write/delete/rename through nexus kernel | Rust `AuditHook` on kernel dispatch (POST phase) |
| **Exchange audit** | Agent economic transactions | Python exchange service |

Both write to **DT_STREAM with WalStreamBackend** — ordered, durable, Raft-replicated.

### 4.2 AuditHook Pipeline

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

### 4.3 Auto-Wiring on Zone Create / Join

`zone_create(zone_id, audit=true)` and `zone_join(zone_id, as_learner, audit=true)` are kernel syscalls that auto-wire the AuditHook from Rust before any `sys_*` mutation can race in. The legacy Python wire-up (`_init_audit_hook` in `nexus/__init__.py`) only handles the boot-time root-zone hook for federation deployments; every other zone gets its hook through the syscall flag.

### 4.4 AuditRecord Schema

```json
{
  "v": 1,
  "ts": "2026-04-26T10:00:00.123Z",
  "trace_id": "req_a1b2c3d4",
  "agent_id": "agent:sudo-code",
  "op": "write",
  "path": "/workspace/project/src/main.rs",
  "zone_id": "root",
  "size_bytes": 1024,
  "status": "ok",
  "duration_us": 42
}
```

### 4.5 Central Audit Zone

Each production node shares a dedicated 1:1 zone with the audit-node. `AuditHook` writes formatted `AuditRecord` entries to a DT_STREAM in that shared zone; the audit-node reads and gathers them locally.

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

**1:1 zone (vs. learning the production zone):**
- Minimum privilege: audit-node sees only the DT_STREAM it needs, not all production zone Raft commands
- AuditHook formats the `AuditRecord` explicitly — audit-node receives structured audit data, not raw kernel internals
- Production zone Raft quorum is unaffected (audit-node is in a separate Raft cluster)

**audit-node as learner:** within each 1:1 zone, audit-node joins via `zone_join(zone_id, as_learner=true, audit=true)`. AddLearnerNode is proposed by the leader so quorum stays driven by production voters; audit loss is preferable to blocking production writes.

**Multiple audit consumers** (CEO audit, compliance audit) each get their own audit nexusd — each becoming a learner of the same 1:1 zones, or reading from a remote-mounted stream path once cross-zone federation is established.

---

## 5. sudo-code ↔ nexus VFS

**Same process, direct Rust syscalls.**

sudo-code and nexusd run in the same OS process. sudo-code links against `nexus_kernel` as a Rust library and calls kernel syscalls directly — no gRPC, no network hop:

```
sudowork (Electron)
    │  registers agent → spawns combined nexusd + sudo-code process
    │
    └─► nexusd+sudo-code (single Rust process)
           │
           ├── nexus_kernel cdylib (shared state)
           │       VFSRouter · Metastore · LockManager · …
           │       AgentTable (services rlib linked into the cdylib)
           │
           └── sudo-code runtime (Rust)
                   file_ops.rs calls kernel::sys_read / sys_write directly
                   no socket, no serialisation, no auth header
```

When `NEXUS_AGENT_ID` is set in the environment (injected by sudowork at registration), sudo-code resolves its workspace at `/agents/{NEXUS_AGENT_ID}/` and uses `NEXUS_API_KEY` for the few HTTP-only admin calls (e.g. exchange transfers). The `std::fs` fallback remains for standalone (kernel-less) development mode.

---

## 6. IPC / A2A

### 6.1 IPC over VFS

IPC is implemented as VFS operations on canonical agent paths. Messages are files; delivery is filesystem events.

```
/agents/{agent_id}/
├── AGENT.json          # Agent descriptor
├── inbox/              # Incoming MessageEnvelope JSON files
├── outbox/             # Sent messages (audit trail)
├── processed/          # Successfully handled messages
├── dead_letter/        # Failed messages
└── tasks/              # Task persistence
```

The directory tree is created at registration time (§3.1) so senders can address `inbox/` immediately.

### 6.2 Message Delivery Flow

```
Sender
    │  sys_write("/agents/recipient/inbox/{ts}_{id}.json", envelope)
    │  → AuditHook fires automatically (IPC is auditable)
    │
Recipient
    │  sys_watch("/agents/my-agent/inbox/**", timeout_ms=30_000)
    │  → returns FileEvent when new file appears
    │  sys_read(event.path)
    │  sys_rename(event.path, processed_path)
```

### 6.3 MessageEnvelope Wire Format

```json
{
  "nexus_message": "1.0",
  "id": "msg_7f3a9b2c",
  "from": "agent:analyst",
  "to": "agent:reviewer",
  "type": "task",
  "correlation_id": "task_42",
  "timestamp": "2026-04-26T10:00:00Z",
  "ttl_seconds": 3600,
  "payload": { "action": "review_document", "path": "/workspace/doc.md" }
}
```

### 6.4 nexus-ipc Rust API

```rust
use nexus_kernel::ipc::{send_message, MessageEnvelope};

send_message(&kernel, "agent:reviewer", envelope)?;
let msg = wait_for_message(&kernel, "agent:analyst", timeout_ms)?;
```

Internally: `sys_write` + `sys_watch` — no new transport.

### 6.5 Pipe / Stream Primitives

For non-message IPC (raw byte streams between agents, or audit-node ingestion), the kernel exposes:

| Primitive | Purpose |
|-----------|---------|
| `PipeManager::splice(from, to, count)` | Linux `splice(2)` analogue — zero-copy intra-process move between two DT_PIPEs |
| `StreamManager::forward(from, to, from_offset)` | Non-destructive read-then-append between DT_STREAMs; returns `(forwarded, next_offset)` for resumable ingestion |
| `RemotePipeBackend` | Proxies DT_PIPE push/pop across nexusd nodes via JSON-RPC over `RpcTransport` |

### 6.6 Cross-Zone IPC

Cross-zone messages route through VFS federation — `sys_write` to a remote-mounted path uses `FederationClient` gRPC. No special A2A code needed beyond the federation layer.

---

## 7. Messenger

**Nostr relay as nexus service** (`rust/kernel/src/nostr_relay.rs`).

Rationale:
- Protocol simplicity: NIP-01 event = signed JSON; relay stores and filters
- Cryptographic identity: nexus agent key ↔ Nostr keypair (one identity)
- Polished clients: Damus (iOS), Amethyst (Android), Snort (web)
- NIP-90 Data Vending Machine: standard AI task request/response over Nostr

### Nostr Relay Architecture

```
Nostr client (WebSocket, NIP-01)
    ▼
nostr_relay service  (Rust, nostr_relay.rs)
    ├── Event ingestion: verify secp256k1 sig → sys_write("/nostr/events/{id}.json")
    ├── Subscription: filter(kind/pubkey/tags/since/until) → sys_watch → push
    └── Federation: event files replicate to Raft peers automatically
```

### Nostr kind → Platform mapping

| kind | Platform meaning |
|------|-----------------|
| 1 | Short text / agent status |
| 4, 44 | Encrypted DM (NIP-04 / NIP-44) |
| 9735 | Zap → nexus exchange transfer |
| 5000–5999 | NIP-90 DVM task request |
| 6000–6999 | NIP-90 DVM task result |

---

## 8. Appendix A: Kernel Dispatch Hook Lifecycle

```
syscall (sys_write, sys_read, …)
    │
    ├─► [PRE] HookRegistry::get_pre_hook_impls(op)
    │         NativeInterceptHook::on_pre(ctx)
    │         → can return Err to abort (permission check, quota)
    │
    ├─► [EXECUTE] actual backend write (redb / CAS / MemoryStreamBackend / …)
    │
    ├─► [POST] HookRegistry::get_post_hook_impls(op)
    │         NativeInterceptHook::on_post(ctx)  ← AuditHook fires here
    │         → fire-and-forget, non-blocking (mpsc try_send)
    │
    └─► [OBSERVE] MutationObserver::on_mutation(FileEvent)
              → StreamEventObserver writes to DT_STREAM (sys_watch wakeup)
              → FileWatcher wakes sys_watch subscribers
```

---

## 9. Appendix B: Raft Command Taxonomy

All commands in a zone's Raft cluster share a single `Command` enum (`state_machine.rs`):

```
Command::SetMetadata      — VFS file/dir metadata (path, size, etag, …)
Command::DeleteMetadata   — VFS delete
Command::AcquireLock      — distributed lock
Command::ReleaseLock      — lock release
Command::AppendStreamEntry{ key, data }  — WalStreamBackend stream data
Command::DeleteStreamEntry — stream cleanup
… (others)
```

In the audit 1:1 zone the only `AppendStreamEntry` traffic comes from `AuditHook` writes to `/audit/traces/`; the audit-node learner applies them in order and exposes the aggregated stream to its local `collect/gather` consumer.
