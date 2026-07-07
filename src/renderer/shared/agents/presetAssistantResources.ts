import { ipcBridge } from '@/common';
import { getPresetById } from '@/common/presets/presetResolver';

export type PresetAssistantResourceDeps = {
  readAssistantRule: (args: { assistantId: string; locale: string }) => Promise<string>;
  readAssistantSkill: (args: { assistantId: string; locale: string }) => Promise<string>;
  readBuiltinRule: (args: { fileName: string }) => Promise<string>;
  readBuiltinSkill: (args: { fileName: string }) => Promise<string>;
  getEnabledSkills: (customAgentId: string) => Promise<string[] | undefined>;
  warn: (message: string, error?: unknown) => void;
};

export type LoadPresetAssistantResourcesOptions = {
  customAgentId?: string;
  localeKey: string;
  fallbackRules?: string;
};

export type PresetAssistantResources = {
  rules?: string;
  skills: string;
  enabledSkills?: string[];
};

const defaultDeps: PresetAssistantResourceDeps = {
  readAssistantRule: (args) => ipcBridge.fs.readAssistantRule.invoke(args),
  readAssistantSkill: (args) => ipcBridge.fs.readAssistantSkill.invoke(args),
  readBuiltinRule: (args) => ipcBridge.fs.readBuiltinRule.invoke(args),
  readBuiltinSkill: (args) => ipcBridge.fs.readBuiltinSkill.invoke(args),
  getEnabledSkills: async (customAgentId) => {
    const lookupId = customAgentId.startsWith('builtin-') ? customAgentId.slice('builtin-'.length) : customAgentId;
    const result = await ipcBridge.assistantHub.getAssistantMeta.invoke({ name: lookupId });
    const meta = result?.data ?? null;
    // For preset assistants, treat missing enabledSkills as an explicit empty
    // array so that downstream consumers (workspace sync, AcpSkillManager) do
    // not fall back to loading *all* skills.
    return meta?.enabledSkills ?? meta?.defaultEnabledSkills ?? [];
  },
  warn: (message, error) => {
    console.warn(message, error);
  },
};

export async function loadPresetAssistantResources(options: LoadPresetAssistantResourcesOptions, deps: PresetAssistantResourceDeps = defaultDeps): Promise<PresetAssistantResources> {
  const { customAgentId, localeKey, fallbackRules } = options;

  if (!customAgentId) {
    return {
      rules: fallbackRules,
      skills: '',
      enabledSkills: undefined,
    };
  }

  let rules = '';
  let skills = '';

  try {
    rules = (await deps.readAssistantRule({ assistantId: customAgentId, locale: localeKey })) || '';
  } catch (error) {
    deps.warn(`[presetAssistantResources] Failed to load rules for ${customAgentId}`, error);
  }

  try {
    skills = (await deps.readAssistantSkill({ assistantId: customAgentId, locale: localeKey })) || '';
  } catch (error) {
    deps.warn(`[presetAssistantResources] Failed to load skills for ${customAgentId}`, error);
  }

  if (customAgentId.startsWith('builtin-')) {
    const presetId = customAgentId.replace('builtin-', '');
    const preset = getPresetById(presetId);

    if (preset) {
      if (!rules && preset.ruleFile) {
        try {
          rules = (await deps.readBuiltinRule({ fileName: preset.ruleFile })) || '';
        } catch (error) {
          deps.warn(`[presetAssistantResources] Failed to load builtin rules for ${customAgentId}`, error);
        }
      }

      if (!skills && preset.skillFile) {
        try {
          skills = (await deps.readBuiltinSkill({ fileName: preset.skillFile })) || '';
        } catch (error) {
          deps.warn(`[presetAssistantResources] Failed to load builtin skills for ${customAgentId}`, error);
        }
      }
    }
  }

  return {
    rules: rules || fallbackRules,
    skills,
    enabledSkills: await deps.getEnabledSkills(customAgentId),
  };
}
