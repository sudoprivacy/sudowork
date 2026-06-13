# pwd-login auto-fill — spike findings (gating §7)

Date: 2026-06-13
Status: **investigation complete; live confirmation pending** (needs a running nexusd-cluster).
Relates to: `2026-06-13-pwd-login-autofill-design.md` §5 (secret delivery) / §7 (spike).
Spike script: `scripts/spikes/pwd_login_secret_read_spike.py`

## Question

Can the ai-dev-browser **Python** process (the filler) read a Vault secret **directly**,
so plaintext never relays through the agent/LLM, the renderer, or sudowork-main — i.e.
is **Option C** viable, vs. falling back to volatile DT_PIPE or OS stdin?

## How sudowork reads secrets today (established from this repo)

- Canonical path: gRPC to **nexusd-cluster `http://localhost:12022`**, via the native Rust
  addon `nexus-napi`, calling `NexusGrpcClient.callBinary("password-vault.secret_get", <proto>, authToken)`.
  Wire format `nexus.secrets.v1` (`GetSecretRequest{namespace,key,version}` → `GetSecretResponse{value}`).
  See `src/common/nexus/nexus-secret-client.ts:81-95` + `nexus-vfs-client.ts:60-67`.
- Phase-1 pwd-login still uses the **REST gateway** on the same host:
  `GET /api/v2/password_vault/{title}` → `{ password, ... }`, Bearer apiKey when present.
  See `src/process/services/pwdLogin/pwdLoginService.ts:65-98` + `src/common/nexus/fetch-client.ts:235-237`.
- Endpoint + apiKey are resolved from `./nexus.yaml` → `~/.nexus/config.yaml` → env
  (`NEXUS_URL`/`NEXUS_API_KEY`), default `http://localhost:12022` (`src/common/nexus/config.ts`).

## Cross-repo investigation (nexus / nexus-vfs / nexus-python / ai-dev-browser)

| Question | Finding |
| --- | --- |
| Existing Python gRPC client for nexusd-cluster? | **No.** `nexus-python` is HTTP/JSON-RPC only (`httpx`), no `grpcio`/`protobuf`, no secrets API. |
| gRPC service def | Generic `Call` RPC `CallRequest{method,payload,auth_token}` in `nexus-vfs/proto/nexus/grpc/vfs/vfs.proto`; secrets in `nexus/rust/services/proto/nexus/secrets/v1/secrets.proto`. Dispatch is dot-notation `password-vault.secret_get` (`nexus-vfs/rust/transport/src/call_dispatch.rs`). |
| Auth model | Localhost is **permissive**: `NoAuth` accepts any/empty token and returns an admin `OperationContext` (`nexus-vfs/rust/transport/src/auth.rs:34-46`). The `auth_token` is a flat bearer — **no per-secret capability scoping exists yet** on the server. |
| Vault as a VFS path? | **No.** The vault is a cdylib service plugin reached via the `Call` RPC, not mounted at a readable `/secrets/...` path. So "read the secret" = the `password-vault.secret_get` call (or the REST gateway), not a `read(path)`. |
| TLS? | gRPC server has optional TLS (`nexus-vfs/rust/transport/src/grpc.rs`). Localhost dev appears plaintext; confirm for any non-localhost/prod use. |

## Conclusion (predicted: Option C is viable)

A standalone Python process on the same machine **can** read the secret, two ways, ranked by least-new-code:

1. **REST gateway, stdlib only** — `GET http://localhost:12022/api/v2/password_vault/{title}`.
   Zero new deps (`urllib`), reuses the exact endpoint Phase-1 already calls. ← spike script uses this.
2. **gRPC `password-vault.secret_get`** — canonical but needs `grpcio` + generated `secrets_pb2` stubs
   shipped into the Python env. More code; keep as the fallback if the REST gateway is retired.

Auth is not a blocker on localhost (empty token → admin). **Capability-scoping does not exist server-side**,
so the design's "capability-scoped" wording is aspirational; Option C still satisfies the *hard rule*
(plaintext only ever lives in the filler's Python memory, never the agent/renderer/disk). A real
capability scope would be a separate nexus-side ask, not required for v1.

## Live confirmation — run during the next dev session

nexusd-cluster only listens while the sudowork dev build is up, so the spike can't run headless.
With the app running and a test entry stored in 密钥管理:

```
python scripts/spikes/pwd_login_secret_read_spike.py --title "<entry title>"
# exit 0 → Option C confirmed: implement the direct-read filler (replace dispatchPwdFill)
# exit 3 → reachable but read denied → revisit auth/capability, else DT_PIPE/stdin
# exit 4 → cluster not reachable → app not up / wrong port
```

The script never prints the secret value (only its length) — honors the plaintext rule.

## Decision record (unchanged from design §5)

Build **exactly** the delivery the live spike validates. Predicted = Option C (REST direct-read).
Do **not** write the fill-delivery code until the live run returns exit 0. DT_PIPE (in-memory only,
never `WalPipeCore`) and OS stdin remain the documented fallbacks if it returns 3.
