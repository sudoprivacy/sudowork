#!/usr/bin/env node

/**
 * Prepare native app and installer icons from brand.config.json.
 * Generated files live in .cache so the checked-in Sudowork icons remain the
 * permanent fallback and are never overwritten.
 */

const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { appBuilderPath } = require('app-builder-bin');
const sharp = require('sharp');

const ROOT_DIR = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(ROOT_DIR, '.cache', 'native-brand', 'current');
const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
const BRAND_START = { r: 22, g: 28, b: 45 };
const BRAND_END = { r: 56, g: 97, b: 170 };

async function readLogo(source) {
  if (source.startsWith('data:')) {
    const match = /^data:([^,]*?),(.*)$/s.exec(source);
    if (!match) throw new Error('Invalid brand.logo data URL');
    const isBase64 = match[1].split(';').includes('base64');
    const data = isBase64 ? Buffer.from(match[2], 'base64') : Buffer.from(decodeURIComponent(match[2]));
    if (data.length === 0) throw new Error('brand.logo data URL is empty');
    if (data.length > MAX_DOWNLOAD_BYTES) throw new Error('brand.logo exceeds 10 MB');
    return data;
  }

  if (!source.startsWith('https://')) {
    throw new Error('brand.logo must be a data URL or HTTPS URL');
  }

  const response = await fetch(source, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Unable to download brand.logo: HTTP ${response.status}`);
  if (!response.url.startsWith('https://')) throw new Error('brand.logo redirected to a non-HTTPS URL');

  const declaredSize = Number(response.headers.get('content-length'));
  if (declaredSize > MAX_DOWNLOAD_BYTES) throw new Error('brand.logo exceeds 10 MB');
  if (!response.body) throw new Error('brand.logo response has no body');

  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_DOWNLOAD_BYTES) throw new Error('brand.logo exceeds 10 MB');
    chunks.push(Buffer.from(chunk));
  }
  if (size === 0) throw new Error('brand.logo is empty');
  return Buffer.concat(chunks);
}

function writeBmp(filePath, width, height, pixels) {
  const rowBytes = width * 3;
  const stride = rowBytes + ((4 - (rowBytes % 4)) % 4);
  const pixelDataSize = stride * height;
  const output = Buffer.alloc(54 + pixelDataSize);

  output.write('BM', 0);
  output.writeUInt32LE(output.length, 2);
  output.writeUInt32LE(54, 10);
  output.writeUInt32LE(40, 14);
  output.writeInt32LE(width, 18);
  output.writeInt32LE(height, 22);
  output.writeUInt16LE(1, 26);
  output.writeUInt16LE(24, 28);
  output.writeUInt32LE(pixelDataSize, 34);
  output.writeInt32LE(2835, 38);
  output.writeInt32LE(2835, 42);

  for (let y = 0; y < height; y++) {
    const sourceRow = y * rowBytes;
    const targetRow = 54 + (height - 1 - y) * stride;
    for (let x = 0; x < width; x++) {
      const source = sourceRow + x * 3;
      const target = targetRow + x * 3;
      output[target] = pixels[source + 2];
      output[target + 1] = pixels[source + 1];
      output[target + 2] = pixels[source];
    }
  }

  fs.writeFileSync(filePath, output);
}

async function createInstallerBmp(icon, filePath, width, height, iconSize, iconX, iconY, isHorizontal) {
  const gradient = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ratio = (isHorizontal ? x : y) / (isHorizontal ? width - 1 : height - 1);
      const offset = (y * width + x) * 3;
      gradient[offset] = Math.round(BRAND_START.r + (BRAND_END.r - BRAND_START.r) * ratio);
      gradient[offset + 1] = Math.round(BRAND_START.g + (BRAND_END.g - BRAND_START.g) * ratio);
      gradient[offset + 2] = Math.round(BRAND_START.b + (BRAND_END.b - BRAND_START.b) * ratio);
    }
  }

  const logo = await sharp(icon).resize(iconSize, iconSize, { fit: 'contain' }).png().toBuffer();
  const pixels = await sharp(gradient, { raw: { width, height, channels: 3 } })
    .composite([{ input: logo, left: iconX, top: iconY }])
    .removeAlpha()
    .raw()
    .toBuffer();
  writeBmp(filePath, width, height, pixels);
}

async function createIco(icon, filePath) {
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const images = await Promise.all(sizes.map((size) => sharp(icon).resize(size, size, { fit: 'contain' }).png().toBuffer()));
  const headerSize = 6 + images.length * 16;
  const output = Buffer.alloc(headerSize + images.reduce((total, image) => total + image.length, 0));
  output.writeUInt16LE(1, 2);
  output.writeUInt16LE(images.length, 4);

  let offset = headerSize;
  images.forEach((image, index) => {
    const entry = 6 + index * 16;
    output[entry] = sizes[index] === 256 ? 0 : sizes[index];
    output[entry + 1] = sizes[index] === 256 ? 0 : sizes[index];
    output.writeUInt16LE(1, entry + 4);
    output.writeUInt16LE(32, entry + 6);
    output.writeUInt32LE(image.length, entry + 8);
    output.writeUInt32LE(offset, entry + 12);
    image.copy(output, offset);
    offset += image.length;
  });
  fs.writeFileSync(filePath, output);
}

function createIcns(appPng, outputDir) {
  const conversionDir = path.join(outputDir, 'converted-icns');
  fs.mkdirSync(conversionDir);
  execFileSync(appBuilderPath, ['icon', '--format', 'icns', '--input', appPng, '--out', conversionDir], { stdio: 'pipe' });
  const generated = path.join(conversionDir, 'icon.icns');
  if (!fs.existsSync(generated)) throw new Error('Failed to generate app.icns');
  fs.renameSync(generated, path.join(outputDir, 'app.icns'));
  fs.rmSync(conversionDir, { recursive: true, force: true });
}

async function prepareBrandAssets(options = {}) {
  const rootDir = options.rootDir || ROOT_DIR;
  const outputDir = options.outputDir || path.join(rootDir, '.cache', 'native-brand', 'current');
  const brand = options.brand || require(path.join(rootDir, 'brand.config.json'));
  const resourcesDir = path.join(rootDir, 'resources');
  const parentDir = path.dirname(outputDir);
  const tempDir = path.join(parentDir, `.tmp-${process.pid}-${Date.now()}`);
  const isCustom = typeof brand.logo === 'string' && brand.logo.trim().length > 0;

  fs.mkdirSync(parentDir, { recursive: true });
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.mkdirSync(tempDir);

  try {
    let icon;
    if (isCustom) {
      icon = await readLogo(brand.logo.trim());
      const metadata = await sharp(icon).metadata();
      if (!metadata.width || !metadata.height) throw new Error('brand.logo is not a supported image');

      const appPng = await sharp(icon)
        .rotate()
        .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
      fs.writeFileSync(path.join(tempDir, 'app.png'), appPng);
      fs.writeFileSync(path.join(tempDir, 'app_dev.png'), appPng);
      await createIco(icon, path.join(tempDir, 'app.ico'));
      createIcns(path.join(tempDir, 'app.png'), tempDir);
    } else {
      for (const file of ['app.png', 'app_dev.png', 'app.ico', 'app.icns']) {
        fs.copyFileSync(path.join(resourcesDir, file), path.join(tempDir, file));
      }
      icon = fs.readFileSync(path.join(tempDir, 'app.png'));
    }

    await sharp(icon)
      .resize(14, 14, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .tint('#000000')
      .extend({ top: 2, bottom: 2, left: 2, right: 2, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(tempDir, 'trayTemplate.png'));
    await sharp(icon)
      .resize(28, 28, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .tint('#000000')
      .extend({ top: 4, bottom: 4, left: 4, right: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(tempDir, 'trayTemplate@2x.png'));

    await createInstallerBmp(icon, path.join(tempDir, 'installerSidebar.bmp'), 164, 314, 80, 42, 42, false);
    await createInstallerBmp(icon, path.join(tempDir, 'installerHeader.bmp'), 150, 57, 40, 100, 8, true);

    fs.writeFileSync(
      path.join(tempDir, 'manifest.json'),
      `${JSON.stringify({ isCustom, sourceDigest: crypto.createHash('sha256').update(isCustom ? brand.logo : 'sudowork-default').digest('hex') }, null, 2)}\n`
    );

    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.renameSync(tempDir, outputDir);
    return { isCustom, outputDir };
  } catch (error) {
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { prepareBrandAssets, readLogo };

if (require.main === module) {
  prepareBrandAssets({ outputDir: OUTPUT_DIR })
    .then(({ isCustom, outputDir }) => {
      console.log(`Prepared ${isCustom ? 'custom' : 'default Sudowork'} native icons in ${path.relative(ROOT_DIR, outputDir)}`);
    })
    .catch((error) => {
      console.error(`Failed to prepare native brand icons: ${error.message}`);
      process.exit(1);
    });
}
