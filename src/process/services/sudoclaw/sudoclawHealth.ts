/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

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
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(`http://${host}:${port}/health`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!response.ok) return false;

    const payload = (await response.json()) as unknown;
    return isSudoclawHealthPayload(payload);
  } catch {
    return false;
  }
}
