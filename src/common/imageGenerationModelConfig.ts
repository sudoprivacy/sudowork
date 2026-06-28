/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { DEFAULT_IMAGE_GENERATION_MODEL, type IConfigStorageRefer } from './storage';
import type { SpecificImagePricingItem } from './scodeConfig';

/**
 * Old builds hardcoded this as the default image generation model. It is still a
 * valid dropdown option, so an explicit user selection must be preserved — only
 * the legacy *default* is migrated, and only once. See
 * migrateImageGenerationModelConfig.
 */
export const LEGACY_DEFAULT_IMAGE_GENERATION_MODEL = 'gpt-image-1.5';

export type ImageGenerationModelConfig = IConfigStorageRefer['tools.imageGenerationModel'];

/**
 * Resolve the effective model id from a *complete* config.
 * Returns null when the feature is off or no model is selected — never infer
 * "off" from a partial object that simply omits `switch`.
 */
export function pickImageGenerationModelId(config: Partial<ImageGenerationModelConfig> | undefined | null): string | null {
  if (!config) return null;
  return config.switch && config.useModel ? config.useModel : null;
}

/**
 * One-time migration of the legacy hardcoded default (gpt-image-1.5) to the
 * current default. After the migration flag has been set, an explicit selection
 * of gpt-image-1.5 is preserved.
 */
export function migrateImageGenerationModelConfig(saved: ImageGenerationModelConfig | undefined | null, alreadyMigrated: boolean, defaultModelId: string): { config: ImageGenerationModelConfig; changed: boolean } {
  if (!saved) {
    return { config: { useModel: defaultModelId, switch: true } as ImageGenerationModelConfig, changed: true };
  }
  if (!saved.useModel) {
    return { config: { ...saved, useModel: defaultModelId }, changed: true };
  }
  if (!alreadyMigrated && saved.useModel === LEGACY_DEFAULT_IMAGE_GENERATION_MODEL) {
    return { config: { ...saved, useModel: defaultModelId }, changed: true };
  }
  return { config: saved, changed: false };
}

/**
 * Pick the image model to apply on login: the user's explicit choice when the
 * feature is enabled, otherwise the current default. Never unconditionally
 * overrides a user selection.
 */
export function resolveLoginImageModelId(saved: ImageGenerationModelConfig | undefined | null, defaultModelId: string): string | null {
  if (!saved) return defaultModelId;
  if (saved.switch === false) return null;
  return saved.useModel || defaultModelId;
}

/**
 * Pick the default image generation model from sudorouter specific_image_pricing items.
 * Rules: empty → ''; single → that one; contains DEFAULT_IMAGE_GENERATION_MODEL → it;
 * otherwise the highest model_ratio (first on ties); ratio all-missing → first item.
 */
export function pickDefaultImageModelFromPricing(items: SpecificImagePricingItem[]): string {
  if (!items || items.length === 0) return '';
  if (items.length === 1) return items[0].model_id;
  if (items.some((it) => it.model_id === DEFAULT_IMAGE_GENERATION_MODEL)) {
    return DEFAULT_IMAGE_GENERATION_MODEL;
  }
  let best: SpecificImagePricingItem | null = null;
  for (const it of items) {
    if (typeof it.model_ratio !== 'number') continue;
    if (!best || it.model_ratio > best.model_ratio!) {
      best = it;
    }
  }
  return best ? best.model_id : items[0].model_id;
}

/**
 * Resolve the runtime JSON model id and the persisted useModel against the live
 * pricing list. Switch-off always yields jsonModelId null — resolveImageConfig uses
 * any non-empty model without checking the switch, so the runtime JSON must be empty
 * when off; a stale useModel is still repaired in the persistence layer so the
 * feature works the moment the switch is turned back on.
 *
 * Caller invariants: `saved` exists; `items` is non-empty (so defaultModel is valid).
 */
export function resolveImageModelWithAvailability(saved: ImageGenerationModelConfig, items: SpecificImagePricingItem[]): { jsonModelId: string | null; persistedUseModel: string; changed: boolean } {
  const switchOn = saved.switch !== false;
  const useModel = saved.useModel;
  const inList = !!(useModel && items.some((it) => it.model_id === useModel));
  const defaultModel = pickDefaultImageModelFromPricing(items);

  if (!switchOn) {
    if (useModel && !inList) {
      return { jsonModelId: null, persistedUseModel: defaultModel, changed: true };
    }
    return { jsonModelId: null, persistedUseModel: useModel ?? '', changed: false };
  }

  if (useModel && inList) {
    return { jsonModelId: useModel, persistedUseModel: useModel, changed: false };
  }
  if (useModel && !inList) {
    return { jsonModelId: defaultModel || null, persistedUseModel: defaultModel, changed: true };
  }
  return { jsonModelId: defaultModel || null, persistedUseModel: '', changed: false };
}
