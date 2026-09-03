import { describe, expect, it } from 'vitest';
import { DEFAULT_IMAGE_GENERATION_MODEL } from '@sudowork/common/storage';
import { LEGACY_DEFAULT_IMAGE_GENERATION_MODEL, migrateImageGenerationModelConfig, pickImageGenerationModelId, resolveImageModelWithAvailability, resolveLoginImageModelId, type ImageGenerationModelConfig } from '@sudowork/common/imageGenerationModelConfig';

const cfg = (over: Partial<ImageGenerationModelConfig>): ImageGenerationModelConfig => ({ switch: true, useModel: 'gemini-3-pro-image', ...over }) as ImageGenerationModelConfig;

describe('pickImageGenerationModelId', () => {
  it('returns the model when the switch is on', () => {
    expect(pickImageGenerationModelId(cfg({ switch: true, useModel: 'gpt-image-1.5' }))).toBe('gpt-image-1.5');
  });

  it('returns null when the switch is off', () => {
    expect(pickImageGenerationModelId(cfg({ switch: false, useModel: 'gpt-image-1.5' }))).toBeNull();
  });

  it('returns null when no model is selected', () => {
    expect(pickImageGenerationModelId({ switch: true } as ImageGenerationModelConfig)).toBeNull();
  });

  it('does NOT infer off from a partial that omits switch — returns null only because switch is missing, not because it guessed', () => {
    // A partial without `switch` must not be treated as enabled.
    expect(pickImageGenerationModelId({ useModel: 'gpt-image-1.5' })).toBeNull();
  });

  it('returns null for nullish config', () => {
    expect(pickImageGenerationModelId(undefined)).toBeNull();
    expect(pickImageGenerationModelId(null)).toBeNull();
  });
});

describe('migrateImageGenerationModelConfig', () => {
  it('migrates the legacy default exactly once', () => {
    const saved = cfg({ switch: true, useModel: LEGACY_DEFAULT_IMAGE_GENERATION_MODEL });
    const first = migrateImageGenerationModelConfig(saved, false, DEFAULT_IMAGE_GENERATION_MODEL);
    expect(first.changed).toBe(true);
    expect(first.config.useModel).toBe(DEFAULT_IMAGE_GENERATION_MODEL);
  });

  it('preserves an explicit gpt-image-1.5 selection after migration has already run', () => {
    const saved = cfg({ switch: true, useModel: LEGACY_DEFAULT_IMAGE_GENERATION_MODEL });
    const result = migrateImageGenerationModelConfig(saved, true, DEFAULT_IMAGE_GENERATION_MODEL);
    expect(result.changed).toBe(false);
    expect(result.config.useModel).toBe(LEGACY_DEFAULT_IMAGE_GENERATION_MODEL);
  });

  it('fills in the default when useModel is missing', () => {
    const result = migrateImageGenerationModelConfig({ switch: true } as ImageGenerationModelConfig, true, DEFAULT_IMAGE_GENERATION_MODEL);
    expect(result.changed).toBe(true);
    expect(result.config.useModel).toBe(DEFAULT_IMAGE_GENERATION_MODEL);
  });

  it('leaves a non-legacy selection untouched', () => {
    const saved = cfg({ switch: true, useModel: 'doubao-seedream-4-0-250828' });
    const result = migrateImageGenerationModelConfig(saved, false, DEFAULT_IMAGE_GENERATION_MODEL);
    expect(result.changed).toBe(false);
    expect(result.config).toBe(saved);
  });

  it('returns an enabled default config when nothing is saved', () => {
    const result = migrateImageGenerationModelConfig(undefined, false, DEFAULT_IMAGE_GENERATION_MODEL);
    expect(result.changed).toBe(true);
    expect(result.config).toEqual({ useModel: DEFAULT_IMAGE_GENERATION_MODEL, switch: true });
  });

  it('preserves the off switch while migrating the legacy model', () => {
    const saved = cfg({ switch: false, useModel: LEGACY_DEFAULT_IMAGE_GENERATION_MODEL });
    const result = migrateImageGenerationModelConfig(saved, false, DEFAULT_IMAGE_GENERATION_MODEL);
    expect(result.config.switch).toBe(false);
    expect(result.config.useModel).toBe(DEFAULT_IMAGE_GENERATION_MODEL);
  });
});

describe('resolveLoginImageModelId', () => {
  it('respects the user selection when the switch is on — login must not override it', () => {
    expect(resolveLoginImageModelId(cfg({ switch: true, useModel: 'doubao-seedream-4-0-250828' }))).toBe('doubao-seedream-4-0-250828');
  });

  it('respects an explicit gpt-image-1.5 selection', () => {
    expect(resolveLoginImageModelId(cfg({ switch: true, useModel: LEGACY_DEFAULT_IMAGE_GENERATION_MODEL }))).toBe(LEGACY_DEFAULT_IMAGE_GENERATION_MODEL);
  });

  it('returns null when the user has turned image generation off', () => {
    expect(resolveLoginImageModelId(cfg({ switch: false, useModel: 'doubao-seedream-4-0-250828' }))).toBeNull();
  });

  it('falls back to the default when nothing is saved', () => {
    expect(resolveLoginImageModelId(undefined, DEFAULT_IMAGE_GENERATION_MODEL)).toBe(DEFAULT_IMAGE_GENERATION_MODEL);
  });
});

describe('resolveImageModelWithAvailability', () => {
  const items = [
    { model_id: DEFAULT_IMAGE_GENERATION_MODEL, model_ratio: 1 },
    { model_id: 'gemini-3-pro-image', model_ratio: 2 },
  ];

  it('keeps a selected custom image model value when it is available from scode config', () => {
    expect(resolveImageModelWithAvailability(cfg({ switch: true, useModel: 'custom/black-forest-labs/FLUX.1-schnell' }), items, ['custom/black-forest-labs/FLUX.1-schnell'])).toEqual({
      jsonModelId: 'custom/black-forest-labs/FLUX.1-schnell',
      persistedUseModel: 'custom/black-forest-labs/FLUX.1-schnell',
      changed: false,
    });
  });

  it('does not leak a custom model into runtime json when image generation is off', () => {
    expect(resolveImageModelWithAvailability(cfg({ switch: false, useModel: 'custom/flux-1' }), items, ['custom/flux-1'])).toEqual({
      jsonModelId: null,
      persistedUseModel: 'custom/flux-1',
      changed: false,
    });
  });

  it('repairs an unavailable custom image model to the default pricing model', () => {
    expect(resolveImageModelWithAvailability(cfg({ switch: true, useModel: 'custom/removed-image-model' }), items, ['custom/flux-1'])).toEqual({
      jsonModelId: DEFAULT_IMAGE_GENERATION_MODEL,
      persistedUseModel: DEFAULT_IMAGE_GENERATION_MODEL,
      changed: true,
    });
  });
});
