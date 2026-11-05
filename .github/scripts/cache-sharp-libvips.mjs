// sharp 0.32.6 (required by @xenova/transformers) otherwise downloads this
// archive inside its install script, without bounded transport retries.
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

// Copied from the integrity contract shipped in sharp@0.32.6/package.json.
const archives = {
  "darwin-arm64v8":
    "1QZzICfCJd4wAO0P6qmYI5e5VFMt9iCE4QgefI8VMMbdSzjIXA9L/ARN6pkMQPZ3h20Y9RtJ2W1skgCsvCIccw==",
  "darwin-x64":
    "sMIKMYXsdU9FlIfztj6Kt/SfHlhlDpP0Ups7ftVFqwjaszmYmpI9y/d/q3mLb4jrzuSiSUEislSWCwBnW7MPTw==",
  "linux-arm64v8":
    "CD8owELzkDumaom+O3jJ8fKamILAQdj+//KK/VNcHK3sngUcFpdjx36C8okwbux9sml/T7GTB/gzpvReDrAejQ==",
  "win32-arm64v8":
    "kR91hy9w1+GEXK56hLh51+hBCBo7T+ijM4Slkmvb/2PsYZySq5H7s61n99iDYl6kTJP2y9sW5Xcvm3uuXDaDgg==",
  "win32-x64":
    "BwKckinJZ0Fu/EcunqiLPwOLEBWp4xf8GV7nvmVuKKz5f6B+GxoA2k9aa2wueqv4r4RJVgV/aWXZWFKOIjre/Q==",
  "linux-x64":
    "SlFWrITSW5XVUkaFPQOySAaSGXnhkGJCj8X2wGYYta9hk5piZldQyMp4zwy0z6UeRu1qKTKtZvmq28W3Gnh9xA==",
};

export async function cacheSharpLibvips({
  platform = process.platform,
  arch = process.arch,
  cacheRoot = process.env.npm_config_cache,
} = {}) {
  if (!cacheRoot)
    throw new Error("npm_config_cache must identify the job cache");
  const target = `${platform}-${arch === "arm64" ? "arm64v8" : arch}`;
  const integrity = archives[target];
  if (!integrity)
    throw new Error(`Unsupported libvips cache target: ${target}`);
  const name = `libvips-8.14.5-${target}.tar.br`;
  const directory = join(cacheRoot, "_libvips");
  const destination = join(directory, name);
  const temporary = `${destination}.${process.pid}.partial`;
  const verify = async (file) => {
    const actual = createHash("sha512")
      .update(await readFile(file))
      .digest("base64");
    if (actual !== integrity) throw new Error(`Integrity mismatch for ${name}`);
  };
  await mkdir(directory, { recursive: true });
  try {
    await verify(destination);
    console.log(`Verified cached ${name}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    try {
      const result = spawnSync(
        process.platform === "win32" ? "curl.exe" : "curl",
        [
          "--fail",
          "--location",
          "--silent",
          "--show-error",
          "--connect-timeout",
          "15",
          "--max-time",
          "60",
          "--retry",
          "3",
          "--retry-all-errors",
          "--retry-max-time",
          "180",
          "--output",
          temporary,
          `https://github.com/lovell/sharp-libvips/releases/download/v8.14.5/${name}`,
        ],
        { stdio: "inherit" },
      );
      if (result.error) throw result.error;
      if (result.status !== 0)
        throw new Error(`libvips download failed (${result.status})`);
      await verify(temporary);
      await rename(temporary, destination);
      console.log(`Downloaded and verified ${name}`);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  return destination;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await cacheSharpLibvips();
