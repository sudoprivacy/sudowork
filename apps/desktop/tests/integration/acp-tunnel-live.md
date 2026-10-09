# Published ACP tunnel tests

`acpTunnelLive.integration.test.ts` boots an isolated published daemon and runs
the real `GrpcAcpTransport` against the published scode from
`src/shared/runtime-versions.json`. Binaries with another version fail the test.
It never connects to an existing daemon or writes to the user's workspace/config.

## Run locally

From `apps/desktop`, run `node scripts/dev/download-acp-test-runtime.mjs` (requires
GitHub CLI). It verifies the release SHA256 manifests and the pinned daemon hash,
extracts into a new temporary directory, and prints `SCODE_BIN` and
`NEXUS_CLUSTER_BIN`. Export those two paths in your shell.

For the protocol/process lifecycle tests, set `SUDOWORK_ACP_TUNNEL_E2E=1`.
For real model calls, set:

```text
SUDOWORK_ACP_TUNNEL_LIVE=1
SUDOWORK_ACP_LIVE_CONFIG=<absolute path to your sudocode.json>
SUDOWORK_ACP_LIVE_PROFILE=sudorouter
SUDOWORK_ACP_TEST_MODEL=claude-sonnet-4-6
```

The last two values are defaults. The selected proxy profile must contain
`apiKey` and `baseUrl`. Only that account is copied into the test's temporary
config; personal hooks, MCP servers and settings are not copied. Credentials are
never printed or stored in the repository. Live mode fails if credentials are
missing; a requested live run cannot pass by skipping.

Live shell execution needs `sh`; on Windows the test adds Git for Windows'
`bin` directory to the agent's PATH. `SUDOWORK_ACP_SHELL_DIR` selects another
installation. The shell is checked before a model call. Node.js comes from the
test runner's absolute executable path, so the agent need not find it on PATH.

To validate an unreleased scode fix, set `SCODE_BIN` to the locally built binary
and `SUDOWORK_ACP_SCODE_VERSION` to its version. This is an explicit source-build
comparison; the PR job leaves this override unset and tests the release pin.

Run `bunx vitest run tests/integration/acpTunnelLive.integration.test.ts --reporter=verbose`.

## Acceptance workflows

1. Initialize scode over gRPC -> create an ACP session -> cancel idle work ->
   create another session -> close transport -> verify the OS child was reaped.
   Separately, crash scode -> observe the tunnel disconnect -> start a replacement
   session through the same daemon.
2. Read randomized `input.json` -> model writes `result.json` with the original
   token and calculated total -> wait beyond the production long-poll window ->
   use that result to create `continued.json` in the same session.
3. Model starts a shell command -> wait for its unique on-disk marker -> cancel
   that turn -> require `stopReason=cancelled` and the tool process to exit -> use the previous output to
   create and verify `recovered.json` in the same session.

These are API/transport workflows, so the agent uses its production ACP pipe
protocol rather than a terminal emulator. The model, tools, filesystem and
daemon are real. Assertions check file contents, streamed responses, cancellation
and process cleanup. A handshake-only run is not evidence of live model parity.

The `ACP tunnel E2E` PR workflow runs the published pair on Linux and Windows.
An explicit workflow dispatch with `live=true` additionally uses the repository
secret `ACP_LIVE_CONFIG_JSON` (a sudocode config with a `sudorouter` proxy profile).
If the secret is absent the job fails. Local live runs are required before
committing changes to this path; ordinary CI never substitutes a mock model.

## Live validation (2026-10-02)

The process-exit assertion reproduced a real defect in the pinned scode 0.2.11:
ACP reported cancellation while the shell's Node child kept running. The live
suite fails on that release at `cancelled tool descendant exited`. Cleanup runs
after the assertion so it cannot conceal the failure.

The final published pair, scode `0.2.21` and nexusd-cluster `0.7.26`, passed
all three tunnel workflows on Windows and Docker Desktop Linux with real
`claude-sonnet-4-6` API calls and no version override. The release archives were
checked against their published SHA256 manifests. Both platforms also passed
the companion scode live PTY cancellation and timeout tests (2/2), using the
same published binaries. Each test verifies descendant exit and a successful
follow-up turn.

[scode 0.2.21](https://github.com/sudoprivacy/sudocode/releases/tag/v0.2.21)
contains the process-group fix from
[sudocode#843](https://github.com/sudoprivacy/sudocode/pull/843).
The ordinary protocol CI job covers process/session behavior; real model
cancellation is covered by the explicit live workflow and these local runs.

## Runtime release migration

The daemon now comes from `nexi-lab/nexus-vfs` (`v0.7.26`, plugin ABI 7),
with vault `0.5.66`, local-connector `0.4.64`, and fuse `0.6.64` from
`nexi-lab/nexus`. COS uses `nexus-vfs/release/vVERSION`; the discontinued
`nexusd-cluster/release` assembly is no longer the download source.
Versions and SHA256 digests must change together. Plugin platform metadata
lives in `src/shared/runtime-plugins.json` and is shared by packaging and
the app's runtime installers.

From `apps/desktop`, run the actual installation workflow:

```sh
SUDOWORK_RUNTIME_E2E=1 bunx vitest run tests/integration/vault-signed-download.integration.test.ts
```

On PowerShell, set `$env:SUDOWORK_RUNTIME_E2E='1'` before the Vitest command.
It uses temporary installation, resource, data, and identity directories.
It downloads and verifies the published archives, loads every platform plugin,
writes a randomized secret through the production client, restarts the daemon,
reads and rotates that secret, then exercises bundled and remote reinstallation
with stale daemon and plugin markers. The PR Integration Smoke workflow runs
this on Windows and Linux without model credentials.

For isolated manual downloads, the production build script accepts
`SUDOWORK_NEXUS_INSTALL_ROOT` and `SUDOWORK_NEXUS_RESOURCES_DIR`.

### Data from the previous release

The same suite has an additional live upgrade workflow for Windows/Linux x64.
Set `SUDOWORK_RUNTIME_LEGACY_E2E=1`, with:

- `SUDOWORK_LEGACY_CLUSTER_BIN`: the extracted `nexusd-cluster` from
  [nexusd-cluster-v0.1.5](https://github.com/nexi-lab/nexus/releases/tag/nexusd-cluster-v0.1.5).
- `SUDOWORK_LEGACY_VAULT_ARCHIVE`: the platform archive from
  [vault-v0.5.56](https://github.com/nexi-lab/nexus/releases/tag/vault-v0.5.56).

The test checks the old daemon version/ABI and the old vault archive's pinned
SHA256. It boots that pair with fresh data and identity directories, writes a
randomized secret, then boots the new pair with those same directories. It
requires the secret to remain readable, rotates it, restarts again, checks both
versions, and deletes it. The old plugin is extracted into its own directory;
the fixture never uses the user's installed daemon, plugins, or vault data.

The installation suite passed on Windows and Docker Desktop Linux (3/3 on
each), including the legacy upgrade. Linux additionally exercised a namespace
and key containing colons, which the previous Linux release allowed. CI runs
the two installation/reinstallation workflows; the legacy upgrade is an
explicit local live test using the verified old release fixtures.
