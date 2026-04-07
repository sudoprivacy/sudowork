import { FileInterceptor } from './file/FileInterceptor';
import { NexusController, updateBlacklistConfig } from './nexus/NexusController';
import { Nexus } from './nexus/Nexus';
import { FileController, type FileFlag } from './file/FileController';
import { BatchInterceptor, type RequestController } from '@mswjs/interceptors';
import NodeInterceptors from '@mswjs/interceptors/presets/node';
import type { BlacklistConfig } from './blacklist/types';
import { ProcessInterceptor } from './process/ProcessInterceptor';
import type { ProcessController } from './process/ProcessController';

export interface SafetyHookOptions {
  /** Nexus server URL, defaults to http://127.0.0.1:12012 */
  nexusUrl?: string;
  /** Enable network interception, defaults to true */
  enableNetwork?: boolean;
  /** Enable file interception, defaults to true */
  enableFile?: boolean;
  /** Enable process interception, defaults to true */
  enableProcess?: boolean;
  /** Timeout in milliseconds for waiting user confirmation, defaults to 60000 (60 seconds) */
  timeout?: number;
  /** Polling interval for enabled state check (ms), defaults to 3000 */
  statePollingInterval?: number;
  /** Max retries for waiting Nexus to be ready, defaults to 30 (90 seconds) */
  nexusReadyRetries?: number;
}

let networkInterceptor: BatchInterceptor | null = null;
let fileInterceptor: FileInterceptor | null = null;
let processInterceptor: ProcessInterceptor | null = null;
let isApplied = false;
let nexusController: NexusController | null = null;
let statePollingTimer: NodeJS.Timeout | null = null;
let currentNexusUrl: string = 'http://127.0.0.1:12012';
let currentStatePollingInterval: number = 3000;
let fastPassEnabled = false;

/** Path in Nexus filesystem for enabled state */
const ENABLED_CONFIG_PATH = '/safe/config/enabled';

/** Path in Nexus filesystem for blacklist config */
const BLACKLIST_CONFIG_PATH = '/safe/config/blacklist';

/** Default state for first run */
const DEFAULT_STATE = { enabled: true, fastPass: false };

/**
 * Initialize safety hook interceptors
 */
export function initSafetyHook(options: SafetyHookOptions = {}): void {
  if (isApplied) {
    console.warn('[SafetyHook] Already applied, skipping');
    return;
  }

  const nexusUrl = options.nexusUrl || 'http://127.0.0.1:12012';
  const enableNetwork = options.enableNetwork !== false;
  const enableFile = options.enableFile !== false;
  const enableProcess = options.enableProcess !== false;
  const timeout = options.timeout || 60_000;
  const statePollingInterval = options.statePollingInterval || 3000;

  currentNexusUrl = nexusUrl;
  currentStatePollingInterval = statePollingInterval;
  nexusController = new NexusController(nexusUrl, undefined, timeout);

  if (enableNetwork) {
    networkInterceptor = new BatchInterceptor({ name: 'claw-interceptor', interceptors: NodeInterceptors });
    networkInterceptor.apply();
    networkInterceptor.on('request', async ({ request, requestId, controller }: { request: Request; requestId: string; controller: RequestController }) => {
      if (request.url.startsWith(nexusUrl)) {
        return;
      }
      const req = request.clone();
      const body = await req.text();
      await nexusController!.control(controller, {
        type: 'network',
        data: {
          requestId: requestId,
          url: req.url,
          method: req.method,
          headers: Object.fromEntries(req.headers),
          body: body,
        },
      });
    });
  }

  if (enableFile) {
    fileInterceptor = new FileInterceptor();
    fileInterceptor.apply();
    fileInterceptor.on('file', async ({ path, flags, controller }: { path: string; flags: FileFlag[]; controller: FileController }) => {
      await nexusController!.control(controller, { type: 'file', data: { path, flags } });
    });
  }

  if (enableProcess) {
    processInterceptor = new ProcessInterceptor();
    processInterceptor.apply();
    processInterceptor.on('process', async ({ command, args, controller }: { command: string; args: string[]; controller: ProcessController }) => {
      await nexusController!.control(controller, { type: 'process', data: { command, args } });
    });
  }

  isApplied = true;
  console.error(`[SafetyHook] Initialized with nexusUrl=${nexusUrl}, network=${enableNetwork}, file=${enableFile}`);

  if (!process.parentPort) {
    startStatePolling();
  }

  startBlacklistPolling();
}

/**
 * Check if safety hook is applied
 */
export function isSafetyHookApplied(): boolean {
  return isApplied;
}

/**
 * Check if fastPass mode is enabled
 */
export function isFastPassEnabled(): boolean {
  return fastPassEnabled;
}

/**
 * Dispose safety hook interceptors
 */
export function disposeSafetyHook(): void {
  if (networkInterceptor) {
    networkInterceptor.dispose();
    networkInterceptor = null;
  }
  if (fileInterceptor) {
    fileInterceptor.dispose();
    fileInterceptor = null;
  }
  if (processInterceptor) {
    processInterceptor.dispose();
    processInterceptor = null;
  }
  nexusController = null;
  isApplied = false;
  console.error('[SafetyHook] Disposed');
}

/**
 * Start polling for enabled state changes from Nexus
 */
function startStatePolling(): void {
  if (statePollingTimer) {
    return;
  }

  console.error(`[SafetyHook] Starting state polling (interval: ${currentStatePollingInterval}ms)`);

  checkStateAndAct();

  statePollingTimer = setInterval(checkStateAndAct, currentStatePollingInterval);
}

/**
 * Check enabled state from Nexus and act accordingly
 */
async function checkStateAndAct(): Promise<void> {
  try {
    const state = await readEnabledState();

    if (state === null) {
      // Nexus unavailable, keep current state and retry next polling
      return;
    }

    fastPassEnabled = state.fastPass;

    if (state.fastPass) {
      if (isApplied) {
        disposeSafetyHook();
        console.error('[SafetyHook] FastPass detected, disposed interceptors');
      }
      return;
    }

    if (!state.enabled && isApplied) {
      disposeSafetyHook();
    } else if (state.enabled && !isApplied) {
      initSafetyHook({
        nexusUrl: currentNexusUrl,
        statePollingInterval: currentStatePollingInterval,
      });
    }
  } catch (error) {
    // Ignore errors during polling
  }
}

/**
 * Read enabled state from Nexus filesystem
 * Returns null if Nexus is unavailable
 */
async function readEnabledState(): Promise<{ enabled: boolean; fastPass: boolean } | null> {
  try {
    const nexus = new Nexus(currentNexusUrl);
    const result = await nexus.read(ENABLED_CONFIG_PATH, false);

    if (Buffer.isBuffer(result)) {
      const data = JSON.parse(result.toString('utf-8'));
      return { enabled: data.enabled === true, fastPass: data.fastPass === true };
    }

    if (result && typeof result === 'object' && 'content' in result) {
      const content = result.content;
      const data = Buffer.isBuffer(content)
        ? JSON.parse(content.toString('utf-8'))
        : JSON.parse(String(content));
      return { enabled: data.enabled === true, fastPass: data.fastPass === true };
    }

    return null;
  } catch (error) {
    return null;
  }
}

/**
 * Ensure state exists in Nexus, create default if not
 */
async function ensureState(): Promise<{ enabled: boolean; fastPass: boolean }> {
  const state = await readEnabledState();
  if (state !== null) {
    return state;
  }

  // No state exists, write default
  try {
    const nexus = new Nexus(currentNexusUrl);
    await nexus.write(ENABLED_CONFIG_PATH, JSON.stringify({
      ...DEFAULT_STATE,
      timestamp: Date.now(),
    }));
    console.error('[SafetyHook] Created default state in Nexus');
    return { ...DEFAULT_STATE };
  } catch (error) {
    console.error('[SafetyHook] Failed to create default state:', error);
    return { ...DEFAULT_STATE };
  }
}

/**
 * Wait for Nexus to be ready with retries
 */
async function waitForNexusReady(maxRetries: number): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const nexus = new Nexus(currentNexusUrl);
      // Try to read any file to check if Nexus is responding
      await nexus.read(ENABLED_CONFIG_PATH, false);
      return true;
    } catch (error) {
      if (i < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }
  return false;
}

/**
 * Read blacklist config from Nexus filesystem
 */
async function readBlacklistConfig(): Promise<BlacklistConfig | null> {
  try {
    const nexus = new Nexus(currentNexusUrl);
    const result = await nexus.read(BLACKLIST_CONFIG_PATH, false);

    if (Buffer.isBuffer(result)) {
      return JSON.parse(result.toString('utf-8')) as BlacklistConfig;
    }

    if (result && typeof result === 'object' && 'content' in result) {
      const content = result.content;
      const data = Buffer.isBuffer(content)
        ? JSON.parse(content.toString('utf-8'))
        : JSON.parse(String(content));
      return data as BlacklistConfig;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Start polling for blacklist config changes
 */
function startBlacklistPolling(): void {
  readBlacklistConfig()
    .then((config) => {
      if (config) {
        updateBlacklistConfig(config);
      }
    })
    .catch(() => {});

  setInterval(async () => {
    try {
      const config = await readBlacklistConfig();
      if (config) {
        updateBlacklistConfig(config);
      }
    } catch {
      // Ignore errors
    }
  }, currentStatePollingInterval);
}

/**
 * Handle safety hook toggle message from parent process
 */
function handleSafetyHookToggle(enabled: boolean): void {
  if (enabled && !isApplied) {
    initSafetyHook();
  } else if (!enabled && isApplied) {
    disposeSafetyHook();
  }
}

// Listen for messages from parent process (Electron utilityProcess)
if (process.parentPort) {
  process.parentPort.on('message', (event: { data: { type: string; data: any } }) => {
    const { type, data } = event.data || {};
    if (type === 'safety.hook.toggle') {
      handleSafetyHookToggle(data?.enabled);
    } else if (type === 'safety.blacklist.update') {
      if (data?.config) {
        updateBlacklistConfig(data.config);
      }
    }
  });
}

// ============================================================================
// Auto-initialization when loaded via -r flag
// ============================================================================

/**
 * Bootstrap safety hook
 * 1. Wait for Nexus to be ready
 * 2. Read state from Nexus
 * 3. Initialize or skip based on state
 */
async function bootstrap(): Promise<void> {
  const maxRetries = 30; // 30 seconds max

  // Wait for Nexus to be ready
  const nexusReady = await waitForNexusReady(maxRetries);
  if (!nexusReady) {
    console.error('[SafetyHook] Nexus not ready after retries, starting polling anyway');
    startStatePolling();
    startBlacklistPolling();
    return;
  }

  // Ensure state exists in Nexus
  const state = await ensureState();
  console.error(`[SafetyHook] State from Nexus: enabled=${state.enabled}, fastPass=${state.fastPass}`);

  fastPassEnabled = state.fastPass;

  if (state.fastPass) {
    // fastPass=true: skip initialization, just start polling
    console.error('[SafetyHook] FastPass enabled, skipping initialization');
    startStatePolling();
    startBlacklistPolling();
  } else if (state.enabled) {
    // enabled=true: initialize hook
    initSafetyHook();
  } else {
    // enabled=false, fastPass=false: just start polling
    console.error('[SafetyHook] Disabled, starting polling only');
    startStatePolling();
    startBlacklistPolling();
  }
}

// Auto-apply when loaded via -r flag
if (process.env.SUDOWORK_SAFETY_HOOK !== 'false') {
  const mainScript = process.argv[1] || '';
  const isNpmProcess = mainScript.includes('npm-cli.js') || mainScript.includes('npx-cli.js') ||
    mainScript.endsWith('/npm') || mainScript.endsWith('/npx');
  const isAcpBridge = mainScript.includes('agent-acp') ||
    process.env.SUDOWORK_ACP_CHILD === '1';

  if (isNpmProcess || isAcpBridge) {
    // Skip npm/npx/ACP bridge processes
  } else {
    // Bootstrap: wait for Nexus, read state, then decide
    bootstrap().catch((error) => {
      console.error('[SafetyHook] Bootstrap failed:', error);
      // Fallback: start polling anyway
      startStatePolling();
      startBlacklistPolling();
    });
  }
}