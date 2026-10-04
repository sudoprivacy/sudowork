import { LoginError, type ILoginSession, type LoginAttempt } from '@sudowork/common/authLogin';
import { ConfigStorage } from '@sudowork/common/storage';
import { bootstrapClientReporting } from '@sudowork/common/systemConfig';
import { getSudoworkServerBaseUrl } from '@sudowork/common/sudoworkServer';
import { buildScodeConfigFromLoginPayload, extractImageModelsFromScodeConfig, SCODE_AUTO_MODEL_ALIAS } from '@sudowork/common/scodeConfig';
import { extractLoginSudoclawPayload } from '@sudowork/common/sudoworkAuthLogin';
import { pickDefaultImageModelFromPricing, pickImageGenerationModelId, resolveImageModelWithAvailability } from '@sudowork/common/imageGenerationModelConfig';
import * as ipcBridge from './ipcBridge.js';

function step<T>(attempt: LoginAttempt | undefined, name: string, action: () => Promise<T>): Promise<T> {
  return attempt ? attempt.step(name, action) : action();
}

/** Keep the model selector aligned with the login configuration. */
export async function syncScodeGuidModelPreference(modelId: string, attempt?: LoginAttempt): Promise<void> {
  try {
    const config = (await step(attempt, 'model-preference-read', () => ConfigStorage.get('acp.config'))) || {};
    await step(attempt, 'model-preference-save', () => ConfigStorage.set('acp.config', { ...config, scode: { ...config.scode, preferredModelId: modelId } }));
    const cached = await step(attempt, 'model-cache-read', () => ConfigStorage.get('acp.cachedModels'));
    const scodeCached = cached?.scode;
    if (!scodeCached?.availableModels?.length) return;
    const match = scodeCached.availableModels.find((model) => model.id === modelId);
    await step(attempt, 'model-cache-save', () => ConfigStorage.set('acp.cachedModels', { ...cached, scode: { ...scodeCached, currentModelId: modelId, currentModelLabel: match?.label || modelId } }));
  } catch (error) {
    if (attempt) throw error;
  }
}

/** Preserve the selected image model when the current catalog still contains it. */
export async function applyLoginImageModel(attempt?: LoginAttempt): Promise<void> {
  const saved = await step(attempt, 'image-preference-read', () => ConfigStorage.get('tools.imageGenerationModel').catch((): undefined => undefined));
  const [res, config] = await step(attempt, 'image-model-catalog', () => Promise.all([ipcBridge.scode.fetchSpecificImagePricing.invoke().catch((): null => null), ipcBridge.scode.getConfig.invoke().catch((): null => null)]));
  const items = res?.success && Array.isArray(res.data) ? res.data : null;
  const customValues = extractImageModelsFromScodeConfig(config?.success ? config.data : null).map((item) => item.value);
  let modelId: string | null;
  if (!saved) {
    modelId = (items ? pickDefaultImageModelFromPricing(items) : '') || null;
  } else if (!items?.length) {
    modelId = pickImageGenerationModelId(saved);
  } else {
    const { jsonModelId, persistedUseModel, changed } = resolveImageModelWithAvailability(saved, items, customValues);
    if (changed) await step(attempt, 'image-preference-save', () => ConfigStorage.set('tools.imageGenerationModel', { ...saved, useModel: persistedUseModel }));
    modelId = jsonModelId;
  }
  await step(attempt, 'image-model-save', () => ipcBridge.scode.setImageModel.invoke({ modelId }));
}

/** Main owns authentication persistence; only legacy model setup remains on the renderer side. */
export async function prepareDesktopLogin(session: ILoginSession, attempt: LoginAttempt): Promise<void> {
  const { data, isLocalAvailable } = session;
  if (data.localRuntime) {
    await syncScodeGuidModelPreference(SCODE_AUTO_MODEL_ALIAS, attempt);
    return;
  }
  if (!isLocalAvailable) {
    const result = await attempt.step('clear-local-models', () => ipcBridge.scode.saveConfig.invoke({ config: {} }));
    if (!result.success) throw new LoginError('setupError');
    return;
  }
  const payload = extractLoginSudoclawPayload({ success: true, data });
  if (!payload) throw new LoginError('invalidResponse');
  const current = await attempt.step('model-config-read', () => ipcBridge.scode.getConfig.invoke());
  const pricing = await attempt.step('model-catalog', () => ipcBridge.scode.fetchSpecificPricing.invoke());
  const config = buildScodeConfigFromLoginPayload(payload, current?.data, pricing?.data ?? []);
  const saved = await attempt.step('model-config-save', () => ipcBridge.scode.saveConfig.invoke({ config }));
  if (!saved.success) throw new LoginError('setupError');
  const restored = await attempt.step('custom-models-restore', () => ipcBridge.scode.restoreCustomModelProviders.invoke({ userId: data.user.id }));
  if (!restored.success) throw new LoginError('setupError');
  await applyLoginImageModel(attempt);
  const modelId = restored.data?.default_model || config.default_model;
  if (modelId) await attempt.step('default-model-save', () => ipcBridge.scode.setDefaultModel.invoke({ modelId }));
  await syncScodeGuidModelPreference(SCODE_AUTO_MODEL_ALIAS, attempt);
}

/** Reporting is ancillary to authentication and is retried during session restoration. */
export async function fetchAndCacheCredentials(accessToken: string): Promise<void> {
  if (typeof window === 'undefined' || !(window as { electronAPI?: unknown }).electronAPI || !accessToken) return;
  try {
    await bootstrapClientReporting(await getSudoworkServerBaseUrl(), accessToken, {
      syncConfig: (data) => ipcBridge.systemConfig.syncFromRenderer.invoke({ data }),
      cacheCredentials: (envelope) => ipcBridge.systemConfig.cacheCredentials.invoke(envelope),
    });
  } catch {
    console.warn('[Auth] Reporting initialization failed');
  }
}
