"use strict";

const { spawnSync } = require("node:child_process");
const { statSync } = require("node:fs");
const { createRequire } = require("node:module");
const path = require("node:path");

const desktop = path.resolve(__dirname, "../apps/desktop");
// Electron can download on first require. Keep all installer output on stderr;
// stdout is the executable-path protocol consumed by Python and shell callers.
const prepared = spawnSync(process.execPath, ["-e", 'require("electron")'], {
  cwd: desktop,
  stdio: ["ignore", 2, 2],
  windowsHide: true,
});
if (prepared.error) throw prepared.error;
if (prepared.status !== 0) {
  console.error(
    `Electron preparation failed (code=${prepared.status}, signal=${prepared.signal})`,
  );
  process.exit(prepared.status ?? 1);
}

const requireDesktop = createRequire(path.join(desktop, "package.json"));
const electron = requireDesktop("electron");
if (
  typeof electron !== "string" ||
  !path.isAbsolute(electron) ||
  !statSync(electron).isFile()
) {
  throw new Error("The installed Electron executable is unavailable");
}
process.stdout.write(electron + "\n");
