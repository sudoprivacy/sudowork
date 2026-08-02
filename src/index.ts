/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

// V8 compile cache - must be first import to cache all subsequent requires
// Reduces startup time by 40-60% on subsequent launches
import 'v8-compile-cache';

// Initialize the process supervisor as early as possible, before any child
// processes are spawned. It registers a synchronous `process.on('exit')`
// handler that guarantees all tracked child processes are killed when the
// parent exits — regardless of whether async cleanup (before-quit, etc.)
// succeeds or not.
// 尽早初始化进程监管器。它注册同步 process.on('exit') 回调，保证父进程退出时
// 所有被追踪的子进程都会被杀死，不依赖异步清理是否成功。
import { processSupervisor } from './process/ProcessSupervisor';
processSupervisor.initialize();

import './utils/configureChromium';
import { app, BrowserWindow, Menu, nativeImage, powerMonitor, protocol, screen, Tray } from 'electron';
import fixPath from 'fix-path';
import * as fs from 'fs';
import * as path from 'path';
import { initMainAdapterWithWindow } from './adapter/main';
import { createAvatarWindow } from './process/avatarWindow';
import { ipcBridge } from './common';
import { AION_ASSET_PROTOCOL, createAssetProtocolResponse } from './extensions/assetProtocol';
import { initializeProcess } from './process';
import { ProcessConfig } from './process/initStorage';
import { loadShellEnvironmentAsync, mergePaths } from './process/utils/shellEnv';
import { initializeAcpDetector } from './process/bridge';
import { registerWindowMaximizeListeners } from './process/bridge/windowControlsBridge';
import { onAvatarEnabledChanged, onCloseToTrayChanged, onLanguageChanged } from './process/bridge/systemSettingsBridge';
import WorkerManage from './process/WorkerManage';
import { setupApplicationMenu } from './utils/appMenu';
import { startWebServer } from './webserver';
import { SERVER_CONFIG } from './webserver/config/constants';
import { applyZoomToWindow } from './process/utils/zoom';
import i18n from '@process/i18n';
import { mainLog, mainError } from './process/utils/mainLogger';
import { ensureMainSystemConfig } from './process/services/systemConfigBootstrap';
import { isNightlyBuild } from './common/buildInfo';
import brand from '@brand';
// @ts-expect-error - electron-squirrel-startup doesn't have types
import electronSquirrelStartup from 'electron-squirrel-startup';

// ============ Telemetry Performance Tracking ============
// Mark app start time as early as possible for cold_start metric
import { markAppStart, markFirstWindowShow, initializeTelemetry, shutdownTelemetry, initCrashReporter, captureRendererCrash, captureException, systemBreadcrumbs, windowBreadcrumbs } from './process/telemetry';
markAppStart();

const APP_LOG_PREFIX = `[${brand.displayName}]`;

// Set this before Electron derives native names and user-data paths.
app.setName(brand.displayName);

// 记录应用启动
mainLog('App', `${brand.displayName} starting, version: ${app.getVersion()}`);
mainLog('App', `Platform: ${process.platform}, Arch: ${process.arch}`);
mainLog('App', `Electron: ${process.versions.electron}, Node: ${process.versions.node}`);
mainLog('App', `Packaged: ${app.isPackaged}, Dev: ${!app.isPackaged}`);

// Hide Dock icon when running as Node.js CLI (ELECTRON_RUN_AS_NODE)
// This prevents the Dock bounce when using the claude CLI wrapper
if (process.env.ELECTRON_RUN_AS_NODE === '1' && process.platform === 'darwin' && app.dock) {
  app.dock.hide();
}

// ============ Deep Link Protocol ============
// Register sudowork:// protocol scheme for external app integration (e.g., New API token quick-add)
const PROTOCOL_SCHEME = 'sudowork';
// The packaged macOS/Windows build registers this scheme in its manifest
// (electron-builder.yml), so the OAuth2 redirect (sudowork://oauth2-callback)
// routes to the app.
const PROTOCOL_SCHEMES = [PROTOCOL_SCHEME];
const isDeepLinkArg = (arg: string): boolean => PROTOCOL_SCHEMES.some((s) => arg.startsWith(`${s}://`));

/**
 * Parse a sudowork:// URL into action and params.
 * Supports two formats:
 *   1. sudowork://add-provider?baseUrl=xxx&apiKey=xxx
 *   2. sudowork://provider/add?v=1&data=<base64 JSON>  (one-api / new-api style)
 */
const parseDeepLinkUrl = (url: string): { action: string; params: Record<string, string> } | null => {
  try {
    const parsed = new URL(url);
    if (!PROTOCOL_SCHEMES.some((s) => parsed.protocol === `${s}:`)) return null;

    // Build action from hostname + pathname, e.g. "provider/add" or "add-provider"
    const hostname = parsed.hostname || '';
    const pathname = parsed.pathname.replace(/^\/+/, '');
    const action = pathname ? `${hostname}/${pathname}` : hostname;

    const params: Record<string, string> = {};
    parsed.searchParams.forEach((value, key) => {
      params[key] = value;
    });

    // If data param exists, decode base64 JSON and merge into params
    if (params.data) {
      try {
        const json = JSON.parse(Buffer.from(params.data, 'base64').toString('utf-8'));
        if (json && typeof json === 'object') {
          Object.assign(params, json);
        }
      } catch {
        // Ignore decode errors
      }
      // Remove raw base64 blob so it isn't forwarded to the renderer
      delete params.data;
    }

    return { action, params };
  } catch {
    return null;
  }
};

/** Pending deep-link URL received before the window was ready */
let pendingDeepLinkUrl: string | null = process.argv.find(isDeepLinkArg) || null;

/**
 * Send the deep-link payload to the renderer via IPC bridge.
 * If the window isn't ready yet, queue it.
 */
const handleDeepLinkUrl = (url: string) => {
  const parsed = parseDeepLinkUrl(url);
  if (!parsed) return;

  if (!mainWindow || mainWindow.isDestroyed()) {
    // Window not ready yet - last-write-wins: only the most recent deep link is kept,
    // which is intentional since the user can only act on one at a time.
    pendingDeepLinkUrl = url;
    return;
  }

  ipcBridge.deepLink.received.emit(parsed);
};

// ============ Single Instance Lock ============
// Acquire lock early so the second instance quits before doing unnecessary work.
// When a second instance starts (e.g. from protocol URL), it sends its data
// to the first instance via second-instance event, then quits.
const isE2ETestMode = process.env.NEXUS_E2E_TEST === '1';
const deepLinkFromArgv = process.argv.find(isDeepLinkArg);
const gotTheLock = isE2ETestMode ? true : app.requestSingleInstanceLock({ deepLinkUrl: deepLinkFromArgv });

if (!gotTheLock) {
  console.warn(`${APP_LOG_PREFIX} Another instance is already running; current process will exit.`);
  app.quit();
} else {
  app.on('second-instance', (_event, argv, _workingDirectory, additionalData) => {
    // Prefer additionalData (reliable on all platforms), fallback to argv scan
    const deepLinkUrl = (additionalData as { deepLinkUrl?: string })?.deepLinkUrl || argv.find(isDeepLinkArg);
    if (deepLinkUrl) {
      handleDeepLinkUrl(deepLinkUrl);
    }
    // Focus existing window or recreate one if needed.
    if (isWebUIMode || isResetPasswordMode) {
      return;
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      return;
    }

    const existingWindow = BrowserWindow.getAllWindows().find((win) => !win.isDestroyed());
    if (existingWindow) {
      mainWindow = existingWindow;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      return;
    }

    if (app.isReady()) {
      createWindow();
    }
  });
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
// 修复 macOS 和 Linux 下 GUI 应用的 PATH 环境变量,使其与命令行一致
if (process.platform === 'darwin' || process.platform === 'linux') {
  fixPath();

  // Supplement nvm paths that fix-path might miss (nvm is often only in .zshrc, not .zshenv)
  const nvmDir = process.env.NVM_DIR || path.join(process.env.HOME || '', '.nvm');
  const nvmVersionsDir = path.join(nvmDir, 'versions', 'node');
  if (fs.existsSync(nvmVersionsDir)) {
    try {
      const versions = fs.readdirSync(nvmVersionsDir);
      const nvmPaths = versions.map((v) => path.join(nvmVersionsDir, v, 'bin')).filter((p) => fs.existsSync(p));
      if (nvmPaths.length > 0) {
        const currentPath = process.env.PATH || '';
        const missingPaths = nvmPaths.filter((p) => !currentPath.includes(p));
        if (missingPaths.length > 0) {
          process.env.PATH = [...missingPaths, currentPath].join(path.delimiter);
        }
      }
    } catch {
      // Ignore errors when reading nvm directory
    }
  }
}

// Handle Squirrel startup events (Windows installer)
if (electronSquirrelStartup) {
  app.quit();
}

// ============ Custom Asset Protocol ============
// Register aion-asset:// as a privileged scheme BEFORE app.whenReady().
// This protocol serves local files/assets bypassing
// the browser security policy that blocks file:// URLs from http://localhost.
protocol.registerSchemesAsPrivileged([
  {
    scheme: AION_ASSET_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

// 主进程全局错误处理器
// Global error handlers for main process
// 捕获未处理的同步异常，防止显示 Electron 默认错误对话框
// Catch uncaught synchronous exceptions to prevent Electron's default error dialog
process.on('uncaughtException', (error) => {
  // 在生产环境中，将错误上报到 CrashReporter
  // In production, send error to CrashReporter
  if (process.env.NODE_ENV !== 'development') {
    captureException(error, { process_type: 'main' });
  }
});

// 捕获未处理的 Promise 拒绝，避免应用崩溃
// Catch unhandled Promise rejections to prevent app crashes
process.on('unhandledRejection', (reason, _promise) => {
  // 上报未处理的 Promise 拒绝到 CrashReporter
  // Send unhandled rejection to CrashReporter
  if (process.env.NODE_ENV !== 'development') {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    captureException(error, { process_type: 'main', component: 'unhandledRejection' });
  }
});

// Route SIGINT (Ctrl+C) and SIGTERM through Electron's quit lifecycle so that
// the before-quit handler runs and cleans up child processes (scode, etc.).
// Without this, Node.js default signal handling kills the process immediately,
// bypassing before-quit and leaving child processes orphaned.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    console.log(`${APP_LOG_PREFIX} Received ${sig}, triggering app.quit()`);
    app.quit();
  });
}

const hasSwitch = (flag: string) => process.argv.includes(`--${flag}`) || app.commandLine.hasSwitch(flag);
const getSwitchValue = (flag: string): string | undefined => {
  const withEqualsPrefix = `--${flag}=`;
  const equalsArg = process.argv.find((arg) => arg.startsWith(withEqualsPrefix));
  if (equalsArg) {
    return equalsArg.slice(withEqualsPrefix.length);
  }

  const argIndex = process.argv.indexOf(`--${flag}`);
  if (argIndex !== -1) {
    const nextArg = process.argv[argIndex + 1];
    if (nextArg && !nextArg.startsWith('--')) {
      return nextArg;
    }
  }

  const cliValue = app.commandLine.getSwitchValue(flag);
  return cliValue || undefined;
};
const hasCommand = (cmd: string) => process.argv.includes(cmd);

const WEBUI_CONFIG_FILE = 'webui.config.json';

type WebUIUserConfig = {
  port?: number | string;
  allowRemote?: boolean;
};

const parsePortValue = (value: unknown, _sourceLabel: string): number | null => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const portNumber = typeof value === 'number' ? value : parseInt(String(value), 10);
  if (!Number.isFinite(portNumber) || portNumber < 1 || portNumber > 65535) {
    return null;
  }
  return portNumber;
};

const loadUserWebUIConfig = (): { config: WebUIUserConfig; path: string | null; exists: boolean } => {
  try {
    const userDataPath = app.getPath('userData');
    const configPath = path.join(userDataPath, WEBUI_CONFIG_FILE);
    if (!fs.existsSync(configPath)) {
      return { config: {}, path: configPath, exists: false };
    }

    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { config: {}, path: configPath, exists: false };
    }
    return { config: parsed as WebUIUserConfig, path: configPath, exists: true };
  } catch (error) {
    return { config: {}, path: null, exists: false };
  }
};

const resolveWebUIPort = (config: WebUIUserConfig): number => {
  const cliPort = parsePortValue(getSwitchValue('port') ?? getSwitchValue('webui-port'), 'CLI (--port)');
  if (cliPort) return cliPort;

  const envPort = parsePortValue(process.env.NEXUS_PORT ?? process.env.PORT, 'environment variable (NEXUS_PORT/PORT)');
  if (envPort) return envPort;

  const configPort = parsePortValue(config.port, 'webui.config.json');
  if (configPort) return configPort;

  return SERVER_CONFIG.DEFAULT_PORT;
};

const parseBooleanEnv = (value?: string): boolean | null => {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
};

const resolveRemoteAccess = (config: WebUIUserConfig): boolean => {
  const envRemote = parseBooleanEnv(process.env.NEXUS_ALLOW_REMOTE || process.env.NEXUS_REMOTE);
  const hostHint = process.env.NEXUS_HOST?.trim();
  const hostRequestsRemote = hostHint ? ['0.0.0.0', '::', '::0'].includes(hostHint) : false;
  const configRemote = config.allowRemote === true;

  return isRemoteMode || hostRequestsRemote || envRemote === true || configRemote;
};

const isWebUIMode = hasSwitch('webui');
const isRemoteMode = hasSwitch('remote');
const isResetPasswordMode = hasCommand('--resetpass');
const isVersionMode = hasCommand('--version') || hasCommand('-v');

// Flag to distinguish intentional quit from unexpected exit in WebUI mode
let isExplicitQuit = false;

let mainWindow: BrowserWindow;
let avatarWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

/**
 * SUDOWORK_AVATAR_DEV=1 fast-path for dev iteration: opens the avatar
 * window immediately without waiting for the persisted user setting
 * read. Persisted setting still drives behavior at init time and via
 * the runtime listener below.
 */
function isAvatarDevEnvSet(): boolean {
  const v = process.env['SUDOWORK_AVATAR_DEV'];
  return v === '1' || v === 'true';
}

function openAvatarWindow(): void {
  if (avatarWindow && !avatarWindow.isDestroyed()) return;
  try {
    avatarWindow = createAvatarWindow();
    avatarWindow.on('closed', () => {
      avatarWindow = null;
    });
  } catch (error) {
    mainError('App', 'Failed to create avatar window:', error);
  }
}

function closeAvatarWindow(): void {
  if (avatarWindow && !avatarWindow.isDestroyed()) {
    avatarWindow.close();
  }
  avatarWindow = null;
}

let isQuitting = false;
let closeToTrayEnabled = false;
let quitCleanupInProgress = false;
let quitCleanupCompleted = false;
let quitCleanupTimeout: NodeJS.Timeout | null = null;
const QUIT_CLEANUP_TIMEOUT_MS = 10_000;

function finishAppQuit(force = false): void {
  if (quitCleanupCompleted) {
    return;
  }

  quitCleanupCompleted = true;
  quitCleanupInProgress = false;

  if (quitCleanupTimeout) {
    clearTimeout(quitCleanupTimeout);
    quitCleanupTimeout = null;
  }

  if (force) {
    app.exit(0);
    return;
  }

  app.quit();
}

const getNativeBrandAssetPath = (fileName: string, defaultFileName = fileName): string => {
  const generatedPath = app.isPackaged ? path.join(process.resourcesPath, fileName) : path.join(process.cwd(), '.cache', 'native-brand', 'current', fileName);
  if (fs.existsSync(generatedPath)) return generatedPath;
  const fallbackPath = app.isPackaged ? path.join(process.resourcesPath, defaultFileName) : path.join(process.cwd(), 'resources', defaultFileName);
  return fallbackPath;
};

/**
 * 获取托盘图标 / Get tray icon
 * macOS 使用 Template 图标以适配深色/浅色菜单栏
 * macOS uses Template image to adapt to dark/light menu bar
 */
const getTrayIcon = (): Electron.NativeImage => {
  const iconFile = process.platform === 'darwin' ? 'trayTemplate.png' : process.platform === 'win32' ? 'app.ico' : 'app.png';
  const icon = nativeImage.createFromPath(getNativeBrandAssetPath(iconFile, 'app.png'));

  if (icon.isEmpty()) {
    console.warn('[Tray] Icon file is empty');
    return nativeImage.createEmpty();
  }

  if (process.platform === 'darwin') {
    icon.setTemplateImage(true);
    return icon;
  }
  return icon.resize({ width: 32, height: 32 });
};

/**
 * 构建托盘右键菜单 / Build tray context menu
 */
const buildTrayContextMenu = (): Electron.Menu => {
  // Ensure i18n is initialized before building menu
  // 确保 i18n 在构建菜单前已初始化
  const showWindowLabel = i18n.t('common.tray.showWindow');
  const toggleThemeLabel = i18n.t('common.tray.toggleTheme');
  const quitLabel = i18n.t('common.tray.quit');

  return Menu.buildFromTemplate([
    {
      label: showWindowLabel,
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    ...(!app.isPackaged
      ? [
          {
            label: toggleThemeLabel,
            click: () => ipcBridge.application.toggleTheme.emit(),
          },
        ]
      : []),
    { type: 'separator' },
    {
      label: quitLabel,
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
};

/**
 * 创建系统托盘 / Create system tray
 */
const createOrUpdateTray = (): void => {
  try {
    const icon = getTrayIcon();
    if (!tray) {
      tray = new Tray(icon);
      tray.on('click', () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      });
    } else {
      tray.setImage(icon);
    }

    tray.setToolTip(brand.displayName);

    // 确保 i18n 已初始化后再设置菜单
    // Ensure i18n is initialized before setting menu
    const contextMenu = buildTrayContextMenu();
    tray.setContextMenu(contextMenu);

    console.log('[Tray] Created with menu labels:', {
      showWindow: i18n.t('common.tray.showWindow'),
      quit: i18n.t('common.tray.quit'),
      language: i18n.language,
    });
  } catch (err) {
    console.error('[Tray] Failed to create or update tray:', err);
  }
};

/**
 * 刷新托盘右键菜单文案（语言切换时调用）/ Refresh tray context menu labels (called on language change)
 */
const refreshTrayMenu = (): void => {
  if (tray) {
    tray.setContextMenu(buildTrayContextMenu());
    tray.setToolTip(brand.displayName);
  }
};

/**
 * 销毁系统托盘 / Destroy system tray
 */
const destroyTray = (): void => {
  if (tray) {
    tray.destroy();
    tray = null;
  }
};

const createWindow = (): void => {
  console.log(`[${brand.displayName}] Creating main window...`);
  // Get primary display size
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  // Keep the bootstrap/install window compact enough for focused status reading.
  const windowWidth = Math.max(980, Math.min(Math.floor(screenWidth * 0.72), 1180));
  const windowHeight = Math.max(680, Math.min(Math.floor(screenHeight * 0.72), 800));

  let windowIcon: Electron.NativeImage | undefined;
  if (process.platform !== 'darwin') {
    const iconFile = process.platform === 'win32' ? 'app.ico' : app.isPackaged ? 'app.png' : 'app_dev.png';
    const icon = nativeImage.createFromPath(getNativeBrandAssetPath(iconFile));
    if (!icon.isEmpty()) windowIcon = icon;
  }

  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    show: false, // Hide until CSS is loaded to prevent FOUC
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    ...(windowIcon ? { icon: windowIcon } : {}),
    // Custom titlebar configuration / 自定义标题栏配置
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hidden',
          trafficLightPosition: { x: 10, y: 14 },
        }
      : { frame: false }),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      webviewTag: true, // 启用 webview 标签用于 HTML 预览 / Enable webview tag for HTML preview
      allowRunningInsecureContent: false,
      webSecurity: true,
      // Allow webview to load file:// URLs for local PDF preview
      // 允许 webview 加载本地文件协议用于 PDF 预览
      sandbox: false,
    },
  });
  console.log(`[${brand.displayName}] Main window created (id=${mainWindow.id})`);

  // Show window after content is ready to prevent FOUC (Flash of Unstyled Content)
  // Use 'ready-to-show' which fires when renderer has painted first frame,
  // combined with 'did-finish-load' as belt-and-suspenders approach.
  const showWindow = () => {
    if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  };
  mainWindow.once('ready-to-show', () => {
    // Telemetry: mark first window show time for cold_start metric
    markFirstWindowShow();

    // Breadcrumb: window created and ready
    windowBreadcrumbs.create(mainWindow.id.toString(), 'main');

    showWindow();
  });
  // Belt-and-suspenders: also show on did-finish-load in case ready-to-show already fired
  mainWindow.webContents.once('did-finish-load', () => {
    // Breadcrumb: page loaded
    windowBreadcrumbs.loadComplete('main-window');

    showWindow();
  });
  // Fallback: show window after 5s even if events don't fire (e.g. loadURL failure)
  setTimeout(showWindow, 5000);

  initMainAdapterWithWindow(mainWindow);
  setupApplicationMenu();
  void applyZoomToWindow(mainWindow);
  registerWindowMaximizeListeners(mainWindow);

  // Avatar fast-path: SUDOWORK_AVATAR_DEV=1 opens the floating window
  // immediately (before backend init), useful for dev iteration. The
  // persisted user setting is honored separately after initializeProcess()
  // completes — see the post-init block below.
  // SUDOWORK_AVATAR_DEV=1 在 init 完成前就打开 avatar，方便开发迭代；
  // 持久化的用户设置由 init 完成后的逻辑读取。
  if (isAvatarDevEnvSet()) {
    openAvatarWindow();
  }
  mainWindow.on('closed', () => {
    closeAvatarWindow();
  });

  // Handle fullscreen transitions: ensure avatar window appears on the correct screen
  // when main window enters fullscreen mode on macOS
  mainWindow.on('enter-full-screen', () => {
    if (avatarWindow && !avatarWindow.isDestroyed()) {
      // Move avatar to the display where the main window is fullscreen
      const display = screen.getDisplayMatching(mainWindow.getBounds());
      const { x, y, width, height } = display.bounds;
      const avatarBounds = avatarWindow.getBounds();
      // Position avatar at bottom-right of the fullscreen display
      avatarWindow.setPosition(x + width - avatarBounds.width - 16, y + height - avatarBounds.height - 16);
    }
  });

  mainWindow.on('leave-full-screen', () => {
    if (avatarWindow && !avatarWindow.isDestroyed()) {
      // Restore avatar to work area position
      const workArea = screen.getPrimaryDisplay().workArea;
      const avatarBounds = avatarWindow.getBounds();
      avatarWindow.setPosition(workArea.x + workArea.width - avatarBounds.width - 16, workArea.y + workArea.height - avatarBounds.height - 16);
    }
  });

  // Initialize auto-updater service (skip when disabled via env, e.g. E2E / CI, or nightly builds)
  // 初始化自动更新服务（通过环境变量禁用时跳过，例如 E2E / CI 场景；nightly 版本也跳过自动更新提醒）
  const isCiRuntime = process.env.CI === 'true' || process.env.CI === '1' || process.env.GITHUB_ACTIONS === 'true';
  const disableAutoUpdater = process.env.NEXUS_DISABLE_AUTO_UPDATE === '1' || process.env.NEXUS_E2E_TEST === '1' || isCiRuntime;
  if (!disableAutoUpdater) {
    Promise.all([import('./process/services/autoUpdaterService'), import('./process/bridge/updateBridge'), import('./common/systemConfig')])
      .then(([{ autoUpdaterService }, { createAutoUpdateStatusBroadcast }, { fetchSystemConfig, isVersionUpdateEnabled }]) => {
        // Create status broadcast callback that emits via ipcBridge (pure emitter, no window binding)
        const statusBroadcast = createAutoUpdateStatusBroadcast();
        autoUpdaterService.initialize(statusBroadcast);
        // §4.1(3)/§4.4: fill the main-process system-config cache first (eliminates the startup
        // race where version_update.enabled is read before the cache is populated), then gate.
        void fetchSystemConfig().then(() => {
          // Skip auto-update check for nightly builds – nightly versions should only be
          // updated manually via the in-app update modal which already handles nightly isolation.
          if (isNightlyBuild) {
            mainLog('App', 'Nightly build detected, skipping auto-update check');
          } else if (!isVersionUpdateEnabled()) {
            // §4.4: server disabled auto-update — skip the check entirely.
            mainLog('App', 'version_update disabled by server config, skipping auto-update check');
          } else {
            // Check for updates after 3 seconds delay
            // 3秒后检查更新
            mainLog('App', 'Stable release, auto-check will use COS mirror');
            setTimeout(() => {
              void autoUpdaterService.checkForUpdatesAndNotify();
            }, 3000);
          }
        });
      })
      .catch((error) => {
        console.error('[App] Failed to initialize autoUpdaterService:', error);
      });
  }

  // Load the renderer: dev server URL in development, built HTML file in production
  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  const fallbackFile = path.join(__dirname, '../renderer/index.html');

  if (!app.isPackaged && rendererUrl) {
    const tryLoadURL = (attempt: number) => {
      mainWindow.loadURL(rendererUrl).catch((error) => {
        if (attempt < 5 && !mainWindow.isDestroyed()) {
          console.warn(`${APP_LOG_PREFIX} loadURL attempt ${attempt + 1} failed, retrying in 1s...`, error.message || error);
          setTimeout(() => tryLoadURL(attempt + 1), 1000);
        } else {
          console.error(`${APP_LOG_PREFIX} loadURL failed after retries, falling back to file:`, error.message || error);
          mainWindow.loadFile(fallbackFile).catch((e2) => {
            console.error(`${APP_LOG_PREFIX} loadFile fallback also failed:`, e2.message || e2);
          });
        }
      });
    };
    tryLoadURL(0);
  } else {
    mainWindow.loadFile(fallbackFile).catch((error) => {
      console.error(`${APP_LOG_PREFIX} loadFile failed:`, error.message || error);
    });
  }

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error(`${APP_LOG_PREFIX} did-fail-load:`, { errorCode, errorDescription, validatedURL, isMainFrame });
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`${APP_LOG_PREFIX} render-process-gone:`, details);
    // CrashReporter: capture renderer crash
    if (details.reason !== 'clean-exit' && details.reason !== 'killed') {
      captureRendererCrash(details);
    }
  });

  mainWindow.webContents.on('unresponsive', () => {
    console.warn(`${APP_LOG_PREFIX} Renderer became unresponsive`);
  });

  mainWindow.on('closed', () => {
    console.log(`${APP_LOG_PREFIX} Main window closed`);

    // Breadcrumb: window closed
    windowBreadcrumbs.close('main');
  });

  // 只在开发环境自动打开 DevTools / Only auto-open DevTools in development
  // 使用 app.isPackaged 判断更可靠，打包后的应用不会自动打开 DevTools
  // Using app.isPackaged is more reliable, packaged apps won't auto-open DevTools
  const disableDevToolsByEnv = process.env.NEXUS_DISABLE_DEVTOOLS === '1' || process.env.NEXUS_E2E_TEST === '1';
  if (!app.isPackaged && !disableDevToolsByEnv) {
    mainWindow.webContents.openDevTools();

    // Breadcrumb: DevTools opened
    windowBreadcrumbs.devToolsOpen(mainWindow.id.toString());
  }

  // Listen to DevTools state changes and notify Renderer
  mainWindow.webContents.on('devtools-opened', () => {
    ipcBridge.application.devToolsStateChanged.emit({ isOpen: true });
  });

  mainWindow.webContents.on('devtools-closed', () => {
    ipcBridge.application.devToolsStateChanged.emit({ isOpen: false });
  });

  // 关闭拦截：当启用"关闭到托盘"时，隐藏窗口而非关闭
  // Close interception: hide window instead of closing when "close to tray" is enabled
  mainWindow.on('close', (event) => {
    if (closeToTrayEnabled && !isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
};

// Menu.setApplicationMenu(null);

ipcBridge.application.isDevToolsOpened.provider(() => {
  if (mainWindow) {
    return Promise.resolve(mainWindow.webContents.isDevToolsOpened());
  }
  return Promise.resolve(false);
});

ipcBridge.application.openDevTools.provider(() => {
  if (mainWindow) {
    const wasOpen = mainWindow.webContents.isDevToolsOpened();

    if (wasOpen) {
      mainWindow.webContents.closeDevTools();
      // Close is synchronous, return immediately
      return Promise.resolve(false);
    } else {
      // Open is async, wait for the event
      return new Promise((resolve) => {
        const onOpened = () => {
          mainWindow.webContents.off('devtools-opened', onOpened);
          resolve(true);
        };

        mainWindow.webContents.once('devtools-opened', onOpened);
        mainWindow.webContents.openDevTools();

        // Fallback timeout in case event doesn't fire
        setTimeout(() => {
          mainWindow.webContents.off('devtools-opened', onOpened);
          const isNowOpen = mainWindow.webContents.isDevToolsOpened();
          resolve(isNowOpen);
        }, 500);
      });
    }
  }
  return Promise.resolve(false);
});

const handleAppReady = async (): Promise<void> => {
  // CLI mode: print app version and exit immediately (used by CI smoke tests)
  if (isVersionMode) {
    app.exit(0);
    return;
  }

  protocol.handle(AION_ASSET_PROTOCOL, createAssetProtocolResponse);

  // Packaged macOS apps get their Dock icon from the generated ICNS file.
  if (process.platform === 'darwin' && !app.isPackaged && app.dock) {
    const icon = nativeImage.createFromPath(getNativeBrandAssetPath('app_dev.png'));
    if (!icon.isEmpty()) app.dock.setIcon(icon);
  }

  if (isResetPasswordMode) {
    // Password reset and WebUI modes need initializeProcess() before proceeding
    try {
      await initializeProcess();
    } catch (error) {
      console.error('Failed to initialize process:', error);
      app.exit(1);
      return;
    }

    // Handle password reset without creating window
    try {
      // Get username argument, filtering out flags (--xxx)
      // 获取用户名参数，过滤掉标志（--xxx）
      const resetPasswordIndex = process.argv.indexOf('--resetpass');
      const argsAfterCommand = process.argv.slice(resetPasswordIndex + 1);
      const username = argsAfterCommand.find((arg) => !arg.startsWith('--')) || 'admin';

      // Import resetpass logic
      const { resetPasswordCLI } = await import('./utils/resetPasswordCLI');
      await resetPasswordCLI(username);

      app.quit();
    } catch (error) {
      app.exit(1);
    }
  } else if (isWebUIMode) {
    try {
      await initializeProcess();
    } catch (error) {
      console.error('Failed to initialize process:', error);
      app.exit(1);
      return;
    }

    await ensureMainSystemConfig();

    const userConfigInfo = loadUserWebUIConfig();
    if (userConfigInfo.exists && userConfigInfo.path) {
      // Config file loaded from user directory
    }
    const resolvedPort = resolveWebUIPort(userConfigInfo.config);
    const allowRemote = resolveRemoteAccess(userConfigInfo.config);
    await startWebServer(resolvedPort, allowRemote);

    // Keep the process alive in WebUI mode by preventing default quit behavior.
    // On Linux headless (systemd), Electron may attempt to quit when no windows exist.
    app.on('will-quit', (event) => {
      // Only prevent quit if this is an unexpected exit (server still running).
      // Explicit app.exit() calls bypass will-quit, so they are unaffected.
      if (!isExplicitQuit) {
        event.preventDefault();
        console.warn('[WebUI] Prevented unexpected quit - server is still running');
      }
    });
  } else {
    // PERF: Create window FIRST so user sees the InitLoading UI immediately (~200ms),
    // then initialize backend in parallel. The renderer's InitContext uses exponential
    // backoff retry for IPC calls, so it gracefully handles bridges not being ready yet.
    createWindow();

    // Start backend initialization in parallel with window rendering
    const initDone = initializeProcess().catch((error) => {
      console.error('Failed to initialize process:', error);
      app.exit(1);
    });

    // Start ACP detection in background (uses execSync internally, which blocks event loop)
    const acpDetectionDone = initializeAcpDetector();

    // Wait for backend initialization to complete before proceeding with tray/settings
    await initDone;

    await ensureMainSystemConfig();

    // Telemetry: initialize telemetry modules after process config is ready
    try {
      await initializeTelemetry();
      // Initialize CrashReporter after telemetry is ready
      await initCrashReporter();
      // Add app start breadcrumb
      systemBreadcrumbs.appStart();
    } catch (error) {
      console.error('[App] Failed to initialize telemetry/crash reporter:', error);
      // Don't exit on telemetry init failure - it's non-critical
    }

    // Keep detection running in background; log when it finishes.
    void acpDetectionDone.then(() => {
      console.log('[ACP] Background detection completed');
    });

    // 初始化关闭到托盘设置 / Initialize close-to-tray setting
    if (isE2ETestMode) {
      closeToTrayEnabled = false;
      destroyTray();
    } else {
      try {
        const savedCloseToTray = await ProcessConfig.get('system.closeToTray');
        closeToTrayEnabled = savedCloseToTray ?? false;

        // 无论设置如何，启动时都创建托盘图标（确保图标常驻）
        // Regardless of setting, create tray icon on startup (ensure it's persistent)
        createOrUpdateTray();
      } catch {
        // Ignore storage read errors, default to false
      }

      // 监听设置变更（通过 bridge 库）/ Listen for setting changes (via bridge library)
      onCloseToTrayChanged((enabled) => {
        closeToTrayEnabled = enabled;
        // 托盘图标现在是常驻的，变更设置只需更新内部逻辑标识，不需要创建/销毁托盘
        // Tray icon is now persistent, change setting only updates internal flag
      });
    }

    // 监听语言变更，刷新托盘菜单文案 / Listen for language changes to refresh tray menu labels
    onLanguageChanged(() => {
      refreshTrayMenu();
    });

    // 初始化 avatar 浮窗：读持久化设置；SUDOWORK_AVATAR_DEV 开发覆盖在窗口创建时已生效
    // Initialize floating avatar from persisted setting (SUDOWORK_AVATAR_DEV
    // override is already applied at window creation time)
    try {
      const savedAvatarEnabled = await ProcessConfig.get('avatar.enabled');
      if (savedAvatarEnabled === true) {
        openAvatarWindow();
      }
    } catch (error) {
      mainError('App', 'Failed to read avatar.enabled setting:', error);
    }
    // 监听 avatar 开关变更（用户在设置 UI 切换时立即生效）
    // Listen for avatar toggle changes (apply immediately when user toggles in Settings)
    onAvatarEnabledChanged((enabled) => {
      if (enabled) openAvatarWindow();
      else closeAvatarWindow();
    });

    // Flush pending deep-link URL (received before window was ready)
    if (pendingDeepLinkUrl) {
      const url = pendingDeepLinkUrl;
      pendingDeepLinkUrl = null;
      // Wait for renderer to be ready before sending
      mainWindow.webContents.once('did-finish-load', () => {
        handleDeepLinkUrl(url);
      });
    }
  }

  // WebUI mode also needs ACP detection for remote agent access
  if (isWebUIMode) {
    await initializeAcpDetector();
  }

  if (!isResetPasswordMode) {
    // Preload shell environment and apply it to process.env so workers forked
    // later inherit the complete PATH (nvm, npm globals, .zshrc paths, etc.)
    // This ensures custom skills that depend on globally installed tools work correctly.
    void loadShellEnvironmentAsync().then((shellEnv) => {
      if (shellEnv.PATH) {
        process.env.PATH = mergePaths(process.env.PATH, shellEnv.PATH);
      }
      // Apply other shell env vars (SSL certs, auth tokens) that may be missing
      for (const [key, value] of Object.entries(shellEnv)) {
        if (key !== 'PATH' && !process.env[key]) {
          process.env[key] = value;
        }
      }
    });
  }

  // Verify CDP is ready and log status
  const { cdpPort, verifyCdpReady } = await import('./utils/configureChromium');
  if (cdpPort) {
    await verifyCdpReady(cdpPort);
  }

  // Listen for system resume (wake from sleep/hibernate) to recover missed cron jobs
  powerMonitor.on('resume', () => {
    import('@process/services/cron/CronService')
      .then(({ cronService }) => {
        void cronService.handleSystemResume();
      })
      .catch((error) => {
        console.error('[App] Failed to handle system resume for cron:', error);
      });

    // Resume channel plugins (re-establish connections lost during sleep)
    import('@/channels')
      .then(({ getChannelManager }) => {
        void getChannelManager().resumePlugins();
      })
      .catch((error) => {
        console.error('[App] Failed to handle system resume for channels:', error);
      });
  });
};

// ============ Protocol Registration ============
// Register sudowork:// scheme as default protocol client for deep links and OAuth2 redirect.
for (const scheme of PROTOCOL_SCHEMES) {
  if (process.defaultApp) {
    // Dev mode: need to pass execPath explicitly
    app.setAsDefaultProtocolClient(scheme, process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(scheme);
  }
}

// macOS: handle sudowork:// URLs via the open-url event
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLinkUrl(url);
  // Focus existing window so user sees the result
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// Ensure we don't miss the ready event when running in CLI/WebUI mode
void app
  .whenReady()
  .then(handleAppReady)
  .catch((_error) => {
    // App initialization failed
    app.quit();
  });

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  // 当关闭到托盘启用时，不退出应用 / Don't quit when close-to-tray is enabled
  if (closeToTrayEnabled) {
    return;
  }
  // In WebUI mode, don't quit when windows are closed since we're running a web server
  if (!isWebUIMode && process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (!isWebUIMode && app.isReady()) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      // 从托盘恢复隐藏的窗口 / Restore hidden window from tray
      mainWindow.show();
      mainWindow.focus();
      if (process.platform === 'darwin' && app.dock) {
        void app.dock.show();
      }
    } else if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  }
});

app.on('before-quit', (event) => {
  if (quitCleanupCompleted) {
    return;
  }

  event.preventDefault();

  if (quitCleanupInProgress) {
    return;
  }

  quitCleanupInProgress = true;
  console.log(`${APP_LOG_PREFIX} before-quit`);
  isQuitting = true;
  isExplicitQuit = true;
  destroyTray();
  quitCleanupTimeout = setTimeout(() => {
    console.error(`${APP_LOG_PREFIX} Quit cleanup timed out after ${QUIT_CLEANUP_TIMEOUT_MS}ms, forcing exit`);
    finishAppQuit(true);
  }, QUIT_CLEANUP_TIMEOUT_MS);

  void (async () => {
    // Clean up work processes (per-conversation agents).
    // Await to ensure child processes (especially scode on Windows) are terminated
    // before the app exits, preventing orphaned processes.
    try {
      await WorkerManage.clear();
    } catch (error) {
      console.error('[App] Failed to clear work processes:', error);
    }

    // Stop all managed services (Nexus, Sudoclaw gateway)
    try {
      const { serviceManager } = await import('./process/services/serviceManager');
      await serviceManager.shutdown();
    } catch {
      // Ignore cleanup errors
    }

    // Shutdown Channel subsystem
    try {
      const { getChannelManager } = await import('@/channels');
      await getChannelManager().shutdown();
    } catch (error) {
      console.error('[App] Failed to shutdown ChannelManager:', error);
    }

    // Telemetry: flush remaining events before exit
    try {
      // Add app quit breadcrumb
      systemBreadcrumbs.appQuit();
      await shutdownTelemetry();
    } catch (error) {
      console.error('[App] Failed to shutdown telemetry:', error);
    }

    try {
      const { flushSudoworkLogUploader } = await import('./process/utils/sudoworkLogUploader');
      await flushSudoworkLogUploader();
    } catch (error) {
      console.error('[App] Failed to flush Sudowork Log uploader:', error);
    }

    finishAppQuit();
  })();
});

app.on('will-quit', () => {});

app.on('quit', (_event, exitCode) => {
  console.log('exitCode', exitCode);
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
