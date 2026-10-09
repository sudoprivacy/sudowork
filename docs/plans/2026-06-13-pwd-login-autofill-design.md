# pwd_login auto-fill — design (Phase 2, agent/sudowork-driven)

Date: 2026-06-13
Status: design agreed; implementation not started (first step is a spike — see §7)
Owner: sudowork/sudocode team (we own this layer; no product-team gate)
Related code: `src/process/services/pwdLogin/` (existing Phase-1 scaffolding), `src/common/nexus/nexus-secret-client.ts`, `src/renderer/components/PwdLoginApprovalModal.tsx`
Supersedes the idea that the password fill must be a NEW ai-dev-browser sidechannel command (`dispatchPwdFill` STUB). New approach needs nothing from browser-ai — see §4.

## 1. Goal

Let a user log in to a (possibly custom / unknown) website without scanning a QR each time, by storing their credentials once in the secret store (密钥管理 / Vault) and having sudowork auto-fill the login form on demand. Concretely de-risks the "unattended login / cookie expiry" pain in long-running scheduled tasks (e.g. nightly reconciliation).

Hard rule (non-negotiable): **the plaintext password must never enter the agent/LLM context, the renderer, or disk.** Minimize the number of code paths that ever hold plaintext — ideally exactly one.

## 2. UX flow (division of labor) — this is the e2e-test contract

sudowork automates ALL of:
1. **Explore** the target site (agent drives ai-dev-browser).
2. **Write selectors** — identify `usernameSelector`, `passwordSelector`, `submitSelector`, and the login `url` + `strategy` (`single_step` | `two_step`).
3. **Test the selectors** using the browser **tool** (so we know they actually locate the fields).
4. **Create a Vault entry** containing the selectors (see §3).
5. Later, on demand: **real fill + submit** using the entry (selectors + credentials).

The human does ONLY one thing: **fill username + password** into that entry via the 密钥管理 UI. The real fill (step 5) happens after the credentials are present.

Selectors / url / strategy are NOT secret (agent may freely hold them). Username + password ARE secret.

## 3. Vault entry schema (selectors live IN the entry)

Adopted improvement over the hardcoded known-site map (`pwdAdapters.ts` `PwdAdapter`), so **custom/unknown sites need no code change** — the explore step writes the selectors into the entry:

```
{
  url:              string,   // login page URL
  usernameSelector: string,   // CSS
  passwordSelector: string,   // CSS
  submitSelector:   string,   // CSS
  strategy:         'single_step' | 'two_step',
  // --- secret part ---
  username:         string,   // user-filled
  password:         string,   // user-filled, never leaves vault as plaintext to agent
}
```

`pwdAdapters.ts` stays as the built-in known-site fallback (GitHub/Google/…); the entry-stored selectors take precedence for custom sites.

## 4. Fill mechanism — use ai-dev-browser CORE functions (not a separate path)

Fill via `from ai_dev_browser.core import type_text, js_evaluate`:
- Prefer **`type_text`** (real keystroke/input/change events — many forms only register on real events).
- `js_evaluate(tab, expr)` (core/page.py — its own docstring recommends importing it) as fallback.

**Why core, not a TS/CDP fill:** ai-dev-browser tool↔core are 1:1, so filling with the same core fn behaves identically to how the selector was tested in step 3. A separate TS/CDP fill path would diverge from what was tested → a selector that tested-good could behave differently at fill time. So we reuse core and do NOT write a second fill path.

`--port` auto-connects to the already-running browser (same logged-in context the explore step used).

`screenshot_lock` from the old design is dropped for v1 — password `<input>` renders masked (•••), so a screenshot can't capture plaintext.

## 5. Secret delivery — Option C (agreed, cleanest)

The python filler reads the secret **directly from the Vault by key**, so plaintext is never relayed through the agent/LLM and never even relayed through sudowork-main as plaintext.

Architecture of the read:
- Vault is a **cdylib plugin** (`nexus/rust/services/vault/`) loaded into **nexusd-cluster** via plugin-abi (`nexus-vfs/rust/kernel/src/kernel/plugins/loader.rs`).
- It exposes secrets as a **VFS mount** — so reading a secret = a **capability-scoped nexus-vfs path read via nexusd-cluster** (gRPC / kernel ABI). NOT the python `nexus/src/nexus` server package (that's server-flavored, wrong tool).
- sudowork-main / sudocode already talk to nexusd-cluster; the filler needs the same lightweight client + a scope/capability for the one approved secret.

Path: `vault (nexus-vfs) → python filler → browser`. Agent only ever passes the entry KEY (non-secret).

### Fallback ladder (DECISION RECORD ONLY — do NOT build until the spike forces it)
1. **C** — filler reads secret from nexus-vfs path directly (preferred).
2. **volatile DT_PIPE** — sudowork-main writes plaintext to an in-memory nexus-vfs pipe the filler reads. ⚠️ MUST pin the in-memory backend; NEVER the WAL-durable `WalPipeCore` variant (would land plaintext on disk).
3. **OS stdin** — last resort; main pipes plaintext to the filler subprocess via stdin (in-memory, no disk, but not nexus-native).

Build EXACTLY the one the spike validates — each extra plaintext path is attack surface.

## 6. Build on existing scaffolding (already production code)

- `src/process/services/pwdLogin/pwdLoginService.ts` — `handlePwdLogin` flow; `dispatchPwdFill` is the STUB to replace with the §4/§5 mechanism.
- `src/process/services/pwdLogin/memorySafety.ts` — `bufferToBase64AndZero`; keep the zero-after-use discipline on any plaintext buffer (incl. python side).
- `src/process/services/pwdLogin/pwdAdapters.ts` — known-site fallback selectors.
- `src/process/services/pwdLogin/errors.ts` — `PwdLoginErrorCode`.
- `PwdLoginApprovalModal.tsx` + ApprovalStore — user approval (allow_once/allow_always); keep.
- `NexusSecretClient` (`secret_put/get/delete`) + Secrets UI (`SettingsModal/contents/secrets/`).
- IPC: `ipcBridge.pwdLogin.start` (`pwd.login.start`). This is pwd_login **Phase 2 (agent-initiated)** per ipcBridge comment.

## 7. Spike (gating — DO THIS FIRST)

Question: can the ai-dev-browser python process do a **capability-scoped nexus-vfs secret read via nexusd-cluster**?
- Yes → implement Option C.
- Read not possible but write is → volatile DT_PIPE.
- No nexus access at all from that python → OS stdin fallback.

Until the spike resolves, do not write the fill delivery code.

## 8. e2e tests (planned)

Test the §2 contract end-to-end against a real-ish login form:
- explore → selectors written → tested → entry created → user fills creds → fill+submit → logged-in.
- Assert plaintext never appears in agent/LLM transcript, renderer IPC, or disk.
- Assert memory zeroing on every plaintext buffer.

## 9. Coordination

Option C/DT_PIPE need **nothing from browser-ai** (we use ai-dev-browser as a library + nexus-vfs we own). If the spike forces something on the browser side, send browser-ai a precise spec (the only candidate ask would be a non-leaking secret-input entry point). Attribute any ai-dev-browser upstream changes to "browser ai".
