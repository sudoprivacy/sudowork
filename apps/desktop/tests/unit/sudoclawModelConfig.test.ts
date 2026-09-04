import { describe, expect, it } from 'vitest';
import { getSudorouterPrimaryModelPath, getSudorouterProviderName, mergeSudorouterProvidersIntoConfig } from '@/common/sudoclawModelConfig';

describe('sudoclawModelConfig', () => {
  it('fills all sudorouter model providers during login config sync', () => {
    const config = mergeSudorouterProvidersIntoConfig(null, {
      modelIds: ['gemini-3-flash-preview', 'claude-sonnet-4'],
      apiKey: 'test-key',
      baseUrl: 'https://custom.example.com/v1',
      preservePrimary: false,
    });

    expect(config.models?.providers?.sudorouter).toMatchObject({
      baseUrl: 'https://custom.example.com/v1',
      apiKey: 'test-key',
      models: [{ id: 'gemini-3-flash-preview' }, { id: 'claude-sonnet-4' }],
    });
    expect(config.models?.providers?.[getSudorouterProviderName('gemini-3-flash-preview')]).toMatchObject({
      baseUrl: 'https://hk.sudorouter.ai/v1',
      api: 'google-generative-ai',
      apiKey: 'test-key',
      models: [{ id: 'gemini-3-flash-preview', input: ['text', 'image'] }],
    });
    expect(config.models?.providers?.[getSudorouterProviderName('claude-sonnet-4')]).toMatchObject({
      baseUrl: 'https://hk.sudorouter.ai/v1',
      api: 'anthropic-messages',
      apiKey: 'test-key',
      models: [{ id: 'claude-sonnet-4', input: ['text', 'image'] }],
    });
    expect(config.agents?.defaults?.model?.primary).toBe(getSudorouterPrimaryModelPath('gemini-3-flash-preview'));
  });

  it('updates an existing sudorouter provider with latest login models and credentials', () => {
    const config = mergeSudorouterProvidersIntoConfig(
      {
        models: {
          providers: {
            sudorouter: {
              baseUrl: 'https://existing.example.com/v1',
              apiKey: 'existing-key',
              models: [{ id: 'legacy-model' }],
            },
          },
        },
      },
      {
        modelIds: ['gemini-3-flash-preview'],
        apiKey: 'test-key',
        preservePrimary: false,
      }
    );

    expect(config.models?.providers?.sudorouter).toMatchObject({
      baseUrl: 'https://existing.example.com/v1',
      apiKey: 'test-key',
      models: [{ id: 'gemini-3-flash-preview' }],
    });
    expect(config.models?.providers?.[getSudorouterProviderName('gemini-3-flash-preview')]).toBeTruthy();
  });

  it('preserves non-sudorouter primary models while refreshing sudorouter providers', () => {
    const config = mergeSudorouterProvidersIntoConfig(
      {
        agents: {
          defaults: {
            model: {
              primary: 'custom-provider/custom-model',
            },
          },
        },
      },
      {
        modelIds: ['gemini-3-flash-preview'],
        apiKey: 'test-key',
        preservePrimary: true,
      }
    );

    expect(config.agents?.defaults?.model?.primary).toBe('custom-provider/custom-model');
    expect(config.models?.providers?.[getSudorouterProviderName('gemini-3-flash-preview')]).toBeTruthy();
  });
});
