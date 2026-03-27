import { FileInterceptor } from './file/FileInterceptor';
import { NexusController, updateBlacklistConfig } from './nexus/NexusController';
import { Nexus } from './nexus/Nexus';
import { FileController, type FileFlag } from './file/FileController';
import { BatchInterceptor, type RequestController } from '@mswjs/interceptors';
import NodeInterceptors from '@mswjs/interceptors/presets/node';
import type { BlacklistConfig } from './blacklist/types';

export interface SafetyHookOptions {
  /** Nexus server URL, defaults to http://127.0.0.1:2026 */
  nexusUrl?: string;
  /** Enable network interception, defaults to true */
  enableNetwork?: boolean;
  /** Enable file interception, defaults to true */
  enableFile?: boolean;
  /** Timeout in milliseconds for waiting user confirmation, defaults to 600000 (10 minutes) */
  timeout?: number;
  /** Polling interval for enabled state check (ms), defaults to 3000 */
  statePollingInterval?: number;
}

let networkInterceptor: BatchInterceptor | null = null;
let fileInterceptor: FileInterceptor | null = null;
let isApplied = false;
let nexusController: NexusController | null = null;
let statePollingTimer: NodeJS.Timeout | null = null;
let currentNexusUrl: string = 'http://127.0.0.1:2026';
let currentStatePollingInterval: number = 3000;

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

  const nexusUrl = options.nexusUrl || 'http://127.0.0.1:2026';
  const enableNetwork = options.enableNetwork !== false;
  const enableFile = options.enableFile !== false;
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

  isApplied = true;
  console.log(`[SafetyHook] Initialized with nexusUrl=${nexusUrl}, network=${enableNetwork}, file=${enableFile}`);

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
 * Dispose safety hook interceptors
 */
export function disposeSafetyHook(): void {
  // Stop state polling
  stopStatePolling();

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
  console.log('[SafetyHook] Disposed');
}

/**
 * Start polling for enabled state changes from Nexus filesystem
 */
function startStatePolling(): void {
  if (statePollingTimer) {
    return; // Already polling
  }

  console.log(`[SafetyHook] Starting state polling (interval: ${currentStatePollingInterval}ms)`);

  statePollingTimer = setInterval(async () => {
    try {
      const enabled = await readEnabledState();
      if (!enabled && isApplied) {
        console.log('[SafetyHook] Detected enabled=false from Nexus, disposing...');
        disposeSafetyHook();
      } else if (enabled && !isApplied) {
        console.log('[SafetyHook] Detected enabled=true from Nexus, initializing...');
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
    console.log('[SafetyHook] Stopped state polling');
  }
}

/**
 * Read enabled state from Nexus filesystem
 */
async function readEnabledState(): Promise<boolean> {
  if (!nexusController) {
    return true; // Default to enabled
  }

  try {
    const nexus = new Nexus(currentNexusUrl);
    const result = await nexus.read(ENABLED_CONFIG_PATH, false);

    // Handle Buffer result
    if (Buffer.isBuffer(result)) {
      const data = JSON.parse(result.toString('utf-8'));
      return data.enabled === true;
    }

    // Handle object result with content
    if (result && typeof result === 'object' && 'content' in result) {
      const content = result.content;
      const data = Buffer.isBuffer(content)
        ? JSON.parse(content.toString('utf-8'))
        : JSON.parse(String(content));
      return data.enabled === true;
    }

    return true; // Default to enabled
  } catch (error) {
    // File may not exist yet, default to enabled
    return true;
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
  console.log(`[SafetyHook] Starting blacklist config polling`);

  // Initial load
  readBlacklistConfig()
    .then((config) => {
      if (config) {
        updateBlacklistConfig(config);
        console.log(`[SafetyHook] Loaded blacklist config: rules=${config.rules?.length || 0}`);
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
  console.log(`[SafetyHook] Received toggle: enabled=${enabled}, current isApplied=${isApplied}`);

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
        console.log(`[SafetyHook] Received blacklist update via parentPort: rules=${data.config.rules?.length || 0}`);
      }
    }
  });
}

// Auto-apply when loaded via -r flag (CLI usage)
// Only applies if SUDOWORK_SAFETY_HOOK is not set to 'false'
if (process.env.SUDOWORK_SAFETY_HOOK !== 'false') {
  initSafetyHook();
}