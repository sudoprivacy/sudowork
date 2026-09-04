import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildClaudeSettings, buildRuntimeAgentAuthFiles, syncSudoclawRuntimeState } from '@/process/services/sudoclaw/sudoclawRuntimeSync';
import type { SudoclawConfig } from '@sudowork/host-bridge/ipcBridge';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sudoclaw-runtime-sync-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('sudoclawRuntimeSync', () => {
  it('builds runtime auth files for sudorouter and provider-specific models while preserving unrelated profiles', () => {
    const { profilesFile, stateFile } = buildRuntimeAgentAuthFiles(
      {
        sudorouter: { apiKey: 'root-key' },
        'sudorouter-gemini-3-flash-preview': { apiKey: 'gemini-key' },
        'sudorouter-claude-sonnet-4': {},
      },
      {
        version: 1,
        profiles: {
          'manual-profile': {
            type: 'oauth',
            provider: 'github',
          },
          'legacy-provider-api-key': {
            type: 'api_key',
            provider: 'legacy-provider',
            key: 'legacy-key',
          },
          'sudorouter-gemini-3-flash-preview-api-key': {
            type: 'api_key',
            provider: 'sudorouter-gemini-3-flash-preview',
            keyRef: 'secret-ref',
            displayName: 'Gemini',
          },
        },
      },
      {
        order: {
          'legacy-provider': ['legacy-provider-api-key'],
          'sudorouter-claude-sonnet-4': ['sudorouter-claude-sonnet-4-api-key'],
        },
        lastGood: {
          'legacy-provider': 'legacy-provider-api-key',
          'sudorouter-claude-sonnet-4': 'sudorouter-claude-sonnet-4-api-key',
        },
        usageStats: {
          'manual-profile': { successes: 3 },
        },
      }
    );

    expect(profilesFile).toEqual({
      version: 1,
      profiles: {
        'manual-profile': {
          type: 'oauth',
          provider: 'github',
        },
        'sudorouter-api-key': {
          type: 'api_key',
          provider: 'sudorouter',
          key: 'root-key',
        },
        'sudorouter-gemini-3-flash-preview-api-key': {
          type: 'api_key',
          provider: 'sudorouter-gemini-3-flash-preview',
          key: 'gemini-key',
          displayName: 'Gemini',
        },
      },
    });
    expect(stateFile).toEqual({
      order: {
        sudorouter: ['sudorouter-api-key'],
        'sudorouter-gemini-3-flash-preview': ['sudorouter-gemini-3-flash-preview-api-key'],
      },
      lastGood: {
        sudorouter: 'sudorouter-api-key',
        'sudorouter-gemini-3-flash-preview': 'sudorouter-gemini-3-flash-preview-api-key',
      },
      usageStats: {
        'manual-profile': { successes: 3 },
      },
    });
  });

  it('syncs agent runtime files from config and creates auth stores for all keyed providers', () => {
    const stateDir = makeTempDir();
    const claudeSettingsPath = path.join(makeTempDir(), 'claude', 'settings.json');
    const secretWrites: Array<{ id: string; type: string; value: string }> = [];
    const config: SudoclawConfig = {
      agents: {
        defaults: {
          model: {
            primary: 'sudorouter-gemini-3-flash-preview/gemini-3-flash-preview',
          },
        },
      },
      models: {
        mode: 'merge',
        providers: {
          sudorouter: {
            apiKey: 'root-key',
            api: 'google-generative-ai',
            models: [{ id: 'gemini-3-flash-preview', name: 'gemini-3-flash-preview' }],
          },
          'sudorouter-gemini-3-flash-preview': {
            apiKey: 'gemini-key',
            api: 'google-generative-ai',
            models: [{ id: 'gemini-3-flash-preview', name: 'gemini-3-flash-preview', input: ['text', 'image'] }],
          },
        },
      },
    };

    syncSudoclawRuntimeState(config, {
      stateDir,
      claudeSettingsPath,
      secretWriter: (id, type, value) => {
        secretWrites.push({ id, type, value });
      },
    });

    expect(secretWrites).toEqual([
      { id: 'provider:sudorouter', type: 'api_key', value: 'root-key' },
      { id: 'provider:sudorouter-gemini-3-flash-preview', type: 'api_key', value: 'gemini-key' },
    ]);

    const modelsFile = JSON.parse(fs.readFileSync(path.join(stateDir, 'agents', 'main', 'agent', 'models.json'), 'utf8')) as {
      providers: Record<string, { apiKey?: string }>;
    };
    expect(modelsFile.providers.sudorouter?.apiKey).toBe('root-key');
    expect(modelsFile.providers['sudorouter-gemini-3-flash-preview']?.apiKey).toBe('gemini-key');

    const authProfiles = JSON.parse(fs.readFileSync(path.join(stateDir, 'agents', 'main', 'agent', 'auth-profiles.json'), 'utf8')) as {
      profiles: Record<string, { key?: string }>;
    };
    expect(authProfiles.profiles['sudorouter-api-key']?.key).toBe('root-key');
    expect(authProfiles.profiles['sudorouter-gemini-3-flash-preview-api-key']?.key).toBe('gemini-key');

    const authState = JSON.parse(fs.readFileSync(path.join(stateDir, 'agents', 'main', 'agent', 'auth-state.json'), 'utf8')) as {
      order: Record<string, string[]>;
      lastGood: Record<string, string>;
    };
    expect(authState.order['sudorouter-gemini-3-flash-preview']).toEqual(['sudorouter-gemini-3-flash-preview-api-key']);
    expect(authState.lastGood.sudorouter).toBe('sudorouter-api-key');

    const claudeSettings = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf8')) as {
      env: Record<string, string>;
    };
    expect(claudeSettings.env.ANTHROPIC_AUTH_TOKEN).toBe('gemini-key');
    expect(claudeSettings.env.ANTHROPIC_MODEL).toBe('gemini-3-flash-preview');
  });

  it('builds Claude settings from the primary provider api key', () => {
    expect(
      buildClaudeSettings({
        agents: {
          defaults: {
            model: {
              primary: 'sudorouter-gemini-3-flash-preview/gemini-3-flash-preview',
            },
          },
        },
        models: {
          providers: {
            'sudorouter-gemini-3-flash-preview': {
              apiKey: 'provider-key',
            },
          },
        },
      })
    ).toEqual({
      env: {
        ANTHROPIC_BASE_URL: 'https://hk.sudorouter.ai',
        ANTHROPIC_AUTH_TOKEN: 'provider-key',
        ANTHROPIC_MODEL: 'gemini-3-flash-preview',
      },
    });
  });

  it('does not persist empty auth files when config has no provider api keys', () => {
    const stateDir = makeTempDir();
    const agentDir = path.join(stateDir, 'agents', 'main', 'agent');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'auth-profiles.json'), JSON.stringify({ version: 1, profiles: {} }, null, 2), 'utf8');
    fs.writeFileSync(path.join(agentDir, 'auth-state.json'), JSON.stringify({ order: {}, lastGood: {} }, null, 2), 'utf8');

    syncSudoclawRuntimeState(
      {
        agents: {
          defaults: {
            model: {
              primary: 'sudorouter/gemini-3-flash-preview',
            },
          },
        },
        models: {
          providers: {
            sudorouter: {
              api: 'google-generative-ai',
              models: [{ id: 'gemini-3-flash-preview' }],
            },
          },
        },
      },
      {
        stateDir,
        claudeSettingsPath: path.join(makeTempDir(), 'claude', 'settings.json'),
        secretWriter: () => {},
      }
    );

    expect(fs.existsSync(path.join(agentDir, 'auth-profiles.json'))).toBe(false);
    expect(fs.existsSync(path.join(agentDir, 'auth-state.json'))).toBe(false);
  });
});
