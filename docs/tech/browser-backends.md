# Browser backend migration

Sudowork keeps `browser` as the agent-facing entry point. The default backend
is the existing vendored ai-dev-browser. The Rust backend is an opt-in trial:

```powershell
$env:SUDOWORK_BROWSER_BACKEND = 'sudohand'
$env:SUDOWORK_SUDOHAND_PATH = 'C:\tools\suh.exe'
bun run start
```

On macOS/Linux, export the same variables before starting Sudowork. If
`SUDOWORK_SUDOHAND_PATH` is absent, the wrapper resolves `suh` from PATH.
Remove the two variables to return to the default on the next application
start. Selection applies to newly launched agent processes.

This trial does not bundle or release sudohand. The tested source revision is
in [the test reference](../../apps/desktop/tests/integration/fixtures/sudohand-reference.json).
The [migration plan](https://github.com/sudoprivacy/sudohand/blob/main/docs/migrations/ai-dev-browser-to-sudohand.md)
tracks remaining browser features, other consumers and distribution gates.

## Behavior

- `browser --list` reads the selected backend's catalog. Rust arguments come
  from `suh describe --domain browser --with-args`.
- `browser <tool> --help` and parser error usage retain the `browser` entry
  point. Native browser JSON, result paths and exit codes pass through.
- A missing executable or failed operation produces one result. The wrapper
  never retries an action through another backend.
- Results retain the existing sidechannel identity, command hash and payload.
  Reporting failures do not repeat the browser action.
- `AI_DEV_BROWSER_REDIRECT` also applies to the Rust backend.
- App startup installs the wrappers for ACP agents, including installations
  that have never started the Sudoclaw gateway.
- Development startup resolves the Python package from the monorepo vendor
  directory. Skill hints resolve installed links to paths the agent can read.

The legacy sidechannel and the active scode image-reading path have separate
acceptance tests. Receiving a screenshot path over HTTP alone does not prove
that the model or the conversation UI can see the picture.

## Live acceptance

The [2026-10-02 acceptance record](browser-backend-acceptance.json) covers both
backends through Chrome and through the real model/application UI. The full
Windows unit suite still has 15 failures reproduced on the unchanged baseline;
they are recorded separately from the passing browser acceptance.

From `apps/desktop`, with Chrome, Python browser dependencies and the pinned
`suh` binary installed:

```powershell
$env:BROWSER_TEST_PYTHON = 'C:\path\to\venv\Scripts\python.exe'
$env:SUDOWORK_SUDOHAND_PATH = 'C:\path\to\suh.exe'
bun run test:browser-live
```

The test launches actual Chrome for each backend and drives a local reservation
page. It uses discovered refs, types Chinese text, submits a trusted event,
checks the server's receipt and submission count, captures a real image, then
reloads the page to verify persistence. Every invocation is checked against the
production HTTP result receiver. Recovery cases cover a stale target, invalid
arguments, a missing Rust executable and redirected access. PR CI runs this
suite on Windows and Linux; missing prerequisites fail the job.

The paid model/UI test is
[`live_browser_backend.py`](../../apps/desktop/tests/e2e/live_browser_backend.py).
It requires a running disposable Sudowork profile configured with a real
provider and the Rust backend. Select Sudo Code on a fresh task, then run:

```powershell
python tests/e2e/live_browser_backend.py --app-port 9276 --backend sudohand `
  --database C:\test-profile\.nexus\sudowork.db `
  --suh C:\path\to\suh.exe --output C:\test-artifacts\browser
```

The model reads the installed skill, discovers the wrapper tools, reserves one
seat, captures an image and reads a random badge present only in image pixels.
Assertions check the server-side effect, receipt, badge, execution tool choice
and absence of failed shell calls. It verifies the backend's actual catalog,
waits for the generated attachment, clicks its chat card, and checks that the
application preview loads the captured image at its original dimensions.
This uses the production ACP conversation path. A protocol-only or mock-model
run is not a substitute. Restart with the backend variables removed and use
`--backend ai-dev-browser` to exercise the default and rollback path. The test
harness still uses `--suh` for its own fixture and application inspection.

For Windows isolation, set Electron's `home`, `appData` and `userData` paths
before importing the application, and set the child environment's HOME and
USERPROFILE to the same disposable home. Check the resolved paths before
startup: changing USERPROFILE alone does not isolate Electron. Keep the browser
fixture under the real OS account and use its explicit CDP port from the app.

## CLI steering review

Apply [cli-steering-engineering](https://github.com/sudoprivacy/cli-steering-engineering)
when changing the catalog, wrappers, installed skill, execution tools or result
handling. The [pinned reference and audit instructions](https://github.com/sudoprivacy/sudohand/blob/main/docs/cli-steering-audit.md)
in sudohand define the recurring review.

Application traces exposed three steering problems: the previous skill
promised Python APIs even with a Rust backend, the Windows model repeatedly
used an unavailable Bash tool, and its file tool could not read a workspace
junction. The skill now directs discovery to the active wrapper and names the
deferred PowerShell tool's discovery and invocation steps in its description
and body. Workspace hints advertise the resolved skill file. Restart the app
when validating description changes because the skill index is cached.
The model acceptance test checks the first execution choice and retains
failures in its report.

The final shared skill also describes the native Windows shell path for hosts
without `ToolSearch`. A fresh scode UI run with this wording passed with nine
PowerShell calls and no failed tools. Other ACP hosts still require their own
model acceptance. An earlier conditional opening led to two failed Bash calls;
that variant was rejected even though the model eventually completed the task.
