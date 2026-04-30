/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as http from 'node:http';

/**
 * Legacy OpenClaw/Sudoclaw gateway health probe.
 *
 * The default startup path now validates the managed scode CLI directly and no
 * longer depends on a long-lived Sudoclaw HTTP server. This helper remains for
 * explicit openclaw-gateway compatibility flows and runtime settings pages.
 */
export const SUDOCLAW_HEALTH_TIMEOUT_MS = 15_000;

export interface SudoclawHealthPayload {
  ok: true;
  status: 'live';
}

export function isSudoclawHealthPayload(value: unknown): value is SudoclawHealthPayload {
  if (!value || typeof value !== 'object') return false;

  const payload = value as Partial<SudoclawHealthPayload>;
  return payload.ok === true && payload.status === 'live';
}

export async function checkSudoclawHealth(host: string, port: number, timeoutMs = SUDOCLAW_HEALTH_TIMEOUT_MS): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const req = http.get(
      {
        host,
        port,
        path: '/health',
        timeout: timeoutMs,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            resolve(false);
            return;
          }

          try {
            const payload = JSON.parse(body) as unknown;
            resolve(isSudoclawHealthPayload(payload));
          } catch {
            resolve(false);
          }
        });
      }
    );

    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}
