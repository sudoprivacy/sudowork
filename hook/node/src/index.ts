import { FileInterceptor } from './file/FileInterceptor';
import { NexusController, updateBlacklistConfig } from './nexus/NexusController';
import { Nexus } from './nexus/Nexus';
import { FileController, type FileFlag } from './file/FileController';
import { BatchInterceptor, type RequestController } from '@mswjs/interceptors';
import NodeInterceptors from '@mswjs/interceptors/presets/node';
import type { BlacklistConfig } from './blacklist/types';
import { ProcessInterceptor } from './process/ProcessInterceptor';
import type { ProcessController } from './process/ProcessController';
import { AdbStdoutCapture } from './process/AdbStdoutCapture';
import { SudoclawConfigGuard } from './process/SudoclawConfigGuard';

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
let adbStdoutCapture: AdbStdoutCapture | null = null;
let sudoclawConfigGuard: SudoclawConfigGuard | null = null;
let isApplied = false;
let nexusController: NexusController | null = null;
let configPollingTimer: NodeJS.Timeout | null = null;
let currentNexusUrl: string = 'http://127.0.0.1:12012';
let currentStatePollingInterval: number = 3000;
let fastPassEnabled = false;

/** Unified hook config path: combines enabled state + blacklist in one file */
const HOOK_CONFIG_PATH = '/safe/config/hook';

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

  // ai-dev-browser stdout capture — only enabled when sudowork provided
  // sidechannel endpoint + secret via customEnv. No-op otherwise.
  const adbUrl = process.env.AI_DEV_BROWSER_SIDECHANNEL_URL;
  const adbSecret = process.env.AI_DEV_BROWSER_SIDECHANNEL_SECRET;
  if (adbUrl && adbSecret && !adbStdoutCapture) {
    try {
      adbStdoutCapture = new AdbStdoutCapture({
        sidechannelUrl: adbUrl,
        sidechannelSecret: adbSecret,
      });
      adbStdoutCapture.apply();
      console.error(`[SafetyHook] ai-dev-browser stdout capture enabled (sidechannel=${adbUrl})`);
    } catch (err) {
      console.error('[SafetyHook] Failed to apply ai-dev-browser stdout capture:', err);
      adbStdoutCapture = null;
    }
  }

  // Always-on: prevent the LLM from re-enabling openclaw's builtin browser
  // via gateway.config.patch by pinning `browser.enabled` back to false on
  // every write to sudoclaw.json. This is cheap and has no dependencies.
  if (!sudoclawConfigGuard) {
    try {
      sudoclawConfigGuard = new SudoclawConfigGuard();
      sudoclawConfigGuard.apply();
    } catch (err) {
      console.error('[SafetyHook] Failed to apply sudoclaw config guard:', err);
      sudoclawConfigGuard = null;
    }
  }

  isApplied = true;
  console.error(`[SafetyHook] Initialized with nexusUrl=${nexusUrl}, network=${enableNetwork}, file=${enableFile}`);

  // Start unified config polling (state + blacklist in one timer)
  startConfigPolling();
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
  if (adbStdoutCapture) {
    adbStdoutCapture.dispose();
    adbStdoutCapture = null;
  }
  if (sudoclawConfigGuard) {
    sudoclawConfigGuard.dispose();
    sudoclawConfigGuard = null;
  }
  nexusController = null;
  isApplied = false;
  console.error('[SafetyHook] Disposed');
}

/**
 * Read the unified hook config from Nexus filesystem.
 * Returns the full parsed config or null if unavailable.
 */
async function readHookConfig(): Promise<Record<string, unknown> | null> {
  try {
    const nexus = new Nexus(currentNexusUrl);
    const result = await nexus.read(HOOK_CONFIG_PATH, false);

    let data: Record<string, unknown> | null = null;
    if (Buffer.isBuffer(result)) {
      data = JSON.parse(result.toString('utf-8'));
    } else if (result && typeof result === 'object' && 'content' in result) {
      const content = (result as { content: unknown }).content;
      data = Buffer.isBuffer(content)
        ? JSON.parse(content.toString('utf-8'))
        : JSON.parse(String(content));
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * Start unified config polling (combines state + blacklist in a single timer).
 * Replaces the previous separate startStatePolling() and startBlacklistPolling().
 */
function startConfigPolling(): void {
  if (configPollingTimer) {
    return;
  }

  console.error(`[SafetyHook] Starting unified config polling (interval: ${currentStatePollingInterval}ms)`);

  pollConfig();

  configPollingTimer = setInterval(pollConfig, currentStatePollingInterval);
}

/**
 * Single polling callback: reads unified config once, updates both state and blacklist.
 */
async function pollConfig(): Promise<void> {
  try {
    const config = await readHookConfig();

    if (config === null) {
      // Nexus unavailable, keep current state and retry next polling
      return;
    }

    // --- State update ---
    const enabled = config.enabled === true;
    const fastPass = config.fastPass === true;
    fastPassEnabled = fastPass;

    if (!process.parentPort) {
      if (fastPass) {
        if (isApplied) {
          disposeSafetyHook();
          console.error('[SafetyHook] FastPass detected, disposed interceptors');
        }
      } else if (!enabled && isApplied) {
        disposeSafetyHook();
      } else if (enabled && !isApplied) {
        initSafetyHook({
          nexusUrl: currentNexusUrl,
          statePollingInterval: currentStatePollingInterval,
        });
      }
    }

    // --- Blacklist update ---
    const blacklist = config.blacklist as BlacklistConfig | undefined;
    if (blacklist) {
      updateBlacklistConfig(blacklist);
    }
  } catch {
    // Ignore errors during polling
  }
}

/**
 * Read enabled state from unified hook config
 * Returns null if Nexus is unavailable
 */
async function readEnabledState(): Promise<{ enabled: boolean; fastPass: boolean } | null> {
  const config = await readHookConfig();
  if (!config) return null;
  return { enabled: config.enabled === true, fastPass: config.fastPass === true };
}

/**
 * Ensure state exists in Nexus, create default if not
 */
async function ensureState(): Promise<{ enabled: boolean; fastPass: boolean }> {
  const config = await readHookConfig();
  if (config !== null) {
    return { enabled: config.enabled === true, fastPass: config.fastPass === true };
  }

  // No state exists, write default unified config
  try {
    const nexus = new Nexus(currentNexusUrl);
    await nexus.write(HOOK_CONFIG_PATH, JSON.stringify({
      ...DEFAULT_STATE,
      timestamp: Date.now(),
      blacklist: { rules: [] },
    }));
    console.error('[SafetyHook] Created default unified config in Nexus');
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
      await nexus.read(HOOK_CONFIG_PATH, false);
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
    startConfigPolling();
    return;
  }

  // Ensure state exists in Nexus
  const state = await ensureState();
  console.error(`[SafetyHook] State from Nexus: enabled=${state.enabled}, fastPass=${state.fastPass}`);

  fastPassEnabled = state.fastPass;

  if (state.fastPass) {
    // fastPass=true: skip initialization, just start polling
    console.error('[SafetyHook] FastPass enabled, skipping initialization');
    startConfigPolling();
  } else if (state.enabled) {
    // enabled=true: initialize hook
    initSafetyHook();
  } else {
    // enabled=false, fastPass=false: just start polling
    console.error('[SafetyHook] Disabled, starting polling only');
    startConfigPolling();
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
      startConfigPolling();
    });
  }
}
