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
ABI mapping, and better-sqlite3 12.11.1 supplies the corresponding native driver.
Dependency resolution preserves unrelated package versions and checksums; the
lockfile also records the package manager's dependency hoisting changes.

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
