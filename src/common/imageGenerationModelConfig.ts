/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { DEFAULT_IMAGE_GENERATION_MODEL, type IConfigStorageRefer } from './storage';

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
export function migrateImageGenerationModelConfig(saved: ImageGenerationModelConfig | undefined | null, alreadyMigrated: boolean): { config: ImageGenerationModelConfig; changed: boolean } {
  if (!saved) {
    return { config: { useModel: DEFAULT_IMAGE_GENERATION_MODEL, switch: true } as ImageGenerationModelConfig, changed: true };
  }
  if (!saved.useModel) {
    return { config: { ...saved, useModel: DEFAULT_IMAGE_GENERATION_MODEL }, changed: true };
  }
  if (!alreadyMigrated && saved.useModel === LEGACY_DEFAULT_IMAGE_GENERATION_MODEL) {
    return { config: { ...saved, useModel: DEFAULT_IMAGE_GENERATION_MODEL }, changed: true };
  }
  return { config: saved, changed: false };
}

/**
 * Pick the image model to apply on login: the user's explicit choice when the
 * feature is enabled, otherwise the current default. Never unconditionally
 * overrides a user selection.
 */
export function resolveLoginImageModelId(saved: ImageGenerationModelConfig | undefined | null): string | null {
  if (!saved) return DEFAULT_IMAGE_GENERATION_MODEL;
  if (saved.switch === false) return null;
  return saved.useModel || DEFAULT_IMAGE_GENERATION_MODEL;
}
