import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sharp from 'sharp';
import { prepareBrandAssets, readLogo } from '../../scripts/generate-installer-images.js';

describe('prepareBrandAssets', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-test-'));
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('generates custom brand assets from SVG data URL', async () => {
    const outputDir = path.join(tempDir, 'output');
    const svgDataUrl = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="40" fill="blue"/></svg>').toString('base64');

    const result = await prepareBrandAssets({
      outputDir,
      brand: { logo: svgDataUrl },
    });

    expect(result.isCustom).toBe(true);
    expect(result.outputDir).toBe(outputDir);

    // Check all output files exist
    expect(fs.existsSync(path.join(outputDir, 'app.png'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'app_dev.png'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'app.ico'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'app.icns'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'trayTemplate.png'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'trayTemplate@2x.png'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'installerSidebar.bmp'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'installerHeader.bmp'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'manifest.json'))).toBe(true);

    // Verify app.png is 1024x1024
    const appMeta = await sharp(path.join(outputDir, 'app.png')).metadata();
    expect(appMeta.width).toBe(1024);
    expect(appMeta.height).toBe(1024);

    // Verify tray icons are 18x18 and 36x36
    const trayMeta = await sharp(path.join(outputDir, 'trayTemplate.png')).metadata();
    expect(trayMeta.width).toBe(18);
    expect(trayMeta.height).toBe(18);

    const tray2xMeta = await sharp(path.join(outputDir, 'trayTemplate@2x.png')).metadata();
    expect(tray2xMeta.width).toBe(36);
    expect(tray2xMeta.height).toBe(36);

    // Verify BMP dimensions from header
    const sidebarBmp = fs.readFileSync(path.join(outputDir, 'installerSidebar.bmp'));
    const sidebarWidth = sidebarBmp.readInt32LE(18);
    const sidebarHeight = sidebarBmp.readInt32LE(22);
    expect(sidebarWidth).toBe(164);
    expect(sidebarHeight).toBe(314);

    const headerBmp = fs.readFileSync(path.join(outputDir, 'installerHeader.bmp'));
    const headerWidth = headerBmp.readInt32LE(18);
    const headerHeight = headerBmp.readInt32LE(22);
    expect(headerWidth).toBe(150);
    expect(headerHeight).toBe(57);

    // Verify manifest
    const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf-8'));
    expect(manifest.isCustom).toBe(true);
    expect(manifest.sourceDigest).toBeDefined();
  });

  it('copies default Sudowork assets when brand.logo is empty', async () => {
    const rootDir = path.join(tempDir, 'root');
    const resourcesDir = path.join(rootDir, 'resources');
    const outputDir = path.join(tempDir, 'output');

    fs.mkdirSync(resourcesDir, { recursive: true });

    // Copy real resources from repo
    const repoRoot = path.resolve(__dirname, '../..');
    const repoResources = path.join(repoRoot, 'resources');
    for (const file of ['app.png', 'app_dev.png', 'app.ico', 'app.icns']) {
      fs.copyFileSync(path.join(repoResources, file), path.join(resourcesDir, file));
    }

    const result = await prepareBrandAssets({
      rootDir,
      outputDir,
      brand: { logo: '' },
    });

    expect(result.isCustom).toBe(false);

    // Verify copied files match input
    for (const file of ['app.png', 'app_dev.png', 'app.ico', 'app.icns']) {
      const input = fs.readFileSync(path.join(resourcesDir, file));
      const output = fs.readFileSync(path.join(outputDir, file));
      expect(Buffer.compare(input, output)).toBe(0);
    }

    // Verify manifest
    const manifest = JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf-8'));
    expect(manifest.isCustom).toBe(false);
  });
});

describe('readLogo', () => {
  it('rejects http URLs', async () => {
    await expect(readLogo('http://example.com/logo.png')).rejects.toThrow('must be a data URL or HTTPS URL');
  });

  it('accepts data URLs', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>';
    const dataUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
    const result = await readLogo(dataUrl);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it('rejects invalid data URLs', async () => {
    await expect(readLogo('data:invalid')).rejects.toThrow('Invalid brand.logo data URL');
  });

  it('rejects empty data URLs', async () => {
    await expect(readLogo('data:image/png;base64,')).rejects.toThrow('brand.logo data URL is empty');
  });
});
