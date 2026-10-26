// Exercise sharp's original installer without its existing vendor directory.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";

assert(process.env.npm_config_cache, "npm_config_cache is required");
const desktopRequire = createRequire(
  new URL("../../apps/desktop/package.json", import.meta.url),
);
const packageFile = process.argv[2]
  ? resolve(process.argv[2])
  : createRequire(desktopRequire.resolve("@xenova/transformers")).resolve(
      "sharp/package.json",
    );
const metadata = JSON.parse(await readFile(packageFile, "utf8"));
assert.equal(metadata.version, "0.32.6");
const require = createRequire(packageFile);
const fixture = await mkdtemp(join(tmpdir(), "sharp-cache-verification-"));
let requests = 0;
const server = createServer((_request, response) => {
  requests++;
  response.writeHead(503);
  response.end("The verified cache must satisfy the installer");
});
try {
  await Promise.all(
    ["install", "lib", "package.json"].map((name) =>
      cp(join(dirname(packageFile), name), join(fixture, name), {
        recursive: true,
      }),
    ),
  );
  await new Promise((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", accept);
  });
  const { port } = server.address();
  const env = {
    ...process.env,
    NODE_PATH: require.resolve.paths("detect-libc").join(delimiter),
    SHARP_DIST_BASE_URL: `http://127.0.0.1:${port}/`,
    SHARP_INSTALL_FORCE: "",
    npm_config_sharp_install_force: "",
    npm_config_sharp_dist_base_url: `http://127.0.0.1:${port}/`,
    npm_config_sharp_libvips_local_prebuilds: "",
  };
  let output = "";
  const child = spawn(process.execPath, ["install/libvips.js"], {
    cwd: fixture,
    env,
    timeout: 60_000,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (data) => (output += data));
  child.stderr.on("data", (data) => (output += data));
  const code = await new Promise((accept, reject) => {
    child.once("error", reject);
    child.once("close", accept);
  });
  console.log(output.trim());
  assert.equal(code, 0, "The unchanged sharp installer must succeed");
  assert.equal(requests, 0, "The installer must use the verified cache");
  assert.match(output, /Using cached /);
  assert.match(
    output,
    new RegExp(
      `Integrity check passed for ${process.platform}-${process.arch}`,
    ),
  );
  console.log(
    "Verified the original sharp installer without download fallback",
  );
} finally {
  await new Promise((accept) => server.close(accept));
  await rm(fixture, { recursive: true, force: true });
}
