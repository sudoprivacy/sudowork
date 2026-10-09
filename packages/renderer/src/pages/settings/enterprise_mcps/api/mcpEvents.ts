/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EnterpriseMcpClient } from './client';

export type EnterpriseMcpEventName = 'mcp.changed' | 'mcp.policy.changed';

export interface EnterpriseMcpEventStreamHandle {
  close(): void;
}

interface SubscribeOptions {
  onChanged?: () => void;
  onPolicyChanged?: () => void;
  onOpen?: () => void;
  onError?: (err: Event) => void;
}

const MAX_BACKOFF_MS = 30_000;

/**
 * Connect to /api/v1/mcp/events with auto-reconnect (exponential backoff).
 * The token is fetched via the client every time we (re)connect, so refreshed
 * tokens are picked up automatically.
 */
export function subscribeMcpEvents(client: EnterpriseMcpClient, opts: SubscribeOptions): EnterpriseMcpEventStreamHandle {
  let es: EventSource | null = null;
  let closed = false;
  let backoff = 1_000;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const connect = async () => {
    if (closed) return;
    try {
      es = await client.openEventStream('/api/v1/mcp/events');
    } catch {
      scheduleReconnect();
      return;
    }
    es.addEventListener('open', () => {
      backoff = 1_000;
      opts.onOpen?.();
    });
    es.addEventListener('mcp.changed', () => {
      opts.onChanged?.();
    });
    es.addEventListener('mcp.policy.changed', () => {
      opts.onPolicyChanged?.();
    });
    es.addEventListener('error', (e) => {
      opts.onError?.(e);
      // EventSource will auto-reconnect on transient errors, but we explicitly
      // re-create after persistent failures (readyState === CLOSED).
      if (es?.readyState === EventSource.CLOSED) {
        es = null;
        scheduleReconnect();
      }
    });
  };

  const scheduleReconnect = () => {
    if (closed) return;
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect();
    }, backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  };

  void connect();

  return {
    close() {
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (es) {
        es.close();
        es = null;
      }
    },
  };
}
