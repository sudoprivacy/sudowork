import { describe, expect, it } from 'vitest';
import { mergeCustomProviderIntoScodeConfig } from '@/common/scodeConfig';
import { buildProviderEditModels } from '@/renderer/pages/settings/models/utils';

describe('sudocode model settings utils', () => {
  it('preserves existing model settings and applies defaults only to newly selected provider models', () => {
    const config = mergeCustomProviderIntoScodeConfig(null, {
      providerId: 'model-sudorouter',
      baseUrl: 'https://model.sudorouter.ai/v1',
      apiKey: 'key',
      models: [
        {
          id: 'gpt-4o',
          api: 'openai-completions',
          input: ['text', 'image'],
          supportsTools: true,
          supportsReasoning: false,
          inputContext: 128,
          outputContext: 32,
        },
        {
          id: 'legacy-model',
          api: 'anthropic-messages',
          supportsTools: false,
          supportsReasoning: true,
        },
      ],
    });

    const models = buildProviderEditModels(
      config,
      {
        id: 'model-sudorouter',
        baseUrl: 'https://model.sudorouter.ai/v1',
        apiKey: 'key',
        modelIds: ['model-sudorouter/gpt-4o', 'model-sudorouter/legacy-model'],
      },
      ['gpt-4o', 'gpt-5.5'],
      {
        api: 'openai-responses',
        supportsTools: false,
        supportsVision: false,
        supportsReasoning: true,
        inputContext: 256,
        outputContext: 64,
      }
    );

    expect(models).toEqual([
      {
        id: 'gpt-4o',
        name: 'gpt-4o',
        api: 'openai-completions',
        input: ['text', 'image'],
        supportsTools: true,
        supportsReasoning: false,
        inputContext: 128,
        outputContext: 32,
      },
      {
        id: 'gpt-5.5',
        name: 'gpt-5.5',
        api: 'openai-responses',
        input: ['text'],
        supportsTools: false,
        supportsReasoning: true,
        inputContext: 256,
        outputContext: 64,
      },
    ]);
  });
});
