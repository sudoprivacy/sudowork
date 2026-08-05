import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { describe, expect, it } from 'vitest';
import brand from '@brand';
import { applyChannelBrand } from '@/channels/actions/types';
import { IS_SHAREONE_DISABLED } from '@/common/buildMode';
import { resolveRemoteTenant, resolveTenantDefaults } from '@/renderer/stores/useTenantStore';

const loadModule = createRequire(__filename);
const builderConfig = loadModule('../../electron-builder.brand.js');

describe('brand configuration', () => {
  it('drives default tenant and channel branding', () => {
    expect(typeof brand.BUILD_OFFLINE).toBe('boolean');
    expect(brand.disabledFeatures).toContain('shareone');
    expect(IS_SHAREONE_DISABLED).toBe(true);
    expect(resolveTenantDefaults()).toMatchObject({
      logo: brand.logo || undefined,
      appName: brand.displayName,
      topName: brand.displayName,
      companyName: brand.companyName,
    });
    expect(resolveRemoteTenant({ app_name: 'Tenant Brand' }).appName).toBe('Tenant Brand');
    expect(
      applyChannelBrand({
        title: 'Sudowork Assistant',
        elements: ['Open SudoWork settings'],
      })
    ).toEqual({
      title: `${brand.displayName} Assistant`,
      elements: [`Open ${brand.displayName} settings`],
    });
  });

  it('drives Electron runtime and packaging names', () => {
    expect(builderConfig.productName).toBe(brand.displayName);
    expect(builderConfig.executableName).toBe(brand.displayName);
    expect(builderConfig.copyright).toContain(brand.companyName);
    expect(builderConfig.win.legalTrademarks).toContain(brand.companyName);
    expect(builderConfig.linux.target).toEqual(['AppImage', 'deb']);
    expect(builderConfig.linux.desktop.entry.StartupWMClass).toBe((brand as { englishName?: string }).englishName?.trim() || 'SudoWork');
    expect(builderConfig.linux.desktop.entry.StartupWMClass).toMatch(/^[A-Za-z][A-Za-z0-9._-]*$/);
    if (brand.BUILD_OFFLINE) {
      const packagedResources = JSON.stringify([builderConfig.extraResources, builderConfig.mac?.extraResources, builderConfig.win?.extraResources, builderConfig.linux?.extraResources]);
      expect(packagedResources).not.toMatch(/bdpan-installer|nexus-vault/);
      expect(packagedResources).toContain(`v${loadModule('../../src/shared/runtime-versions.json').scode}-scode-`);
    }

    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../src/index.ts'), 'utf8');
    expect(mainSource).toContain("const ENGLISH_NAME = (brand as { englishName?: string }).englishName?.trim() || 'SudoWork'");
    expect(mainSource).toContain("app.setName(process.platform === 'linux' ? ENGLISH_NAME : brand.displayName)");

    if (brand.BUILD_OFFLINE) {
      const aboutSource = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/pages/settings/about/index.tsx'), 'utf8');
      expect(aboutSource).toContain('{!IS_OFFLINE_BUILD && (');
      expect(aboutSource).toContain('{!IS_OFFLINE_BUILD && <OpsModal');
    }

    const installerSource = fs.readFileSync(path.resolve(__dirname, '../../scripts/installer.nsh'), 'utf8');
    expect(installerSource).toContain('${PRODUCT_NAME}');
    expect(installerSource).not.toContain('安装 Sudowork');

    const builderSource = fs.readFileSync(path.resolve(__dirname, '../../electron-builder.yml'), 'utf8');
    expect(builderSource).toContain('win:\n');
    expect(builderSource).toContain('icon: .cache/native-brand/current/app.ico');
    expect(builderSource).toContain('icon: .cache/native-brand/current/app.icns');
    expect(builderSource).toContain('icon: .cache/native-brand/current/app.png');
    expect(builderSource).toContain('installerIcon: .cache/native-brand/current/app.ico');

    const buildScriptSource = fs.readFileSync(path.resolve(__dirname, '../../scripts/build-with-builder.js'), 'utf8');
    expect(buildScriptSource).toContain("targetArch === 'x64' ? 'amd64' : targetArch");
    expect(buildScriptSource).toContain("execSync('node scripts/build-browser-mcp.js'");
  });
});
