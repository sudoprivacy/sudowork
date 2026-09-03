import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { SudoclawConfig, SudoclawProvider } from '@sudowork/host-bridge/ipcBridge';
import { cachePut } from '@/common/nexus/secret-cache';
import { getSudorouterBaseUrl } from '@/common/systemConfig';

type RuntimeAgentModelsFile = {
  providers?: Record<string, Record<string, unknown> & { models?: Array<Record<string, unknown>> }>;
};

type RuntimeAuthProfile = {
  type?: string;
  provider?: string;
  key?: string;
  keyRef?: unknown;
  email?: string;
  displayName?: string;
  [key: string]: unknown;
};

type RuntimeAuthProfilesFile = {
  version?: number;
  profiles?: Record<string, RuntimeAuthProfile>;
  [key: string]: unknown;
};

type RuntimeAuthStateFile = {
  order?: Record<string, string[]>;
  lastGood?: Record<string, string>;
  usageStats?: Record<string, unknown>;
  [key: string]: unknown;
};

type SyncRuntimeStateOptions = {
  stateDir?: string;
  claudeSettingsPath?: string;
  secretWriter?: (id: string, type: string, value: string) => void;
};

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function buildManagedProfileId(providerId: string): string {
  return `${providerId}-api-key`;
}

function getRuntimePaths(stateDir: string): {
  mainAgentDir: string;
  modelsPath: string;
  authProfilesPath: string;
  authStatePath: string;
} {
  const mainAgentDir = path.join(stateDir, 'agents', 'main', 'agent');
  return {
    mainAgentDir,
    modelsPath: path.join(mainAgentDir, 'models.json'),
    authProfilesPath: path.join(mainAgentDir, 'auth-profiles.json'),
    authStatePath: path.join(mainAgentDir, 'auth-state.json'),
  };
}

function shouldPersistAuthProfilesFile(file: RuntimeAuthProfilesFile): boolean {
  return Object.keys(file.profiles || {}).length > 0;
}

function shouldPersistAuthStateFile(file: RuntimeAuthStateFile): boolean {
  return Object.keys(file.order || {}).length > 0 || Object.keys(file.lastGood || {}).length > 0 || Object.keys(file.usageStats || {}).length > 0;
}

export function buildRuntimeAgentModelsFile(providers: Record<string, SudoclawProvider>, existing: RuntimeAgentModelsFile | null | undefined): RuntimeAgentModelsFile {
  const existingProviders = existing?.providers || {};

  return {
    providers: Object.fromEntries(
      Object.entries(providers).map(([providerId, provider]) => {
        const existingProvider = existingProviders[providerId] || {};
        const existingModels = new Map<string, Record<string, unknown>>(((existingProvider.models as Array<Record<string, unknown>> | undefined) || []).map((model) => [String(model.id || ''), model]));

        return [
          providerId,
          {
            ...existingProvider,
            ...provider,
            models: (provider.models || []).map((model) => ({
              ...(existingModels.get(model.id) || {}),
              ...model,
            })),
          },
        ];
      })
    ),
  };
}

export function buildRuntimeAgentAuthFiles(
  providers: Record<string, SudoclawProvider>,
  existingProfilesFile: RuntimeAuthProfilesFile | null | undefined,
  existingStateFile: RuntimeAuthStateFile | null | undefined
): {
  profilesFile: RuntimeAuthProfilesFile;
  stateFile: RuntimeAuthStateFile;
} {
  const providerIds = new Set(Object.keys(providers));
  const nextProfiles: Record<string, RuntimeAuthProfile> = {
    ...(existingProfilesFile?.profiles || {}),
  };
  const nextOrder: Record<string, string[]> = {
    ...(existingStateFile?.order || {}),
  };
  const nextLastGood: Record<string, string> = {
    ...(existingStateFile?.lastGood || {}),
  };

  for (const [profileId] of Object.entries(nextProfiles)) {
    if (!profileId.endsWith('-api-key')) {
      continue;
    }

    const providerId = profileId.slice(0, -'-api-key'.length);
    if (!providerIds.has(providerId)) {
      delete nextProfiles[profileId];
    }
  }

  for (const providerId of Object.keys(nextOrder)) {
    if (!providerIds.has(providerId)) {
      delete nextOrder[providerId];
    }
  }

  for (const providerId of Object.keys(nextLastGood)) {
    if (!providerIds.has(providerId)) {
      delete nextLastGood[providerId];
    }
  }

  for (const [providerId, provider] of Object.entries(providers)) {
    const apiKey = provider.apiKey?.trim();
    const profileId = buildManagedProfileId(providerId);

    if (!apiKey) {
      delete nextProfiles[profileId];
      delete nextOrder[providerId];
      delete nextLastGood[providerId];
      continue;
    }

    const existingProfile = nextProfiles[profileId];
    const { keyRef: _keyRef, key: _key, provider: _provider, type: _type, ...rest } = existingProfile || {};

    nextProfiles[profileId] = {
      ...rest,
      type: 'api_key',
      provider: providerId,
      key: apiKey,
    };
    nextOrder[providerId] = [profileId];
    nextLastGood[providerId] = profileId;
  }

  return {
    profilesFile: {
      ...(existingProfilesFile || {}),
      version: existingProfilesFile?.version || 1,
      profiles: nextProfiles,
    },
    stateFile: {
      ...(existingStateFile || {}),
      order: nextOrder,
      lastGood: nextLastGood,
    },
  };
}

export function buildClaudeSettings(config: SudoclawConfig): Record<string, unknown> | null {
  const primaryModel = config.agents?.defaults?.model?.primary || '';
  const [providerId, modelIdPart] = primaryModel.split('/');
  const provider = providerId ? config.models?.providers?.[providerId] : undefined;
  const apiKey = provider?.apiKey?.trim() || '';
  const modelId = modelIdPart || primaryModel;

  if (!apiKey) {
    return null;
  }

  return {
    env: {
      ANTHROPIC_BASE_URL: getSudorouterBaseUrl(),
      ANTHROPIC_AUTH_TOKEN: apiKey,
      ANTHROPIC_MODEL: modelId || 'gemini-3.5-flash',
    },
  };
}

export function syncSudoclawRuntimeState(config: SudoclawConfig, options: SyncRuntimeStateOptions = {}): void {
  const stateDir = options.stateDir || path.join(os.homedir(), '.nexus', 'sudoclaw');
  const claudeSettingsPath = options.claudeSettingsPath || CLAUDE_SETTINGS_PATH;
  const secretWriter = options.secretWriter || cachePut;
  const providers = config.models?.providers || {};
  const runtimePaths = getRuntimePaths(stateDir);

  for (const [providerId, provider] of Object.entries(providers)) {
    const apiKey = provider.apiKey?.trim();
    if (apiKey) {
      secretWriter(`provider:${providerId}`, 'api_key', apiKey);
    }
  }

  fs.mkdirSync(runtimePaths.mainAgentDir, { recursive: true });

  const nextModelsFile = buildRuntimeAgentModelsFile(providers, readJsonFile<RuntimeAgentModelsFile>(runtimePaths.modelsPath));
  fs.writeFileSync(runtimePaths.modelsPath, JSON.stringify(nextModelsFile, null, 2), 'utf8');

  const existingProfilesFile = readJsonFile<RuntimeAuthProfilesFile>(runtimePaths.authProfilesPath);
  const existingStateFile = readJsonFile<RuntimeAuthStateFile>(runtimePaths.authStatePath);
  const { profilesFile, stateFile } = buildRuntimeAgentAuthFiles(providers, existingProfilesFile, existingStateFile);
  if (shouldPersistAuthProfilesFile(profilesFile)) {
    fs.writeFileSync(runtimePaths.authProfilesPath, JSON.stringify(profilesFile, null, 2), 'utf8');
  } else if (fs.existsSync(runtimePaths.authProfilesPath)) {
    fs.rmSync(runtimePaths.authProfilesPath, { force: true });
  }
  if (shouldPersistAuthStateFile(stateFile)) {
    fs.writeFileSync(runtimePaths.authStatePath, JSON.stringify(stateFile, null, 2), 'utf8');
  } else if (fs.existsSync(runtimePaths.authStatePath)) {
    fs.rmSync(runtimePaths.authStatePath, { force: true });
  }

  if (fs.existsSync(claudeSettingsPath)) {
    return;
  }

  const settings = buildClaudeSettings(config);
  if (!settings) {
    return;
  }

  fs.mkdirSync(path.dirname(claudeSettingsPath), { recursive: true });
  fs.writeFileSync(claudeSettingsPath, JSON.stringify(settings, null, 2), 'utf8');
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(claudeSettingsPath, 0o600);
    } catch {
      // ignore
    }
  }
}

export function syncSudoclawRuntimeStateFromDisk(configPath: string, options: SyncRuntimeStateOptions = {}): void {
  const config = readJsonFile<SudoclawConfig>(configPath);
  if (!config) {
    return;
  }

  syncSudoclawRuntimeState(config, options);
}
