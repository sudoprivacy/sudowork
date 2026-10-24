// sharp 0.32.6 (required by @xenova/transformers) otherwise downloads this
// archive inside its install script, without bounded transport retries.
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

if (!process.env.npm_config_cache)
  throw new Error("npm_config_cache must identify the job cache");
const name = "libvips-8.14.5-win32-x64.tar.br";
// Copied from the integrity contract shipped in sharp@0.32.6/package.json.
const integrity =
  "BwKckinJZ0Fu/EcunqiLPwOLEBWp4xf8GV7nvmVuKKz5f6B+GxoA2k9aa2wueqv4r4RJVgV/aWXZWFKOIjre/Q==";
const directory = join(process.env.npm_config_cache, "_libvips");
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
