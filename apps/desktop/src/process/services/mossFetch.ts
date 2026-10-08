/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The desktop's transport for the shared moss ports.
 *
 * `@sudowork/moss-client` holds what every caller must agree on — the endpoint
 * paths, the request shapes, the `{success, data}` envelope. What differs
 * between the two apps is only how a request reaches moss: the browser goes to
 * its own origin with a session cookie, and the desktop goes straight to the
 * enterprise server with a Bearer token it may have to refresh. That difference
 * belongs here, in one adapter, rather than copied into every bridge handler
 * that happens to need a moss call.
 *
 * Supplying this to `createMoss*Port` lets a desktop handler speak the same
 * port the webui server does, so the two cannot drift on a path or a response
 * shape.
 */

import { net } from 'electron';
import type { MossFetch, MossRequest } from '@sudowork/moss-client';
import { DEFAULT_MOSS_TIMEOUT_MS } from '@sudowork/moss-client';

export class MossNotConfiguredError extends Error {}

function buildUrl(baseUrl: string, req: MossRequest): string {
  const url = new URL(req.path, baseUrl);
  for (const [key, value] of Object.entries(req.searchParams ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/**
 * @param refreshToken obtains an access token; called again with `force` when
 *   moss answers 401, which is the one retry worth making automatically — the
 *   token simply expired and the caller would otherwise surface a login prompt
 *   for something the app can fix itself.
 */
export function createDesktopMossFetch(refreshToken: (force?: boolean) => Promise<string>): MossFetch {
  return async (baseUrl: string, req: MossRequest, timeoutMs: number = DEFAULT_MOSS_TIMEOUT_MS) => {
    if (!baseUrl) throw new MossNotConfiguredError('no enterprise server configured');

    const send = async (accessToken: string): Promise<Response> =>
      net.fetch(buildUrl(baseUrl, req), {
        method: req.method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(req.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(req.body !== undefined ? { body: JSON.stringify(req.body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });

    let response = await send(req.accessToken || (await refreshToken()));
    if (response.status === 401) response = await send(await refreshToken(true));

    if (!response.ok) {
      // The status is the actionable part — a caller distinguishes "not yours"
      // from "moss is down", and a bare "request failed" loses that.
      throw new Error(`moss ${req.method} ${req.path} failed: ${response.status}`);
    }

    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`moss ${req.method} ${req.path} returned a non-JSON body`);
    }
  };
}
