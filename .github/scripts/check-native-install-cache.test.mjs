import assert from "node:assert/strict";
import { test } from "node:test";
import { unpreparedNativeInstalls } from "./check-native-install-cache.mjs";

const cache = { uses: "./.github/actions/cache-sharp-libvips" };
const shared = { uses: "./.github/actions/install-bun-dependencies" };
const install = { name: "Install", run: "bun install --frozen-lockfile" };
const check = (steps) =>
  unpreparedNativeInstalls({ jobs: { acceptance: { steps } } });

test("a native install requires an earlier verified cache", () => {
  assert.deepEqual(check([install]), [{ job: "acceptance", step: "Install" }]);
  assert.deepEqual(check([cache, install]), []);
  assert.equal(check([install, cache]).length, 1);
});

test("conditional preparation cannot cover an unconditional install", () => {
  assert.equal(
    check([{ ...cache, if: "runner.os == 'Windows'" }, install]).length,
    1,
  );
});

test("the shared installer prepares callers and its own body must still prepare hooks", () => {
  assert.deepEqual(check([shared, install]), []);
  assert.equal(
    check([{ ...shared, if: "runner.os == 'Windows'" }, install]).length,
    1,
  );
  const composite = (steps) =>
    unpreparedNativeInstalls({ jobs: { sharedInstaller: { steps } } }, [
      cache.uses,
    ]);
  assert.equal(composite([install]).length, 1);
  assert.equal(composite([install, cache]).length, 1);
  assert.deepEqual(composite([cache, install]), []);
});

test("hook-free and global installs are exempt without exempting another command", () => {
  assert.deepEqual(
    check([
      { run: "bun install --ignore-scripts" },
      { run: "bun install --global node-gyp" },
    ]),
    [],
  );
  assert.equal(
    check([{ run: "bun install --ignore-scripts && bun install" }]).length,
    1,
  );
});

test("retry wrappers still need preparation and logging is not an install", () => {
  const retry = {
    name: "Retry install",
    uses: "nick-fields/retry@v4",
    with: { command: "bun install" },
  };
  assert.equal(check([retry]).length, 1);
  assert.deepEqual(check([cache, retry]), []);
  assert.deepEqual(check([{ run: "echo 'bun install'\n# bun install" }]), []);
});
