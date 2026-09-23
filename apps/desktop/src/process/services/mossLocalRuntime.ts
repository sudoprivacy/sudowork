import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { buildScodeConfigFromLoginPayload, extractSudorouterCreds } from '@sudowork/common/scodeConfig';
import type { TMossLocalRuntime } from '@sudowork/common/mossExecution';
import { syncUserKeyFromScodeConfig } from '@process/services/authProxy/userKeySync';
import { SCODE_CONFIG_PATH } from '@process/services/scode/scodePaths';
import { ProcessConfig } from '@process/initStorage';
import { readExistingConfig, writeConfig, writeScodeDefaultModel } from '@process/bridge/scodeBridge';
import { setCachedLocalModeAvailable } from '@/common/enterpriseDebugConfig';

const mossLocalRuntimeSchema = z.object({
  execution: z.object({ isLocalAllowed: z.boolean(), isRemoteAllowed: z.boolean(), defaultTarget: z.enum(['local', 'remote']) }),
  localRuntime: z.object({
    userId: z.string().min(1),
    organizationId: z.string().min(1),
    status: z.enum(['ready', 'policy_denied', 'credential_pending', 'provider_unavailable', 'models_unavailable']),
    protocol: z.enum(['openai-completions', 'openai-responses', 'anthropic-messages']).optional(),
  }),
  sudorouter_key: z.string().min(1).optional(),
  model_service_url: z.string().url().optional(),
  models: z.array(z.string().min(1)),
  scode_auto_model: z.string().optional(),
});

let appliedRuntimeSignature: string | undefined;

/** Namespaces desktop resources and conversations by the authenticated Moss identity. */
export function createMossAccountScope(serverUrl: string, userId: string, organizationId: string): string {
  const url = new URL(serverUrl);
  const server = `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  return createHash('sha256')
    .update(JSON.stringify([server, organizationId, userId]))
    .digest('hex');
}

/** Apply model credentials in the main process; only return non-secret state to the UI. */
export async function applyMossLocalRuntime(payload: unknown, serverUrl: string): Promise<Pick<TMossLocalRuntime, 'execution' | 'localRuntime'>> {
  const runtime = mossLocalRuntimeSchema.parse(payload) as TMossLocalRuntime;
  const scope = createMossAccountScope(serverUrl, runtime.localRuntime.userId, runtime.localRuntime.organizationId);
  const previousScope = ProcessConfig.getSync('eeclaw.accountScope');
  const previousConfig = readExistingConfig();
  const previousCredentials = extractSudorouterCreds(previousConfig);
  const signature = createHash('sha256').update(JSON.stringify(runtime)).digest('hex');
  if (previousScope === scope && appliedRuntimeSignature === signature && runtime.localRuntime.status === 'ready' && previousCredentials.apiKey === runtime.sudorouter_key && previousCredentials.baseUrl === runtime.model_service_url) {
    return { execution: runtime.execution, localRuntime: runtime.localRuntime };
  }
  const backupPath = `${SCODE_CONFIG_PATH}.before-moss`;
  if (!previousScope && !fs.existsSync(backupPath)) {
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.writeFileSync(backupPath, JSON.stringify(previousConfig), { mode: 0o600, flag: 'wx' });
  }
  if (previousScope !== scope || runtime.localRuntime.status !== 'ready' || previousCredentials.apiKey !== runtime.sudorouter_key || previousCredentials.baseUrl !== runtime.model_service_url) {
    const { default: WorkerManage } = await import('@process/WorkerManage');
    await WorkerManage.clear(previousScope === scope);
  }
  await ProcessConfig.set('eeclaw.accountScope', scope);
  await ProcessConfig.set('eeclaw.execution', runtime.execution);
  await ProcessConfig.set('eeclaw.localModeAvailable', runtime.execution.isLocalAllowed);
  setCachedLocalModeAvailable(runtime.execution.isLocalAllowed);
  if (runtime.localRuntime.status === 'ready') {
    if (!runtime.sudorouter_key || !runtime.model_service_url || !runtime.models.length) throw new Error('Incomplete local model configuration');
    const config = buildScodeConfigFromLoginPayload(
      {
        sudorouterKey: runtime.sudorouter_key,
        modelServiceUrl: runtime.model_service_url,
        models: runtime.models,
        scodeAutoModel: runtime.scode_auto_model,
      },
      previousScope === scope ? readExistingConfig() : {}
    );
    for (const model of Object.values(config.models || {})) {
      if (model.providers?.proxy?.provider === 'sudorouter' && runtime.localRuntime.protocol) {
        model.providers.proxy.api = runtime.localRuntime.protocol;
      }
    }
    if (previousScope === scope && typeof previousConfig.default_model === 'string' && config.models?.[previousConfig.default_model]) config.default_model = previousConfig.default_model;
    if (config.web_search) config.web_search.apiUrl = `${runtime.model_service_url.replace(/\/v1\/?$/, '').replace(/\/+$/, '')}/search/tavily/search`;
    writeConfig(config);
    await syncUserKeyFromScodeConfig(config, true);
    if (config.default_model) writeScodeDefaultModel(config.default_model);
  } else {
    writeConfig({});
    await syncUserKeyFromScodeConfig({}, true);
  }
  await ProcessConfig.set('eeclaw.localRuntime', runtime.localRuntime);
  appliedRuntimeSignature = signature;
  return { execution: runtime.execution, localRuntime: runtime.localRuntime };
}

let preparation: Promise<Pick<TMossLocalRuntime, 'execution' | 'localRuntime'>> | undefined;

/** Check the server before managed local execution, including cached sessions. */
export async function assertMossLocalExecutionAllowed(): Promise<void> {
  if (!ProcessConfig.getSync('eeclaw.accountScope')) return;
  const runtime = await prepareMossLocalRuntime();
  if (!runtime.execution.isLocalAllowed) throw new Error('Local execution authorization has been revoked. Please use cloud execution or contact your administrator.');
  if (runtime.localRuntime.status !== 'ready') throw new Error(`Local execution is unavailable: ${runtime.localRuntime.status}`);
}

/** Refresh after login restoration, policy changes, or a failed local preparation. */
export function prepareMossLocalRuntime(): Promise<Pick<TMossLocalRuntime, 'execution' | 'localRuntime'>> {
  if (preparation) return preparation;
  preparation = (async () => {
    const { getValidToken, withAuthStorageLock } = await import('@process/bridge/eeclawBridge');
    const token = await getValidToken();
    const serverUrl = ProcessConfig.getSync('eeclaw.serverUrl');
    if (!serverUrl) throw new Error('Moss server is not configured');
    const response = await fetch(`${serverUrl.replace(/\/+$/, '')}/api/v1/client/local-runtime`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Local runtime configuration: HTTP ${response.status}`);
    const data: unknown = await response.json();
    return withAuthStorageLock(async () => {
      if (ProcessConfig.getSync('eeclaw.authStorage')?.access_token !== token || ProcessConfig.getSync('eeclaw.serverUrl') !== serverUrl) throw new Error('Moss identity changed during preparation');
      return applyMossLocalRuntime(data, serverUrl);
    });
  })().finally(() => {
    preparation = undefined;
  });
  return preparation;
}

/** End managed execution and restore the configuration that preceded Moss login. */
export async function clearMossLocalRuntime(): Promise<void> {
  appliedRuntimeSignature = undefined;
  if (ProcessConfig.getSync('eeclaw.accountScope')) {
    const { default: WorkerManage } = await import('@process/WorkerManage');
    await WorkerManage.clear();
    const backupPath = `${SCODE_CONFIG_PATH}.before-moss`;
    const config = fs.existsSync(backupPath) ? (JSON.parse(fs.readFileSync(backupPath, 'utf8')) as Record<string, unknown>) : {};
    writeConfig(config);
    await syncUserKeyFromScodeConfig(config, true);
    fs.rmSync(backupPath, { force: true });
  }
  await ProcessConfig.set('eeclaw.localRuntime', undefined);
  await ProcessConfig.set('eeclaw.execution', undefined);
  await ProcessConfig.set('eeclaw.accountScope', undefined);
}
