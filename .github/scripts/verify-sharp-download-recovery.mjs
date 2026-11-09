// Exercise the real curl/cache path across gateway failure, cache reuse and refusal.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = await mkdtemp(join(tmpdir(), "verified-native-download-"));
const archive = Buffer.from("Actual cache transfer fixture\n");
const integrity = createHash("sha512").update(archive).digest("base64");
const requests = [];
const server = createServer((request, response) => {
  requests.push({ path: request.url, accept: request.headers.accept });
  if (request.url === "/browser") {
    response.writeHead(502).end("Temporary release gateway failure");
  } else if (request.url === "/forbidden") {
    response.writeHead(403).end("Forbidden");
  } else if (request.url === "/api") {
    assert.equal(request.headers.accept, "application/octet-stream");
    response.writeHead(200).end(archive);
  } else if (request.url === "/corrupt") {
    response.writeHead(200).end("Incorrect bytes");
  } else {
    response.writeHead(404).end();
  }
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const origin = `http://127.0.0.1:${server.address().port}`;
const helper = new URL("./cache-sharp-libvips.mjs", import.meta.url).href;
async function run(cacheRoot, path, apiPath = "/api") {
  const config = {
    cacheRoot,
    directoryName: "_prebuilds",
    name: "native.tar.gz",
    integrity,
    url: origin + path,
    apiUrl: origin + apiPath,
  };
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "const {cacheVerifiedArchive}=await import(process.argv[1]);await cacheVerifiedArchive(JSON.parse(process.argv[2]));",
      helper,
      JSON.stringify(config),
    ],
    {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    },
  );
  let output = "";
  child.stdout.on("data", (value) => (output += value));
  child.stderr.on("data", (value) => (output += value));
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  return { code, output };
}
try {
  const cache = join(root, "recovery");
  const cold = await run(cache, "/browser");
  assert.equal(cold.code, 0, cold.output);
  assert.deepEqual(
    await readFile(join(cache, "_prebuilds/native.tar.gz")),
    archive,
  );
  assert.equal(requests.filter((value) => value.path === "/api").length, 1);
  const beforeWarm = requests.length;
  const warm = await run(cache, "/browser");
  assert.equal(warm.code, 0, warm.output);
  assert.equal(
    requests.length,
    beforeWarm,
    "Verified warm bytes must not request either endpoint",
  );
  await writeFile(join(cache, "_prebuilds/native.tar.gz"), "Poisoned cache");
  const poisoned = await run(cache, "/browser");
  assert.notEqual(poisoned.code, 0);
  assert.match(poisoned.output, /Integrity mismatch/);
  assert.equal(
    requests.length,
    beforeWarm,
    "A corrupt cache must fail without another download",
  );

  const denied = await run(join(root, "denied"), "/forbidden");
  assert.notEqual(denied.code, 0);
  assert.match(denied.output, /HTTP 403/);
  assert.equal(
    requests.filter((value) => value.path === "/forbidden").length,
    1,
  );
  assert.equal(
    requests.filter((value) => value.path === "/api").length,
    1,
    "An access refusal must never select the API route",
  );

  const corruptRoot = join(root, "corrupt");
  const corrupt = await run(corruptRoot, "/browser", "/corrupt");
  assert.notEqual(corrupt.code, 0);
  assert.match(corrupt.output, /Integrity mismatch/);
  assert.deepEqual(
    await readdir(join(corruptRoot, "_prebuilds")),
    [],
    "Failed or incorrect bytes must not remain in the cache",
  );
  console.log(
    "Verified actual curl transfer, bounded gateway recovery, warm cache, corrupt-cache refusal, HTTP 403 exclusion and corrupt-API cleanup",
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(root, { recursive: true, force: true });
}
