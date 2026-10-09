import type { ControllerSource, FileFlag } from '../file/FileController';
import { Nexus } from './Nexus';
import { randomUUID } from 'node:crypto';
import { shouldTriggerPopup } from '../blacklist/BlacklistMatcher';
import type { BlacklistConfig } from '../blacklist/types';
import { isFastPassEnabled } from '../index';

/** Unified hook config path (blacklist is stored alongside enabled state) */
const HOOK_CONFIG_PATH = '/safe/config/hook';

/** Localhost patterns that should always be allowed (system-level whitelist) */
const LOCALHOST_PATTERNS = [
  '127.0.0.1',
  'localhost',
  '[::1]',      // IPv6 localhost
  '::1',        // IPv6 localhost
];

/**
 * Check if URL is a localhost request (should be allowed without popup)
 */
function isLocalhostRequest(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();
    return LOCALHOST_PATTERNS.some(pattern =>
      hostname === pattern || hostname === pattern.toLowerCase()
    );
  } catch {
    return false;
  }
}

/** Cached blacklist config (updated via polling in index.ts) */
let cachedBlacklistConfig: BlacklistConfig | null = null;

/**
 * Update cached blacklist config (called from index.ts polling)
 */
export function updateBlacklistConfig(config: BlacklistConfig): void {
  cachedBlacklistConfig = config;
}

/**
 * Get cached blacklist config
 */
export function getBlacklistConfig(): BlacklistConfig | null {
  return cachedBlacklistConfig;
}

/**
 * Read blacklist config from unified hook config in Nexus filesystem
 */
async function readBlacklistConfig(): Promise<BlacklistConfig | null> {
  try {
    const nexus = new Nexus(this.serverUrl, this.apikey);
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

    if (data && data.blacklist) {
      return data.blacklist as BlacklistConfig;
    }

    return null;
  } catch {
    // File may not exist
    return null;
  }
}

export class NexusController extends Nexus {
  constructor(
    serverUrl: string,
    apikey?: string,
    private readonly timeout?: number
  ) {
    super(serverUrl, apikey);
  }

  public async control(controller: ControllerSource, payload: Payload) {
    // Skip requests to Nexus server itself
    if (payload.type === 'network' && new URL(payload.data.url).origin === this.serverUrl) {
      return;
    }

    // FastPass mode: allow all requests immediately without interception
    if (isFastPassEnabled()) {
      return;
    }

    // Allow localhost requests without popup (system-level whitelist)
    if (payload.type === 'network' && isLocalhostRequest(payload.data.url)) {
      return;
    }

    // Check blacklist before creating event
    let blacklistConfig = cachedBlacklistConfig;

    if (!blacklistConfig) {
      // Try reading from Nexus if not cached
      blacklistConfig = await readBlacklistConfig.call(this);
    }

    // If no blacklist config or empty rules, don't intercept (allow all)
    if (!blacklistConfig || !blacklistConfig.rules || blacklistConfig.rules.length === 0) {
      return;
    }

    const result = shouldTriggerPopup(payload, blacklistConfig);

    if (!result.matched) {
      // Not in blacklist, allow immediately without popup
      return;
    }

    const eventID = randomUUID();
    const event = JSON.stringify(payload);

    try {
      await this.write(`/safe/event/${eventID}`, event);
      const content = await this.readUntilExists(`/safe/action/${eventID}`, this.timeout);
      const actionResult = JSON.parse(content.toString()) as {
        allow?: boolean;
        reason?: string;
      };

      // Delete action file after reading
      this.delete(`/safe/action/${eventID}`).catch(() => {
        // Ignore delete errors
      });

      if (!actionResult.allow) {
        controller.errorWith(actionResult.reason || 'Security Violation: request was DENIED');
      }
    } catch (err) {
      // Timeout or other error - deny by default for security
      controller.errorWith('User confirmation timeout or connection error - request denied');
    }
  }
}

export type Payload =
  | {
      type: 'file';
      data: {
        path: string;
        flags: FileFlag[];
      };
    }
  | {
      type: 'network';
      data: {
        requestId: string;
        url: string;
        method: string;
        headers: Record<string, unknown>;
        body: string;
      };
    }
  | {
      type: 'process';
      data: {
        command: string;
        args: string[];
      };
    };
