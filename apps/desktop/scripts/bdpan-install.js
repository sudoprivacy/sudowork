/**
 * bdpan CLI 安装脚本
 * 使用随应用打包的安装器进行安装
 *
 * Usage: node scripts/bdpan-install.js [options]
 *   --yes, -y           非交互式安装（跳过确认）
 *   --force, -f         强制重新安装
 *   --skip-install      跳过安装，直接使用本地 bdpan 工具（需设置 BDPAN_BIN 环境变量）
 *   --help              显示帮助信息
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// 颜色输出
const RED = '\x1b[0;31m';
const GREEN = '\x1b[0;32m';
const YELLOW = '\x1b[1;33m';
const NC = '\x1b[0m';

function logInfo(msg) { console.log(`${GREEN}[INFO]${NC} ${msg}`); }
function logWarn(msg) { console.log(`${YELLOW}[WARN]${NC} ${msg}`); }
function logError(msg) { console.error(`${RED}[ERROR]${NC} ${msg}`); }

// 检测操作系统
function detectOs() {
  const platform = os.platform();
  if (platform === 'darwin') return 'darwin';
  if (platform === 'linux') return 'linux';
  if (platform === 'win32') return 'windows';
  logError(`不支持的操作系统: ${platform}`);
  process.exit(1);
}

// 检测架构（返回 electron-builder 约定: x64/arm64）
function detectArch() {
  const arch = os.arch();
  if (arch === 'x64') return 'x64';
  if (arch === 'arm64') return 'arm64';
  logError(`不支持的架构: ${arch}`);
  process.exit(1);
}

// 检查命令是否存在
function commandExists(cmd) {
  try {
    execSync(
      os.platform() === 'win32' ? `where ${cmd}` : `command -v ${cmd}`,
      { stdio: 'ignore' }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * 查找打包的安装器路径
 * 打包后位于 process.resourcesPath，开发模式下位于 resources/
 */
function findBundledInstaller(osName, arch) {
  const installerName = osName === 'windows'
    ? `bdpan-installer-windows-${arch}.exe`
    : `bdpan-installer-${osName}-${arch}`;

  // 打包后路径（Electron app）
  if (process.env.RESOURCES_PATH) {
    const p = path.join(process.env.RESOURCES_PATH, installerName);
    if (fs.existsSync(p)) return p;
  }

  // 开发模式路径
  const devPath = path.join(__dirname, '..', 'resources', installerName);
  if (fs.existsSync(devPath)) return devPath;

  return null;
}

async function main() {
  let force = false;
  let skipInstall = false;
  const args = process.argv.slice(2);

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--yes': case '-y': case '--force': case '-f':
        force = true;
        break;
      case '--skip-install':
        skipInstall = true;
        break;
      case '--help': case '-h':
        console.log(`用法: node scripts/bdpan-install.js [选项]
\n选项:
  --yes, -y           非交互式安装（跳过确认）
  --force, -f         强制重新安装
  --skip-install      跳过安装，直接使用本地 bdpan 工具
                      （需设置 BDPAN_BIN 环境变量）
  --help              显示帮助信息
\n环境变量:
  BDPAN_BIN           指定本地 bdpan 工具路径（配合 --skip-install 使用）
  RESOURCES_PATH      应用资源目录路径（打包后由 Electron 设置）
\n示例:
  node scripts/bdpan-install.js                # 交互式安装
  node scripts/bdpan-install.js --yes          # 非交互式安装
  BDPAN_BIN=/path/to/bdpan node scripts/bdpan-install.js --skip-install`);
        process.exit(0);
        break;
      default:
        logError(`未知参数: ${args[i]}`);
        console.log('使用 --help 查看帮助信息');
        process.exit(1);
    }
  }

  // --skip-install: 使用本地 bdpan 工具
  if (skipInstall) {
    const bdpanBin = process.env.BDPAN_BIN;
    if (!bdpanBin) {
      logError('--skip-install 需要 BDPAN_BIN 环境变量指定本地工具路径');
      console.log(`示例: BDPAN_BIN=/path/to/bdpan node scripts/bdpan-install.js --skip-install`);
      process.exit(1);
    }
    if (!fs.existsSync(bdpanBin) || !(fs.statSync(bdpanBin).mode & 0o111)) {
      logError(`指定的 bdpan 工具不存在或不可执行: ${bdpanBin}`);
      process.exit(1);
    }
    logInfo(`使用本地 bdpan 工具: ${bdpanBin}`);
    try {
      const result = spawnSync(bdpanBin, ['version'], { encoding: 'utf8' });
      const currentVersion = (result.stdout || '').split('\n')[0] || 'unknown';
      logInfo(`bdpan CLI 版本: ${currentVersion}`);
    } catch {
      logInfo('bdpan CLI 版本: unknown');
    }
    logInfo('✓ 配置完成！');
    console.log(`\n使用方式:\n  export BDPAN_BIN="${bdpanBin}"\n  bash scripts/login.sh\n`);
    process.exit(0);
  }

  // 检测平台
  const osName = detectOs();
  const arch = detectArch();
  logInfo(`检测到平台: ${osName}/${arch}`);

  // 检查是否已安装
  if (commandExists('bdpan')) {
    let currentVersion = 'unknown';
    try {
      const result = spawnSync('bdpan', ['version'], { encoding: 'utf8' });
      currentVersion = (result.stdout || '').split('\n')[0] || 'unknown';
    } catch {}
    logWarn(`bdpan CLI 已安装 (版本: ${currentVersion})`);
    if (force) {
      logInfo('强制重新安装...');
    } else {
      process.stdout.write('是否要重新安装? [y/N] ');
      const buf = Buffer.alloc(4);
      const n = fs.readSync(0, buf, 0, 4, null);
      const answer = buf.slice(0, n).toString().trim().toLowerCase();
      if (answer !== 'y' && answer !== 'yes') {
        logInfo('取消安装');
        process.exit(0);
      }
    }
  }

  // 查找打包的安装器
  const installerPath = findBundledInstaller(osName, arch);
  if (!installerPath) {
    logError(`未找到打包的安装器 (${osName}/${arch})`);
    logError('请确保应用已正确打包，或使用 --skip-install 配合 BDPAN_BIN 指定本地工具');
    process.exit(1);
  }

  logInfo(`使用安装器: ${installerPath}`);

  // 确保可执行权限（非 Windows）
  if (osName !== 'windows') {
    fs.chmodSync(installerPath, 0o755);
  }

  logInfo('开始安装...');

  // 执行安装器
  const installCmd = osName === 'windows'
    ? spawnSync(installerPath, ['--yes'], { stdio: 'inherit', shell: true })
    : spawnSync(installerPath, ['--yes'], { stdio: 'inherit' });

  if (installCmd.status !== 0) {
    logError('安装失败');
    process.exit(installCmd.status ?? 1);
  }

  // 验证安装
  logInfo('验证安装...');
  if (commandExists('bdpan')) {
    let installedVersion = 'unknown';
    try {
      const result = spawnSync('bdpan', ['version'], { encoding: 'utf8' });
      installedVersion = (result.stdout || '').split('\n')[0] || 'unknown';
    } catch {}
    logInfo(`✓ bdpan CLI 安装成功！(版本: ${installedVersion})`);

    // 注册到版本管理系统
    logInfo('注册到版本管理系统...');
    try {
      spawnSync('bdpan', ['install', '--force'], { stdio: 'ignore' });
    } catch {
      logWarn('版本注册跳过（不影响使用）');
    }

    console.log('');
    console.log(`${RED}┌──────────────────────────────────────────────────────────────┐${NC}`);
    console.log(`${RED}│          ⚠️  bdpan-storage 公测安全须知 & 免责声明 (BETA)       │${NC}`);
    console.log(`${RED}├──────────────────────────────────────────────────────────────┤${NC}`);
    console.log(`${RED}│${NC} 1. [测试阶段] 本工具处于公测期，仅供技术交流。               ${RED}│${NC}`);
    console.log(`${RED}│${NC}    请务必【备份】网盘重要数据。                               ${RED}│${NC}`);
    console.log(`${RED}│${NC} 2. [行为负责] AI Agent 行为具有不可预测性，请实时             ${RED}│${NC}`);
    console.log(`${RED}│${NC}    【人工审核】指令执行过程，对执行后果负责。                  ${RED}│${NC}`);
    console.log(`${RED}│${NC} 3. [安全提醒] 严禁在他人、公用或不可信的环境中                ${RED}│${NC}`);
    console.log(`${RED}│${NC}    扫码授权，以免网盘数据被窃取！                              ${RED}│${NC}`);
    console.log(`${RED}│${NC}    在公共环境使用完毕后，请务必执行                             ${RED}│${NC}`);
    console.log(`${RED}│${NC}    【bdpan logout】 彻底清除授权。                             ${RED}│${NC}`);
    console.log(`${RED}│${NC} 4. [严禁泄露] 请严格保护配置文件与 Token，                    ${RED}│${NC}`);
    console.log(`${RED}│${NC}    切勿在公开仓库或对话中暴露！                                ${RED}│${NC}`);
    console.log(`${RED}├──────────────────────────────────────────────────────────────┤${NC}`);
    console.log(`${RED}│${NC} 使用本工具即代表您已阅读并认可上述条款。数据安全，人人有责。  ${RED}│${NC}`);
    console.log(`${RED}└──────────────────────────────────────────────────────────────┘${NC}`);
    console.log('');
    console.log('快速开始:');
    console.log('  1. 执行登录: bash scripts/login.sh');
    console.log('  2. 查看帮助: bdpan --help');
    console.log('');
  } else {
    logError('安装失败，请检查 PATH 是否包含 ~/.local/bin');
    console.log('可以手动添加: export PATH="$HOME/.local/bin:$PATH"');
    process.exit(1);
  }
}

main().catch((err) => {
  logError(err.message);
  process.exit(1);
});
