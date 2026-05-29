import { describe, expect, it } from 'vitest';
import { buildScodeConfigFromLoginPayload, extractCustomProvidersFromScodeConfig, mergeCustomProviderIntoScodeConfig, mergeCustomProvidersIntoScodeConfig, removeCustomProviderFromScodeConfig } from '@/common/scodeConfig';

describe('scodeConfig', () => {
  it('preserves custom api-key providers and models when login refreshes sudorouter models', () => {
    const existing = mergeCustomProviderIntoScodeConfig(
      {
        auth_modes: {
          proxy: {
            sudorouter: { baseUrl: 'https://old.example.com/v1', apiKey: 'old-key' },
          },
        },
        models: {
          'legacy-router-model': {
            alias: 'legacy-router-model',
            providers: {
              proxy: { provider: 'sudorouter', model: 'legacy-router-model', api: 'openai-completions' },
            },
          },
        },
      },
      {
        providerId: 'custom-openai',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'custom-key',
        models: [{ id: 'gpt-4o', input: ['text', 'image'], supportsTools: true, supportsReasoning: true, inputContext: 128, outputContext: 32 }],
      }
    );
    existing.default_model = 'gpt-4o';

    const next = buildScodeConfigFromLoginPayload(
      {
        sudorouterKey: 'router-key',
        modelServiceUrl: 'https://hk.sudorouter.ai/v1',
        models: ['gemini-3-flash-preview'],
      },
      existing
    );

    expect(next.auth_modes?.proxy?.sudorouter).toEqual({
      baseUrl: 'https://hk.sudorouter.ai/v1',
      apiKey: 'router-key',
    });
    expect(next.auth_modes?.['api-key']?.['custom-openai']).toEqual({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'custom-key',
    });
    expect(next.models?.['legacy-router-model']).toBeUndefined();
    expect(next.models?.['gemini-3-flash-preview']?.providers?.proxy?.provider).toBe('sudorouter');
    expect(next.models?.['gpt-4o']?.providers?.['api-key']).toEqual({
      provider: 'custom-openai',
      model: 'gpt-4o',
      api: 'openai-completions',
    });
    expect(next.models?.['gpt-4o']?.supports_tools).toBe(true);
    expect(next.models?.['gpt-4o']?.supports_reasoning).toBe(true);
    expect(next.models?.['gpt-4o']?.context).toEqual({ input: 128, output: 32 });
    expect(next.default_model).toBe('gpt-4o');
  });

  it('adds and replaces a custom OpenAI-compatible provider', () => {
    const first = mergeCustomProviderIntoScodeConfig(null, {
      providerId: 'custom-openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'key-1',
      models: [{ id: 'gpt-4o' }],
    });
    const second = mergeCustomProviderIntoScodeConfig(first, {
      providerId: 'custom-openai',
      baseUrl: 'https://api2.example.com/v1',
      apiKey: 'key-2',
      models: [{ id: 'gpt-4.1' }],
    });

    expect(second.auth_modes?.['api-key']?.['custom-openai']).toEqual({
      baseUrl: 'https://api2.example.com/v1',
      apiKey: 'key-2',
    });
    expect(second.models?.['gpt-4o']).toBeUndefined();
    expect(second.models?.['gpt-4.1']?.providers?.['api-key']?.provider).toBe('custom-openai');
  });

  it('removes a custom provider without affecting sudorouter models', () => {
    const withCustom = mergeCustomProviderIntoScodeConfig(
      buildScodeConfigFromLoginPayload({
        sudorouterKey: 'router-key',
        modelServiceUrl: 'https://hk.sudorouter.ai/v1',
        models: ['gemini-3-flash-preview'],
      }),
      {
        providerId: 'custom-openai',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'custom-key',
        models: [{ id: 'gpt-4o' }],
      }
    );

    const next = removeCustomProviderFromScodeConfig(withCustom, 'custom-openai');

    expect(next.auth_modes?.proxy?.sudorouter).toBeTruthy();
    expect(next.auth_modes?.['api-key']).toBeUndefined();
    expect(next.models?.['gemini-3-flash-preview']).toBeTruthy();
    expect(next.models?.['gpt-4o']).toBeUndefined();
    expect(next.default_model).toBe('gemini-3-flash-preview');
  });

  it('extracts and reapplies custom providers for database-backed scode settings', () => {
    const withCustom = mergeCustomProviderIntoScodeConfig(
      buildScodeConfigFromLoginPayload({
        sudorouterKey: 'router-key',
        modelServiceUrl: 'https://hk.sudorouter.ai/v1',
        models: ['gemini-3-flash-preview'],
      }),
      {
        providerId: 'custom-openai',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'custom-key',
        models: [{ id: 'gpt-4o', input: ['text', 'image'], supportsTools: true, supportsReasoning: false, inputContext: 128, outputContext: 16 }],
      }
    );

    const customProviders = extractCustomProvidersFromScodeConfig(withCustom);
    const restored = mergeCustomProvidersIntoScodeConfig({}, customProviders);

    expect(customProviders).toEqual([
      {
        providerId: 'custom-openai',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'custom-key',
        models: [{ id: 'gpt-4o', name: 'gpt-4o', input: ['text', 'image'], supportsTools: true, supportsReasoning: false, inputContext: 128, outputContext: 16 }],
      },
    ]);
    expect(restored.auth_modes?.['api-key']?.['custom-openai']).toEqual({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'custom-key',
    });
    expect(restored.models?.['gpt-4o']?.providers?.['api-key']?.provider).toBe('custom-openai');
  });
});
