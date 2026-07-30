/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ZZAPI credentials — read from the secret store, cached in memory, and handed
 * to child processes as ZZAPI_APP_KEY / ZZAPI_APP_SECRET.
 *
 * zzapi accepts credentials only from the environment or
 * ~/.config/zzapi/config.toml — never from CLI flags (they would land in shell
 * history and ps). We use the environment so nothing is written to disk in
 * plaintext.
 *
 * Why a cache rather than reading at spawn time: getEnhancedEnv() is
 * synchronous and runs on every child spawn, while the enterprise read
 * (MossSecretClient) is async and the consumer read is a blocking napi/gRPC
 * call into the vault. Either would be wrong to do per spawn, so credentials
 * are fetched asynchronously into module state and read back synchronously.
 *
 * 凭据从密钥库异步预取到内存，spawn 时同步读出，避免每次起子进程都打一次
 * vault。企业端走 Moss 服务端，C 端走本地 Nexus 密钥库。
 */

import { buildNamespace } from '@/common/nexus/namespace';
import { getAuthToken, getMossServerUrl, getUserId, isEnterpriseMode } from '@/common/enterpriseDebugConfig';
import { MossSecretClient } from '@/common/nexus/moss-secret-client';
import { getNexusSecretClient } from '@/common/nexus/nexus-secret-client';
import { mainLog, mainWarn } from '@process/utils/mainLogger';
import { ProcessConfig } from '@process/initStorage';

/** Secret store keys. */
const APP_KEY = 'app_key';
const APP_SECRET = 'app_secret';

/** Service name used to build the namespace (`service:zzapi` / `user:<id>:zzapi`). */
const SERVICE = 'zzapi';

/**
 * Production token endpoint. Mirrors what the CLI itself calls
 * (dist/auth.js → `${baseUrl}/openapi/token`), so a pass here means the CLI
 * will authenticate too.
 */
const TOKEN_URL = 'https://zapi.cneptp.com/openapi/token';

/** Timeout for the credential test, matching the CLI's default request timeout. */
const TEST_TIMEOUT_MS = 20_000;

type ZzapiCredentials = { appKey: string; appSecret: string };

let cached: ZzapiCredentials | null = null;

/** Namespace matching what the settings UI writes to, for both modes. */
export function getZzapiNamespace(): string {
  const userId = getUserId();
  return isEnterpriseMode() && userId ? buildNamespace(SERVICE, userId) : buildNamespace(SERVICE);
}

async function readFromMoss(): Promise<ZzapiCredentials | null> {
  const userId = getUserId();
  const mossServerUrl = getMossServerUrl();
  const authToken = getAuthToken();

  if (!userId || !mossServerUrl || !authToken) {
    mainLog('ZZAPI', 'Enterprise mode: missing userId / mossServerUrl / authToken, skipping credential fetch');
    return null;
  }

  const client = new MossSecretClient(mossServerUrl, authToken, userId);
  const namespace = buildNamespace(SERVICE, userId);
  const appKey = await client.getSecret(namespace, APP_KEY);
  const appSecret = await client.getSecret(namespace, APP_SECRET);
  return appKey && appSecret ? { appKey, appSecret } : null;
}

function readFromVault(): ZzapiCredentials | null {
  const namespace = buildNamespace(SERVICE);
  const client = getNexusSecretClient();
  const appKey = client.getSecret(namespace, APP_KEY);
  const appSecret = client.getSecret(namespace, APP_SECRET);
  return appKey && appSecret ? { appKey, appSecret } : null;
}

/**
 * Outcome of a refresh. `absent` and `unavailable` are kept apart because only
 * the latter is worth retrying: nothing stored is a settled answer, while an
 * unreachable vault is not.
 */
export type ZzapiCredentialRefresh = 'loaded' | 'absent' | 'unavailable';

/**
 * Fetch credentials into the cache. Safe to call repeatedly; failures leave the
 * previous cache untouched rather than clearing it, so a transient vault or
 * network error doesn't strip credentials from agents mid-session.
 */
export async function refreshZzapiCredentials(): Promise<ZzapiCredentialRefresh> {
  try {
    const creds = isEnterpriseMode() ? await readFromMoss() : readFromVault();

    if (!creds) {
      // Nothing stored yet is the normal first-run state, not an error.
      mainLog('ZZAPI', `No credentials found in ${getZzapiNamespace()}`);
      return 'absent';
    }

    cached = creds;
    mainLog('ZZAPI', `Credentials loaded from ${getZzapiNamespace()}`);
    return 'loaded';
  } catch (err) {
    mainWarn('ZZAPI', `Failed to read credentials (keeping previous cache): ${err instanceof Error ? err.message : String(err)}`);
    return 'unavailable';
  }
}

/**
 * Validate a key/secret pair against the 中资 token endpoint.
 *
 * Tests the values the user just typed rather than what is stored, so the
 * settings form can verify before saving. The endpoint answers HTTP 200 with a
 * non-200 `code` for bad credentials, so the body has to be inspected — status
 * alone is not enough.
 *
 * 校验用户刚输入的凭证（而非已存储的）。注意该接口凭证错误时 HTTP 仍是 200，
 * 必须看响应体里的 code。
 */
export async function testZzapiCredentials(appKey: string, appSecret: string): Promise<{ ok: boolean; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);

  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appKey, appSecret }),
      signal: controller.signal,
    });

    const text = await res.text();
    let body: { code?: number; msg?: string; data?: { accessToken?: string } };
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: false, error: `接口返回非 JSON（HTTP ${res.status}）` };
    }

    if (body?.code === 200 && body?.data?.accessToken) return { ok: true };
    return { ok: false, error: body?.msg || `认证失败（code ${body?.code ?? res.status}）` };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return { ok: false, error: aborted ? `连接超时（${TEST_TIMEOUT_MS}ms）` : `连接失败：${err instanceof Error ? err.message : String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

/** Drop the cache so the next refresh re-reads the store. */
export function invalidateZzapiCredentials(): void {
  cached = null;
}

/** Retry schedule for the startup prefetch, in milliseconds. */
const STARTUP_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000];

/**
 * Startup entry point.
 *
 * The vault lives inside the Nexus daemon, which serviceManager.startup()
 * launches without awaiting, so a refresh fired at startup loses the race. It
 * fails in two distinct ways as the daemon comes up — first "tcp connect
 * error" while nothing is listening, then "method not found" once the daemon
 * answers but its password-vault plugin has not registered yet. Waiting on the
 * daemon's `ready` stage only covers the first, so retry on a bounded backoff
 * instead and give up quietly after the last attempt: credentials are not
 * required for startup, and saving them in settings triggers a fresh read
 * (see secretBridge.ts).
 *
 * vault 在 Nexus 守护进程里，而 Nexus 是异步启动的。启动即读会先撞上
 * "tcp connect error"，稍后还会撞上 vault 插件尚未注册的 "method not found"，
 * 所以用有界退避重试，而不是只等一个 ready 事件。
 */
export function initZzapiCredentials(): void {
  const attempt = async (index: number): Promise<void> => {
    // Only an unreachable vault is worth retrying — 'absent' is a settled answer.
    if ((await refreshZzapiCredentials()) !== 'unavailable') return;
    if (index >= STARTUP_RETRY_DELAYS_MS.length) {
      mainLog('ZZAPI', 'Credential prefetch gave up; will retry when credentials are saved');
      return;
    }
    setTimeout(() => void attempt(index + 1), STARTUP_RETRY_DELAYS_MS[index]);
  };

  void attempt(0);
}

/**
 * Whether stored credentials may be handed to agents.
 *
 * Read synchronously because getZzapiCredentialEnv() runs on every child spawn.
 * Unset means enabled: the toggle only exists to withhold credentials, so
 * saving them and never touching the switch must still work.
 */
export function isZzapiEnabled(): boolean {
  return ProcessConfig.getSync('zzapi.enabled') !== false;
}

/**
 * Environment for child processes. Returns an empty object when credentials are
 * unavailable or the integration is switched off — deliberately NOT empty
 * strings, which zzapi would treat as a present-but-invalid credential and fail
 * on rather than reporting them as missing.
 */
export function getZzapiCredentialEnv(): Record<string, string> {
  if (!cached || !isZzapiEnabled()) return {};
  return { ZZAPI_APP_KEY: cached.appKey, ZZAPI_APP_SECRET: cached.appSecret };
}

/** Whether credentials are present in the store (independent of the toggle). */
export function hasZzapiCredentials(): boolean {
  return cached !== null;
}
