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

DT_LINK kernel primitive — VFS-internal symlink. New entry type, kernel `route()`
follows targets one hop with cycle detection, `sys_setattr` accepts a `link_target`
field, `sys_stat` reports the entry as a link.

Owner: nexus repo. Blocks: chat-with-me workspace shortcut, `/proc/{pid}/agent`
back-reference to image.

## mailbox-stamping-hook

`MailboxStampingHook` — INTERCEPT pre-write hook on every path matching `*/chat-with-me`.
Reads `caller_agent_id` from kernel auth context; rewrites the envelope's `from` field
in place. LLMs cannot author the field.

Owner: nexus repo (kernel hook crate). Blocks: A2A sender identity guarantee.

## workspace-boundary-hook

`WorkspaceBoundaryHook` — INTERCEPT pre-write hook scoped to `/proc/{pid}/workspace/`.
Compares caller `agent_id` to workspace owner derived from path; on mismatch returns
`Err(EPERM)` with the structured teaching payload (see design doc §3.4).

Owner: nexus repo (kernel hook crate). Blocks: cross-agent boundary teaching.

## nostr-backend-driver

`NostrBackend` — bidirectional VFS storage driver. Outbound: NIP-04 EVENT, encrypted
to recipient npub, signed with sender's nexus identity key. Inbound: relay subscription
filter, decrypt, append to local mirror, emit FileEvent for sys_watch.

Owner: nexus repo (likely `rust/kernel/src/nostr_backend.rs`). Blocks: cross-instance
A2A and human-on-Damus reach.

## sudo-code-grpc-service

gRPC `SudoCodeService` — `StartSession`, `SendPrompt`, `SubscribeEvents`, `Cancel`.
Proto in nexus repo, server impl in nexus, TypeScript client in this repo.
Replaces the prior ACP-child-process integration path.

Owner: split — nexus repo for proto + impl, this repo for TS client.
Blocks: sudowork ↔ sudo-code integration.

## image-chat-aggregator

PathResolver for `/agents/{name}/chat-with-me` when the image has one or more
running pids — fans writes to every running pid's chat-with-me, merges reads.
Skipped when the path is mounted with `NostrBackend` (remote identity case).

Owner: nexus repo (kernel resolver). Blocks: addressing local images by name without
having to know a specific pid.

## sudocode-config-migration

sudo-code currently writes user-global settings to `~/.nexus/sudocode/settings.toml`
on the host filesystem. Migrate to `/agents/{name}/config.toml` inside nexus VFS
so configuration sits under the same SSOT as the rest of agent identity.

Owner: sudo-code repo. Blocks: full SSOT for agent identity surface.

## auth-fallback

This repo's nexus client (currently `src/common/nexus/agentRegistry.ts`, eventually
the gRPC client) assumes the sudowork profile boots nexus with `--auth-type none`.
When that assumption no longer holds, the client must try unauthenticated first
and fall back to a bearer token from a sudowork-side credential store.

Owner: this repo. Blocks: hardening sudowork against multi-tenant deployment.
