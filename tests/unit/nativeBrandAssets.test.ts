import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

const ROOT_DIR = path.resolve(__dirname, '../..');
const CUSTOM_DIR = path.join(ROOT_DIR, '.cache/native-brand/current');
const FALLBACK_DIR = path.join(ROOT_DIR, 'resources');

describe('native brand assets', () => {
  it('keeps fixed custom shell icons separate from Sudowork fallbacks', () => {
    for (const file of ['app.png', 'app_dev.png', 'app.ico', 'app.icns', 'trayTemplate.png', 'trayTemplate@2x.png', 'installerHeader.bmp', 'installerSidebar.bmp']) {
      expect(fs.existsSync(path.join(CUSTOM_DIR, file))).toBe(true);
    }
    for (const file of ['app.png', 'app_dev.png', 'app.ico', 'app.icns']) {
      expect(fs.existsSync(path.join(FALLBACK_DIR, file))).toBe(true);
    }
  });

  it('provides valid macOS menu bar template images', async () => {
    const icon = await sharp(path.join(CUSTOM_DIR, 'trayTemplate.png')).metadata();
    const icon2x = await sharp(path.join(CUSTOM_DIR, 'trayTemplate@2x.png')).metadata();

    expect({ width: icon.width, height: icon.height }).toEqual({ width: 18, height: 18 });
    expect({ width: icon2x.width, height: icon2x.height }).toEqual({ width: 36, height: 36 });
  });
});
