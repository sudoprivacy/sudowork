import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { describe, expect, it } from 'vitest';
import brand from '@brand';
import { applyChannelBrand } from '@/channels/actions/types';
import { createTenantConfigCache, DEFAULT_TENANT_CONFIG, resolveCachedTenantConfig } from '@/common/types/tenantConfig';

const loadModule = createRequire(__filename);
const builderConfig = loadModule('../../electron-builder.brand.js');

describe('brand configuration', () => {
  it('drives default tenant and channel branding', () => {
    expect(DEFAULT_TENANT_CONFIG.app_name).toBe(brand.displayName);
    expect(DEFAULT_TENANT_CONFIG.app_company_name).toBe(brand.companyName);
    expect(resolveCachedTenantConfig(createTenantConfigCache(DEFAULT_TENANT_CONFIG))).toEqual(DEFAULT_TENANT_CONFIG);
    expect(resolveCachedTenantConfig({ ...DEFAULT_TENANT_CONFIG, __brand: 'PreviousBrand' })).toBeNull();
    expect(resolveCachedTenantConfig({ app_name: 'Tenant Brand' })?.app_name).toBe('Tenant Brand');
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

    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../src/index.ts'), 'utf8');
    expect(mainSource).toContain('app.setName(brand.displayName)');

    const installerSource = fs.readFileSync(path.resolve(__dirname, '../../scripts/installer.nsh'), 'utf8');
    expect(installerSource).toContain('${PRODUCT_NAME}');
    expect(installerSource).not.toContain('安装 Sudowork');
  });
});
