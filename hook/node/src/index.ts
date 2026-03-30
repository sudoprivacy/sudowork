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
  /** Timeout in milliseconds for waiting user confirmation, defaults to 600000 (10 minutes) */
  timeout?: number;
  /** Polling interval for enabled state check (ms), defaults to 3000 */
  statePollingInterval?: number;
}

let networkInterceptor: BatchInterceptor | null = null;
let fileInterceptor: FileInterceptor | null = null;
let processInterceptor: ProcessInterceptor | null = null;
let isApplied = false;
let nexusController: NexusController | null = null;
let statePollingTimer: NodeJS.Timeout | null = null;
let currentNexusUrl: string = 'http://127.0.0.1:12012';
let currentStatePollingInterval: number = 3000;
let fastPassEnabled = false; // When true, allow all requests immediately

/** Path in Nexus filesystem for enabled state sync */
const ENABLED_CONFIG_PATH = '/safe/config/enabled';

/** Path in Nexus filesystem for blacklist config */
const BLACKLIST_CONFIG_PATH = '/safe/config/blacklist';

/**
 * Initialize safety hook interceptors
 * @param options Configuration options
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
  const timeout = options.timeout || 600_000;
  const statePollingInterval = options.statePollingInterval || 3000;

  currentNexusUrl = nexusUrl;
  currentStatePollingInterval = statePollingInterval;
  nexusController = new NexusController(nexusUrl, undefined, timeout);

  if (enableNetwork) {
    networkInterceptor = new BatchInterceptor({ name: 'claw-interceptor', interceptors: NodeInterceptors });
    networkInterceptor.apply();
    networkInterceptor.on('request', async ({ request, requestId, controller }: { request: Request; requestId: string; controller: RequestController }) => {
      // Skip requests to Nexus server itself (avoid infinite loop)
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

  // Start polling for enabled state changes (for Agent CLI processes without parentPort)
  if (!process.parentPort) {
    startStatePolling();
  }

  // Always load blacklist config (both CLI and worker processes need it)
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
 * When true, all requests should be allowed immediately without interception
 */
export function isFastPassEnabled(): boolean {
  return fastPassEnabled;
}

/**
 * Dispose safety hook interceptors
 */
export function disposeSafetyHook(): void {
  // Don't stop state polling - we need it to detect when user re-enables hook
  // stopStatePolling();

  if (networkInterceptor) {
    networkInterceptor.dispose();
    networkInterceptor = null;
  }
  if (fileInterceptor) {
    fileInterceptor.dispose();
    fileInterceptor = null;
  }
  nexusController = null;
  isApplied = false;
  console.error('[SafetyHook] Disposed (state polling continues)');
}

/**
 * Start polling for enabled state changes from Nexus filesystem
 */
function startStatePolling(): void {
  if (statePollingTimer) {
    return; // Already polling
  }

  console.error(`[SafetyHook] Starting state polling (interval: ${currentStatePollingInterval}ms)`);

  statePollingTimer = setInterval(async () => {
    try {
      const state = await readEnabledState();
      fastPassEnabled = state.fastPass;

      if (state.fastPass) {
        // FastPass mode: allow all requests immediately
        // If currently applied, dispose interceptors but keep polling
        if (isApplied) {
          disposeSafetyHook();
          console.error('[SafetyHook] FastPass detected, disposed interceptors');
        }
      } else if (!state.enabled && isApplied) {
        disposeSafetyHook();
      } else if (state.enabled && !isApplied) {
        initSafetyHook({
          nexusUrl: currentNexusUrl,
          statePollingInterval: currentStatePollingInterval,
        });
      }
    } catch (error) {
      // Ignore errors during polling (Nexus may be temporarily unavailable)
    }
  }, currentStatePollingInterval);
}

/**
 * Stop polling for enabled state changes
 */
function stopStatePolling(): void {
  if (statePollingTimer) {
    clearInterval(statePollingTimer);
    statePollingTimer = null;
    console.error('[SafetyHook] Stopped state polling');
  }
}

/**
 * Read enabled state from Nexus filesystem
 * Returns both enabled status and fastPass flag
 */
async function readEnabledState(): Promise<{ enabled: boolean; fastPass: boolean }> {
  if (!nexusController) {
    return { enabled: true, fastPass: false }; // Default to enabled
  }

  try {
    const nexus = new Nexus(currentNexusUrl);
    const result = await nexus.read(ENABLED_CONFIG_PATH, false);

    // Handle Buffer result
    if (Buffer.isBuffer(result)) {
      const data = JSON.parse(result.toString('utf-8'));
      return { enabled: data.enabled === true, fastPass: data.fastPass === true };
    }

    // Handle object result with content
    if (result && typeof result === 'object' && 'content' in result) {
      const content = result.content;
      const data = Buffer.isBuffer(content)
        ? JSON.parse(content.toString('utf-8'))
        : JSON.parse(String(content));
      return { enabled: data.enabled === true, fastPass: data.fastPass === true };
    }

    return { enabled: true, fastPass: false }; // Default to enabled
  } catch (error) {
    // File may not exist yet, default to enabled
    return { enabled: true, fastPass: false };
  }
}

/**
 * Read blacklist config from Nexus filesystem
 */
async function readBlacklistConfig(): Promise<BlacklistConfig | null> {
  try {
    const nexus = new Nexus(currentNexusUrl);
    const result = await nexus.read(BLACKLIST_CONFIG_PATH, false);

    // Handle Buffer result
    if (Buffer.isBuffer(result)) {
      return JSON.parse(result.toString('utf-8')) as BlacklistConfig;
    }

    // Handle object result with content
    if (result && typeof result === 'object' && 'content' in result) {
      const content = result.content;
      const data = Buffer.isBuffer(content)
        ? JSON.parse(content.toString('utf-8'))
        : JSON.parse(String(content));
      return data as BlacklistConfig;
    }

    return null;
  } catch {
    // File may not exist
    return null;
  }
}

/**
 * Start polling for blacklist config changes from Nexus filesystem
 */
function startBlacklistPolling(): void {
  console.error(`[SafetyHook] Starting blacklist config polling`);

  // Initial load
  readBlacklistConfig()
    .then((config) => {
      if (config) {
        updateBlacklistConfig(config);
        console.error(`[SafetyHook] Loaded blacklist config: rules=${config.rules?.length || 0}`);
      }
    })
    .catch(() => {});

  // Poll for updates (every 5 seconds)
  setInterval(async () => {
    try {
      const config = await readBlacklistConfig();
      if (config) {
        updateBlacklistConfig(config);
      }
    } catch {
      // Ignore errors during polling
    }
  }, 5000);
}

/**
 * Handle safety hook toggle message from parent process
 */
function handleSafetyHookToggle(enabled: boolean): void {
  console.error(`[SafetyHook] Received toggle: enabled=${enabled}, current isApplied=${isApplied}`);

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
      // Receive blacklist config update from main process
      if (data?.config) {
        updateBlacklistConfig(data.config);
        console.error(`[SafetyHook] Received blacklist update via parentPort: rules=${data.config.rules?.length || 0}`);
      }
    }
  });
}

// Auto-apply when loaded via -r flag (CLI usage)
// Only applies if SUDOWORK_SAFETY_HOOK is not set to 'false'
// Skip for npm/npx processes — the hook is injected via NODE_OPTIONS which
// applies to ALL child Node.js processes, including npm/npx that install ACP
// bridge packages. Intercepting their network/file operations causes them to fail.
if (process.env.SUDOWORK_SAFETY_HOOK !== 'false') {
  const mainScript = process.argv[1] || '';
  const isNpmProcess = mainScript.includes('npm-cli.js') || mainScript.includes('npx-cli.js') ||
    mainScript.endsWith('/npm') || mainScript.endsWith('/npx');
  if (isNpmProcess) {
    // Do not intercept npm/npx — let them run unimpeded
  } else {
    initSafetyHook();
  }
}
