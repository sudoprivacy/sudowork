import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { getScodeProxyModelInfoSync } from '@/process/services/scode/scodeProxyModels';

let tempDir: string | null = null;

function writeConfig(config: unknown): string {
  tempDir = mkdtempSync(path.join(tmpdir(), 'sudowork-scode-models-'));
  const configPath = path.join(tempDir, 'sudocode.json');
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  return configPath;
}

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe('scodeProxyModels', () => {
  it('reads both proxy and api-key models from sudocode.json', () => {
    const configPath = writeConfig({
      default_model: 'gpt-4o',
      models: {
        'gemini-3-flash-preview': {
          alias: 'gemini-3-flash-preview',
          name: 'Gemini 3 Flash',
          providers: {
            proxy: { provider: 'sudorouter', model: 'gemini-3-flash-preview', api: 'openai-completions' },
          },
        },
        'gpt-4o': {
          alias: 'gpt-4o',
          name: 'GPT 4o',
          providers: {
            'api-key': { provider: 'custom-openai', model: 'gpt-4o', api: 'openai-completions' },
          },
        },
      },
    });

    const info = getScodeProxyModelInfoSync(null, configPath);

    expect(info?.currentModelId).toBe('gpt-4o');
    expect(info?.availableModels).toEqual([
      { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash', provider: 'sudorouter', providerLabel: 'SudoRouter' },
      { id: 'gpt-4o', label: 'gpt-4o', provider: 'custom-openai', providerLabel: 'custom-openai' },
    ]);
  });

  it('uses the upstream provider model as the label for provider-scoped custom aliases', () => {
    const configPath = writeConfig({
      default_model: 'custom-openai/gpt-4o',
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
          name: 'custom-openai/gpt-4o',
          providers: {
            'api-key': { provider: 'custom-openai', model: 'gpt-4o', api: 'openai-completions' },
          },
        },
      },
    });

    const info = getScodeProxyModelInfoSync(null, configPath);

    expect(info?.currentModelId).toBe('custom-openai/gpt-4o');
    expect(info?.currentModelLabel).toBe('gpt-4o');
    expect(info?.availableModels).toEqual([
      { id: 'gpt-4o', label: 'gpt-4o', provider: 'sudorouter', providerLabel: 'SudoRouter' },
      { id: 'custom-openai/gpt-4o', label: 'gpt-4o', provider: 'custom-openai', providerLabel: 'custom-openai' },
    ]);
  });

  it('falls back to availableModels[0] when currentModelId is a stale/ghost id not in the list', () => {
    // Fixture intentionally has no default_model (so defaultInList=false) to prove
    // that a ghost explicit id falls back to availableModels[0], not to default.
    const configPath = writeConfig({
      models: {
        'custom-openai/MiniMax-M3': {
          alias: 'custom-openai/MiniMax-M3',
          name: 'MiniMax-M3',
          providers: {
            'api-key': { provider: 'custom-openai', model: 'MiniMax-M3', api: 'openai-completions' },
          },
        },
      },
    });

    const info = getScodeProxyModelInfoSync('sudorouter/gpt-5.5', configPath);

    expect(info?.currentModelId).toBe('custom-openai/MiniMax-M3');
    expect(info?.currentModelLabel).toBe('MiniMax-M3');
  });
});
