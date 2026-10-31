# Electron native test shutdown

The Windows native SQLite CI wrapper failed while running Electron 40.8.5 with
`PostQueuedCompletionStatus: (6) The handle is invalid.` The child stderr was
reported, but its stdout and exit details were missing from the failure.

Electron documents the same failure signature in
[Electron #52956](https://github.com/electron/electron/pull/52956), backporting
[Node #61999](https://github.com/nodejs/node/pull/61999). A delayed V8 task could
post to the platform scheduler after its libuv loop closed. The fix rejects late
posts during shutdown. It first shipped on the 42 branch in
[42.10.0](https://releases.electronjs.org/release/v42.10.0).

The desktop and renderer now pin Electron 42.11.18, including that fix. The native
build configuration uses the same exact version. `node-abi` 4.40.0 supplies its
ABI mapping as an exact Desktop development dependency; prebuild-install keeps
its compatible 3.x dependency. A repository-wide 4.x override caused the Windows
packager to reject that production dependency and was removed.
Better-sqlite3 12.11.1 supplies the corresponding native driver.
Dependency resolution preserves unrelated package versions and checksums.

The two existing SQLite suites use one child-process helper. It retains their
test selection, single-worker setting and deadlines, and reports stdout, stderr,
exit code, signal and timeout termination on failure. A new regression runs the
upstream redirect-limit/shutdown fixture 20 times with the installed Electron.
It uses only loopback HTTP and requires a clean exit on every attempt.

The failure signature and missing upstream patch support this runtime update;
they do not establish a captured crash stack for the original CI failure. Local
stress runs on two efficiency cores passed four times, then exceeded unchanged
native test deadlines. That separate scheduling failure was preserved. Neither
it nor a successful rerun of the old runtime proves the CI flake resolved.

Prepare native bindings after the final dependency install. Bun can recreate a
package directory and remove a previously prepared local binding. Qualification
checks the resolved package path and Electron ABI before the native suites.
This Windows machine uses the publisher's checksum-verified
`better-sqlite3-v12.11.1-electron-v146-win32-x64.tar.gz` asset because it has no
MSVC installation. CI retains its normal native rebuild; generated bindings stay
outside version control.

## Cold runtime discovery

Electron 42 can download its binary on the first `require('electron')` and print
`Downloading Electron binary...` to stdout. Capturing `node -p` as an executable
path therefore produced a nonexistent two-line path in both Windows installer
acceptance and Linux sandbox preparation.

`scripts/resolve-electron-path.cjs` prepares the actual package in a child whose
installer output goes to stderr, then returns one checked absolute executable
path on stdout. Both consumers use that resolver. Two fresh copies of the public
42.11.18 package reproduced the original Windows `FileNotFoundError` and then
executed the corrected path, reporting Electron 42.11.18 and ABI 146. The public
download cache was retained; this qualifies fresh package installation rather
than an uncached network download.

The dev-shim smoke also recognizes Chromium's exact `-32000` lifecycle response
`Inspected target navigated or closed`. It uses the existing navigation recovery
path, attempt count and deadlines; other protocol errors still fail the smoke.

The Linux CI also exercises an actual `Page.reload` while an evaluation is
pending, then verifies the ordinary product bridge in the new context. The same
flow passed in the real Windows Electron dev server. A later cold-cache diagnostic reproduced the original 45-second failure while
the page was blank: its bridge and app-mode module had not executed, and Vite
held optimized dependency responses for about 46 seconds. The renderer now
explicitly prebundles its startup IPC/locale imports and releases optimized
dependencies during the remaining workspace crawl. Three independent runs with
empty optimizer caches reached the UI in 34,991, 37,427 and 36,558 ms, within the
unchanged 45-second guard. Each passed an actual reload and the product bridge;
their application processes exited normally. These finite local samples do not
establish a failure rate. Guard failures now include
read-only renderer and resource diagnostics without extending that deadline.

Local Windows x64 packaging completed with the default `afterPack` hook and the
normal public CLI and safety-hook resources. It passed the dependency traversal
that previously rejected the global ABI override. This is an unpacked local
application result. That exact unpacked application also passed the real Luna
browser journey with physical native-window input, clipboard/composition, native
question cancellation, ordinary Stop/chat continuation and exact readback. Its
cold installer matched all 205 public SDK files. Application bytes were unchanged
and temporary model configuration and owned services were removed. Official
release artifacts remain a separate gate.
