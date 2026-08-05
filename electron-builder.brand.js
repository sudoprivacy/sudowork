const fs = require('fs');
const { parse } = require('yaml');
const brand = require('./brand.config.json');
const runtimeVersions = require('./src/shared/runtime-versions.json');

const copyright = `Copyright © 2026 ${brand.companyName}`;
const englishName = brand.englishName?.trim() || 'SudoWork';
const linuxDesktop = { desktop: { entry: { StartupWMClass: englishName } } };
const branding = {
  productName: brand.displayName,
  executableName: brand.displayName,
  copyright,
};

if (brand.BUILD_OFFLINE !== true) {
  module.exports = { extends: './electron-builder.yml', ...branding, linux: linuxDesktop, win: { legalTrademarks: copyright } };
} else {
  const config = parse(fs.readFileSync('./electron-builder.yml', 'utf8'));
  const withoutRuntime = (entries = []) =>
    entries.filter((entry) => {
      const text = JSON.stringify(entry);
      return !/bdpan-installer|nexus-vault|nexusd-cluster|scode-(macos|windows|linux)|node-(darwin|win32|linux)/.test(text);
    });
  const runtimeResources = (platform) => {
    const arch = process.env.ELECTRON_BUILDER_ARCH;
    const scodeArch = arch || '*';
    const nexusArch = arch === 'arm64' ? 'aarch64' : arch === 'x64' ? 'x86_64' : '*';
    const names =
      platform === 'darwin'
        ? { node: 'node-darwin-${arch}.tar.gz', nexus: `v${runtimeVersions['nexus-vfs']}-nexusd-cluster-macos-${nexusArch}.tar.gz`, scode: `v${runtimeVersions.scode}-scode-macos-${scodeArch}.tar.gz` }
        : platform === 'win32'
          ? { node: 'node-win32-${arch}.zip', nexus: `v${runtimeVersions['nexus-vfs']}-nexusd-cluster-windows-${nexusArch}.zip`, scode: `v${runtimeVersions.scode}-scode-windows-${scodeArch}.zip` }
          : { node: 'node-linux-${arch}.tar.gz', nexus: `v${runtimeVersions['nexus-vfs']}-nexusd-cluster-linux-${nexusArch}.tar.gz`, scode: `v${runtimeVersions.scode}-scode-linux-${scodeArch}.tar.gz` };
    return [
      { from: `resources/${names.node}`, to: names.node },
      { from: 'resources', to: '.', filter: [names.nexus] },
      { from: 'resources', to: '.', filter: [names.scode] },
    ];
  };

  config.extraResources = withoutRuntime(config.extraResources);
  config.mac = { ...config.mac, extraResources: [...withoutRuntime(config.mac?.extraResources), ...runtimeResources('darwin')] };
  config.win = { ...config.win, legalTrademarks: copyright, extraResources: [...withoutRuntime(config.win?.extraResources), ...runtimeResources('win32')] };
  config.linux = { ...config.linux, ...linuxDesktop, extraResources: [...withoutRuntime(config.linux?.extraResources), ...runtimeResources('linux')] };
  module.exports = { ...config, ...branding, win: { ...config.win, legalTrademarks: copyright } };
}
