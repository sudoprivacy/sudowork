/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as http from 'node:http';

export interface SudoclawHealthPayload {
  ok: true;
  status: 'live';
}

export function isSudoclawHealthPayload(value: unknown): value is SudoclawHealthPayload {
  if (!value || typeof value !== 'object') return false;

  const payload = value as Partial<SudoclawHealthPayload>;
  return payload.ok === true && payload.status === 'live';
}

export async function checkSudoclawHealth(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
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
