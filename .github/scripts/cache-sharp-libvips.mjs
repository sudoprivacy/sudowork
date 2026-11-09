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

// Measured from the official sharp v0.32.6 release archives after checking
// their native payloads. These legacy assets have no upstream digest field.
const nativeArchives = {
  "win32-x64":
    "pBegD1ZuMKdHbsT8IxTNDMCo/RsBiPTOEUdfTU9m92/1IJfCMeRr4bxyIxaE/pfSpDd0MmG90TyLFD1NGbfIuA==",
  "linux-x64":
    "O1d4m5C4TfU4mpP0Ow5al5+CyP1qNnjf3TKYOgQTC3T8gj4KEdSXDq4SsehsX2b7qNee7cuMBukYL6zqe/PmrA==",
};

// Immutable asset identities from the same pinned official releases. The API
// download path avoids a failing browser-download gateway without a mirror.
const libvipsAssetIds = {
  "darwin-arm64v8": 126621404,
  "darwin-x64": 126621508,
  "linux-arm64v8": 126620583,
  "win32-arm64v8": 126619375,
  "win32-x64": 126619488,
  "linux-x64": 126620878,
};
const nativeAssetIds = { "linux-x64": 126626396, "win32-x64": 126626740 };

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
  return cacheVerifiedArchive({
    cacheRoot,
    directoryName: "_libvips",
    name,
    integrity,
    url: `https://github.com/lovell/sharp-libvips/releases/download/v8.14.5/${name}`,
    apiUrl: `https://api.github.com/repos/lovell/sharp-libvips/releases/assets/${libvipsAssetIds[target]}`,
  });
}

export async function cacheSharpNativePrebuild({
  platform = process.platform,
  arch = process.arch,
  cacheRoot = process.env.npm_config_cache,
} = {}) {
  if (!cacheRoot)
    throw new Error("npm_config_cache must identify the job cache");
  const target = `${platform}-${arch}`;
  const integrity = nativeArchives[target];
  if (!integrity)
    throw new Error(`Unsupported sharp prebuild cache target: ${target}`);
  const archive = `sharp-v0.32.6-napi-v7-${target}.tar.gz`;
  const url = `https://github.com/lovell/sharp/releases/download/v0.32.6/${archive}`;
  // This is prebuild-install 7.1.3's cache filename contract.
  const prefix = createHash("sha512").update(url).digest("hex").slice(0, 6);
  return cacheVerifiedArchive({
    cacheRoot,
    directoryName: "_prebuilds",
    name: `${prefix}-${archive.replace(/[^a-zA-Z0-9.]+/g, "-")}`,
    integrity,
    url,
    apiUrl: `https://api.github.com/repos/lovell/sharp/releases/assets/${nativeAssetIds[target]}`,
  });
}

export async function cacheVerifiedArchive({
  cacheRoot,
  directoryName,
  name,
  integrity,
  url,
  apiUrl,
}) {
  const directory = join(cacheRoot, directoryName);
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
      const download = (source, headers = []) =>
        spawnSync(
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
            "--write-out",
            "%{http_code}",
            ...headers,
            source,
          ],
          { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" },
        );
      let result = download(url);
      const status = result.stdout?.trim();
      if (
        !result.error &&
        result.status === 22 &&
        ["502", "503", "504"].includes(status) &&
        apiUrl
      ) {
        console.log(
          `Release download returned HTTP ${status}; requesting the same pinned asset through GitHub's public API`,
        );
        result = download(apiUrl, [
          "--header",
          "Accept: application/octet-stream",
        ]);
      }
      if (result.error) throw result.error;
      if (result.status !== 0)
        throw new Error(
          `Native dependency download failed for ${name} (${result.status}, HTTP ${result.stdout?.trim() || "unavailable"})`,
        );
      await verify(temporary);
      await rename(temporary, destination);
      console.log(`Downloaded and verified ${name}`);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  return destination;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await cacheSharpLibvips();
  if (process.argv.includes("--with-prebuild"))
    await cacheSharpNativePrebuild();
}
