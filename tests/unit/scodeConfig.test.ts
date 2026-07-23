import { describe, expect, it } from 'vitest';
import {
  buildScodeConfigFromLoginPayload,
  extractCustomProvidersFromScodeConfig,
  mergeCustomProviderIntoScodeConfig,
  mergeCustomProvidersIntoScodeConfig,
  normalizeCustomApiKeyModelsInScodeConfig,
  removeCustomProviderFromScodeConfig,
  SCODE_AUTO_MODEL_ALIAS,
  SCODE_AUTO_ROUTER_MODEL_ID,
} from '@/common/scodeConfig';

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
        models: ['gemini-3-flash-preview', SCODE_AUTO_ROUTER_MODEL_ID],
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
    expect(next.models?.[SCODE_AUTO_MODEL_ALIAS]).toMatchObject({
      alias: SCODE_AUTO_MODEL_ALIAS,
      name: SCODE_AUTO_MODEL_ALIAS,
      providers: {
        proxy: { provider: 'sudorouter', model: SCODE_AUTO_ROUTER_MODEL_ID, api: 'openai-completions' },
      },
    });
    const sudorouterModelAliases = Object.entries(next.models || {})
      .filter(([, model]) => model.providers?.proxy?.provider === 'sudorouter')
      .map(([alias]) => alias);
    expect(sudorouterModelAliases).toEqual([SCODE_AUTO_MODEL_ALIAS, 'gemini-3-flash-preview', SCODE_AUTO_ROUTER_MODEL_ID]);
    expect(next.models?.['custom-openai/gpt-4o']?.providers?.['api-key']).toEqual({
      provider: 'custom-openai',
      model: 'gpt-4o',
      api: 'openai-completions',
    });
    expect(next.models?.['custom-openai/gpt-4o']?.supports_tools).toBe(true);
    expect(next.models?.['custom-openai/gpt-4o']?.supports_reasoning).toBe(true);
    expect(next.models?.['custom-openai/gpt-4o']?.context).toEqual({ input: 128, output: 32 });
    expect(next.default_model).toBe(SCODE_AUTO_MODEL_ALIAS);
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
    expect(second.models?.['custom-openai/gpt-4o']).toBeUndefined();
    expect(second.models?.['custom-openai/gpt-4.1']?.providers?.['api-key']?.provider).toBe('custom-openai');
  });

  it('persists multiple custom models under the same provider', () => {
    const config = mergeCustomProviderIntoScodeConfig(null, {
      providerId: 'model-sudorouter',
      baseUrl: 'https://model.sudorouter.ai/v1',
      apiKey: 'key',
      models: [{ id: 'gpt-4.1-mini' }, { id: 'gpt-4.1' }, { id: 'claude-opus-4-7', supportsTools: true }],
    });

    expect(Object.keys(config.models || {})).toEqual(['model-sudorouter/gpt-4.1-mini', 'model-sudorouter/gpt-4.1', 'model-sudorouter/claude-opus-4-7']);
    expect(config.models?.['model-sudorouter/gpt-4.1-mini']?.providers?.['api-key']).toEqual({
      provider: 'model-sudorouter',
      model: 'gpt-4.1-mini',
      api: 'openai-completions',
    });
    expect(config.models?.['model-sudorouter/claude-opus-4-7']?.supports_tools).toBe(true);
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
    expect(next.models?.['custom-openai/gpt-4o']).toBeUndefined();
    expect(next.default_model).toBe(SCODE_AUTO_MODEL_ALIAS);
  });

  it('defaults new login configs to the auto sudorouter model alias', () => {
    const next = buildScodeConfigFromLoginPayload({
      sudorouterKey: 'router-key',
      modelServiceUrl: 'https://hk.sudorouter.ai/v1',
      models: ['gemini-3-flash-preview', SCODE_AUTO_ROUTER_MODEL_ID],
    });

    expect(next.default_model).toBe(SCODE_AUTO_MODEL_ALIAS);
    expect(next.models?.[SCODE_AUTO_MODEL_ALIAS]?.providers?.proxy?.model).toBe(SCODE_AUTO_ROUTER_MODEL_ID);
  });

  it('uses the server-configured auto model from the login payload', () => {
    const next = buildScodeConfigFromLoginPayload({
      sudorouterKey: 'router-key',
      modelServiceUrl: 'https://hk.sudorouter.ai/v1',
      models: ['gemini-3-flash-preview', SCODE_AUTO_ROUTER_MODEL_ID, 'gpt-5.6'],
      scodeAutoModel: 'gpt-5.6',
    });

    expect(next.default_model).toBe(SCODE_AUTO_MODEL_ALIAS);
    expect(next.models?.[SCODE_AUTO_MODEL_ALIAS]?.providers?.proxy?.model).toBe('gpt-5.6');
  });

  it('allows the server-configured auto model to target a model outside the advertised list', () => {
    const next = buildScodeConfigFromLoginPayload({
      sudorouterKey: 'router-key',
      modelServiceUrl: 'https://hk.sudorouter.ai/v1',
      models: ['gemini-3-flash-preview'],
      scodeAutoModel: 'gpt-5.6',
    });

    expect(next.models?.[SCODE_AUTO_MODEL_ALIAS]?.providers?.proxy?.model).toBe('gpt-5.6');
    expect(next.models?.['gpt-5.6']).toBeUndefined();
  });

  it('resets existing user-selected sudorouter model to auto on login refresh', () => {
    const next = buildScodeConfigFromLoginPayload(
      {
        sudorouterKey: 'router-key',
        modelServiceUrl: 'https://hk.sudorouter.ai/v1',
        models: ['gemini-3-flash-preview', 'gpt-4o'],
      },
      {
        default_model: 'gpt-4o',
        models: {},
      }
    );

    expect(next.default_model).toBe(SCODE_AUTO_MODEL_ALIAS);
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
        models: [{ id: 'gpt-4o', name: 'gpt-4o', api: 'openai-completions', input: ['text', 'image'], supportsTools: true, supportsReasoning: false, inputContext: 128, outputContext: 16 }],
      },
    ]);
    expect(restored.auth_modes?.['api-key']?.['custom-openai']).toEqual({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'custom-key',
    });
    expect(restored.models?.['custom-openai/gpt-4o']?.providers?.['api-key']?.provider).toBe('custom-openai');
  });

  it('allows the same upstream model id across different providers by using provider-scoped aliases', () => {
    const config = mergeCustomProviderIntoScodeConfig(
      buildScodeConfigFromLoginPayload({
        sudorouterKey: 'router-key',
        modelServiceUrl: 'https://hk.sudorouter.ai/v1',
        models: ['gpt-4o'],
      }),
      {
        providerId: 'custom-openai',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'custom-key',
        models: [{ id: 'gpt-4o' }],
      }
    );

    expect(config.models?.['gpt-4o']?.providers?.proxy?.provider).toBe('sudorouter');
    expect(config.models?.['custom-openai/gpt-4o']).toMatchObject({
      alias: 'custom-openai/gpt-4o',
      name: 'custom-openai/gpt-4o',
      providers: {
        'api-key': { provider: 'custom-openai', model: 'gpt-4o', api: 'openai-completions' },
      },
    });
  });

  it('normalizes legacy custom api-key model names that collide with sudorouter models', () => {
    const config = normalizeCustomApiKeyModelsInScodeConfig({
      default_model: 'custom-openai/gpt-4o',
      auth_modes: {
        proxy: {
          sudorouter: { baseUrl: 'https://router.example.com/v1', apiKey: 'router-key' },
        },
        'api-key': {
          'custom-openai': { baseUrl: 'https://api.example.com/v1', apiKey: 'custom-key' },
        },
      },
      models: {
        'gpt-4o': {
          alias: 'gpt-4o',
          name: 'gpt-4o',
          providers: {
            proxy: { provider: 'sudorouter', model: 'gpt-4o', api: 'openai-completions' },
          },
        },
        'custom-openai/gpt-4o': {
          alias: 'custom-openai/gpt-4o',
          name: 'gpt-4o',
          providers: {
            'api-key': { provider: 'custom-openai', model: 'gpt-4o', api: 'openai-completions' },
          },
        },
      },
    });

    expect(config.default_model).toBe('custom-openai/gpt-4o');
    expect(config.models?.['gpt-4o']?.name).toBe('gpt-4o');
    expect(config.models?.['custom-openai/gpt-4o']?.name).toBe('custom-openai/gpt-4o');
    expect(config.models?.['custom-openai/gpt-4o']?.providers?.['api-key']?.model).toBe('gpt-4o');
  });

  it('uses OpenAI Responses API for custom gpt-5.4 models', () => {
    const config = mergeCustomProviderIntoScodeConfig(
      buildScodeConfigFromLoginPayload({
        sudorouterKey: 'router-key',
        modelServiceUrl: 'https://hk.sudorouter.ai/v1',
        models: ['gpt-5.4'],
      }),
      {
        providerId: 'custom-openai',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'custom-key',
        models: [{ id: 'gpt-5.4' }],
      }
    );

    expect(config.models?.['gpt-5.4']?.providers?.proxy?.api).toBe('openai-completions');
    expect(config.models?.['custom-openai/gpt-5.4']?.providers?.['api-key']).toEqual({
      provider: 'custom-openai',
      model: 'gpt-5.4',
      api: 'openai-responses',
    });
  });
});
