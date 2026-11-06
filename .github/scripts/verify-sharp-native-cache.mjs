// Install both native archives into a fresh package and perform real image IO.
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
const fixture = await mkdtemp(
  join(tmpdir(), "sharp-native-cache-verification-"),
);
let requests = 0;
const server = createServer((_request, response) => {
  requests++;
  response.writeHead(503);
  response.end("The verified cache must satisfy the native installer");
});
server.on("connect", (_request, socket) => {
  requests++;
  socket.end("HTTP/1.1 503 Service Unavailable\r\n\r\n");
});

async function run(arguments_, environment) {
  let output = "";
  const child = spawn(process.execPath, arguments_, {
    cwd: fixture,
    env: environment,
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
  assert.equal(code, 0, "The unchanged native installation must succeed");
  return output;
}

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
  const proxy = `http://127.0.0.1:${server.address().port}`;
  const environment = {
    ...process.env,
    NODE_PATH: require.resolve.paths("detect-libc").join(delimiter),
    HTTP_PROXY: proxy,
    HTTPS_PROXY: proxy,
    http_proxy: proxy,
    https_proxy: proxy,
    NO_PROXY: "",
    no_proxy: "",
    SHARP_INSTALL_FORCE: "",
    npm_config_sharp_install_force: "",
    npm_config_sharp_libvips_local_prebuilds: "",
  };
  // These are the unchanged success-path commands in sharp's install script.
  await run(["install/libvips.js"], environment);
  await run(["install/dll-copy.js"], environment);
  await run([require.resolve("prebuild-install/bin.js")], environment);
  assert.equal(
    requests,
    0,
    "Neither native archive may fall back to a download",
  );
  const image = await run(
    [
      "-e",
      `const assert=require('node:assert/strict');
       const sharp=require(process.cwd());
       (async()=>{
         assert.equal(sharp.versions.sharp,'0.32.6');
         assert.equal(sharp.versions.vips,'8.14.5');
         const png=await sharp({create:{width:3,height:2,channels:3,background:'red'}}).png().toBuffer();
         const metadata=await sharp(png).metadata();
         assert.equal(metadata.width,3);assert.equal(metadata.height,2);
         const pixels=await sharp(png).removeAlpha().raw().toBuffer();
         assert.deepEqual([...pixels],Array.from({length:6},()=>[255,0,0]).flat());
         console.log(JSON.stringify({nativeLoaded:true,width:3,height:2,format:metadata.format}));
       })().catch(error=>{console.error(error);process.exitCode=1;});`,
    ],
    environment,
  );
  assert.match(image, /"nativeLoaded":true/);
  assert.equal(requests, 0);
  console.log(
    "Verified original sharp native installation and exact image pixels without network fallback",
  );
} finally {
  await new Promise((accept) => server.close(accept));
  await rm(fixture, { recursive: true, force: true });
}
