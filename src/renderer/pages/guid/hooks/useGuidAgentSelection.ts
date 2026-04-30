/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { resolvePreferredAcpModelId } from '@/common/acp/defaultModels';
import { getPresetById } from '@/common/presets/presetResolver';
import { DEFAULT_CODEX_MODELS } from '@/common/codex/codexModels';
import type { IProvider } from '@/common/storage';
import { ConfigStorage } from '@/common/storage';
import { DEFAULT_PRESET_AGENT_TYPE, resolvePresetAgentBackend } from '@/types/acpTypes';
import type { AcpBackend, AcpBackendConfig, AcpModelInfo, AvailableAgent, EffectiveAgentInfo, PresetAgentType } from '../types';
import { fetchAssistantsAsConfigs } from '@/renderer/shared/agents/assistantAdapter';
import { getAgentModes } from '@/renderer/constants/agentModes';
import { useAppMode } from '@/renderer/hooks/useAppMode';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR, { mutate } from 'swr';
import { emitter } from '@/renderer/utils/emitter';

/**
 * Check if rules contain explicit identity statement like "你是 XX 助手" or "You are XX"
 * Also detects [Identity Override] blocks that we inject
 */
function hasExplicitIdentity(rules: string): boolean {
  if (!rules) return false;
  // Check for Identity Override block (injected by our system)
  if (rules.includes('[Identity Override')) return true;
  // Chinese patterns: "你是 XX 助手", "你是 **XX**", "你的身份是"
  const zhPatterns = [/你是\s+.{1,20}助手/, /你是\s+\*{0,2}.{1,20}\*{0,2}[，,。]/, /你的身份是[:：]?/];
  // English patterns: "You are XX assistant", "I am XX", "Your identity is"
  const enPatterns = [/You are\s+.{1,20}assistant/i, /I am\s+.{1,20}(assistant|helper|agent)/i, /Your identity is[:]?/i];
  return zhPatterns.some((p) => p.test(rules)) || enPatterns.some((p) => p.test(rules));
}

/** Save preferred mode to the agent's own config key */
async function savePreferredMode(agentKey: string, mode: string): Promise<void> {
  try {
    if (agentKey === 'gemini') {
      const config = await ConfigStorage.get('gemini.config');
      await ConfigStorage.set('gemini.config', { ...config, preferredMode: mode });
    } else if (agentKey !== 'custom') {
      const config = await ConfigStorage.get('acp.config');
      const backendConfig = config?.[agentKey as AcpBackend] || {};
      await ConfigStorage.set('acp.config', { ...config, [agentKey]: { ...backendConfig, preferredMode: mode } });
    }
  } catch {
    /* silent */
  }
}

/** Save preferred model ID to the agent's acp.config key */
async function savePreferredModelId(agentKey: string, modelId: string): Promise<void> {
  try {
    const config = await ConfigStorage.get('acp.config');
    const backendConfig = config?.[agentKey as AcpBackend] || {};
    await ConfigStorage.set('acp.config', { ...config, [agentKey]: { ...backendConfig, preferredModelId: modelId } });
  } catch {
    /* silent */
  }
}

export type GuidAgentSelectionResult = {
  selectedAgentKey: string;
  setSelectedAgentKey: (key: string) => void;
  selectedAgent: AcpBackend | 'custom';
  selectedAgentInfo: AvailableAgent | undefined;
  isPresetAgent: boolean;
  availableAgents: AvailableAgent[] | undefined;
  customAgents: AcpBackendConfig[];
  selectedMode: string;
  setSelectedMode: React.Dispatch<React.SetStateAction<string>>;
  acpCachedModels: Record<string, AcpModelInfo>;
  selectedAcpModel: string | null;
  setSelectedAcpModel: React.Dispatch<React.SetStateAction<string | null>>;
  currentAcpCachedModelInfo: AcpModelInfo | null;
  currentEffectiveAgentInfo: EffectiveAgentInfo;
  getAgentKey: (agent: { backend: AcpBackend; customAgentId?: string }) => string;
  findAgentByKey: (key: string) => AvailableAgent | undefined;
  resolvePresetRulesAndSkills: (agentInfo: { backend: AcpBackend; customAgentId?: string; context?: string } | undefined) => Promise<{ rules?: string; skills?: string }>;
  resolvePresetContext: (agentInfo: { backend: AcpBackend; customAgentId?: string; context?: string } | undefined) => Promise<string | undefined>;
  resolvePresetAgentType: (agentInfo: { backend: AcpBackend; customAgentId?: string } | undefined) => string;
  resolveEnabledSkills: (agentInfo: { backend: AcpBackend; customAgentId?: string } | undefined) => string[] | undefined;
  isMainAgentAvailable: (agentType: string) => boolean;
  getAvailableFallbackAgent: () => string | null;
  getEffectiveAgentType: (agentInfo: { backend: AcpBackend; customAgentId?: string } | undefined) => EffectiveAgentInfo;
  refreshCustomAgents: () => Promise<void>;
  customAgentAvatarMap: Map<string, string | undefined>;
  /** Reset agent selection to default state and clear persisted storage */
  resetSelection: () => void;
};

type UseGuidAgentSelectionOptions = {
  modelList: IProvider[];
  isGoogleAuth: boolean;
  localeKey: string;
  /** URL query parameter for assistant name to pre-select */
  assistantFromUrl?: string | null;
};

/**
 * Hook that manages agent selection, availability, and preset assistant logic.
 */
export const useGuidAgentSelection = ({ modelList, isGoogleAuth, localeKey, assistantFromUrl }: UseGuidAgentSelectionOptions): GuidAgentSelectionResult => {
  const [selectedAgentKey, _setSelectedAgentKey] = useState<string>(DEFAULT_PRESET_AGENT_TYPE);
  // Track selectedAgentKey with ref to avoid dependency array cycles
  const selectedAgentKeyRef = useRef<string>(DEFAULT_PRESET_AGENT_TYPE);
  const [availableAgents, setAvailableAgents] = useState<AvailableAgent[]>();
  // Track availableAgents with ref for resetSelection to access
  const availableAgentsRef = useRef<AvailableAgent[] | undefined>(undefined);
  const [customAgents, setCustomAgents] = useState<AcpBackendConfig[]>([]);
  const [selectedMode, _setSelectedMode] = useState<string>('default');
  // Track whether mode was loaded from preferences to avoid overwriting during initial load
  const selectedAgentRef = useRef<string | null>(null);
  const probedModelBackendsRef = useRef(new Set<string>());
  // Track whether we've auto-selected first agent (enterprise mode case) to prevent infinite loops
  const hasAutoSelectedAgentRef = useRef(false);
  // Track the last availableAgents to detect mode changes
  const lastAvailableAgentsKeyRef = useRef<string>('');
  const [acpCachedModels, setAcpCachedModels] = useState<Record<string, AcpModelInfo>>({});
  const [selectedAcpModel, _setSelectedAcpModel] = useState<string | null>(null);
  const { isEnterprise } = useAppMode();

  // Wrap setSelectedAgentKey to also save to storage and sync ref
  const setSelectedAgentKey = useCallback((key: string) => {
    _setSelectedAgentKey(key);
    selectedAgentKeyRef.current = key;
    ConfigStorage.set('guid.lastSelectedAgent', key).catch((error) => {
      console.error('Failed to save selected agent:', error);
    });
  }, []);

  // Internal setter that also syncs ref (for auto-selection without storage save)
  const _setSelectedAgentKeyWithRef = useCallback((key: string) => {
    _setSelectedAgentKey(key);
    selectedAgentKeyRef.current = key;
  }, []);

  // Wrap setSelectedMode to also save preferred mode to the agent's own config
  const setSelectedMode = useCallback((mode: React.SetStateAction<string>) => {
    _setSelectedMode((prev) => {
      const newMode = typeof mode === 'function' ? mode(prev) : mode;
      const agentKey = selectedAgentRef.current;
      if (agentKey) {
        void savePreferredMode(agentKey, newMode);
      }
      return newMode;
    });
  }, []);

  // Wrap setSelectedAcpModel to also save preferred model to the agent's config
  const setSelectedAcpModel = useCallback((modelId: React.SetStateAction<string | null>) => {
    _setSelectedAcpModel((prev) => {
      const newModelId = typeof modelId === 'function' ? modelId(prev) : modelId;
      const agentKey = selectedAgentRef.current;
      if (agentKey && agentKey !== 'gemini' && agentKey !== 'custom' && newModelId) {
        void savePreferredModelId(agentKey, newModelId);
      }
      return newModelId;
    });
  }, []);

  const availableCustomAgentIds = useMemo(() => {
    const ids = new Set<string>();
    (availableAgents || []).forEach((agent) => {
      if (agent.backend === 'custom' && agent.customAgentId) {
        ids.add(agent.customAgentId);
      }
    });
    return ids;
  }, [availableAgents]);

  /**
   * Get agent key for selection.
   * Returns "custom:uuid" for custom agents, backend type for others.
   */
  const getAgentKey = (agent: { backend: AcpBackend; customAgentId?: string }) => {
    return agent.backend === 'custom' && agent.customAgentId ? `custom:${agent.customAgentId}` : agent.backend;
  };

  /**
   * Find agent by key.
   * Supports both "custom:uuid" format and plain backend type.
   */
  const findAgentByKey = (key: string): AvailableAgent | undefined => {
    if (key.startsWith('custom:')) {
      const customAgentId = key.slice(7);
      const foundInAvailable = availableAgents?.find((a) => a.backend === 'custom' && a.customAgentId === customAgentId);
      if (foundInAvailable) return foundInAvailable;

      const assistant = customAgents.find((a) => a.id === customAgentId);
      if (assistant) {
        return {
          backend: 'custom' as AcpBackend,
          name: assistant.name,
          customAgentId: assistant.id,
          isPreset: true,
          context: '',
          avatar: assistant.avatar,
        };
      }
    }
    return availableAgents?.find((a) => a.backend === key);
  };

  // Derived state
  const selectedAgent = selectedAgentKey.startsWith('custom:') ? ('custom' as const) : (selectedAgentKey as AcpBackend);
  const selectedAgentInfo = useMemo(() => findAgentByKey(selectedAgentKey), [selectedAgentKey, findAgentByKey]);
  const isPresetAgent = Boolean(selectedAgentInfo?.isPreset);

  const customAgentAvatarMap = useMemo(() => {
    return new Map(customAgents.map((agent) => [agent.id, agent.avatar]));
  }, [customAgents]);

  // --- SWR: Fetch available agents ---
  const swrKey = isEnterprise ? 'eeclaw.agents.cloud' : 'acp.agents.available';
  const { data: availableAgentsData } = useSWR(swrKey, async () => {
    if (isEnterprise) {
      const result = await ipcBridge.eeclaw.getCloudAssistants.invoke();
      return result.data ?? [];
    }
    const result = await ipcBridge.acpConversation.getAvailableAgents.invoke();
    return result.data ?? [];
  });

  useEffect(() => {
    if (availableAgentsData && Array.isArray(availableAgentsData)) {
      if (isEnterprise) {
        // Enterprise agents: { key, name }[] -> AvailableAgent format
        const enterpriseAgents = availableAgentsData as unknown as Array<{ key: string; name: string }>;
        const mapped: AvailableAgent[] = enterpriseAgents.map((a) => ({
          backend: 'remote-agent' as AcpBackend,
          name: a.name,
          customAgentId: a.key,
        }));
        setAvailableAgents(mapped);
        availableAgentsRef.current = mapped;
      } else {
        setAvailableAgents(availableAgentsData as AvailableAgent[]);
        availableAgentsRef.current = availableAgentsData as AvailableAgent[];
      }
    }
  }, [availableAgentsData, isEnterprise]);

  // Enterprise mode: default to 'remote-agent' when agents are loaded
  useEffect(() => {
    if (isEnterprise && availableAgents && availableAgents.length > 0) {
      _setSelectedAgentKey('remote-agent');
    }
  }, [isEnterprise, availableAgents]);

  // Load last selected agent (skip when URL parameter takes priority)
  // Auto-select first available agent if current selection is not valid (enterprise mode case)
  useEffect(() => {
    if (!availableAgents || availableAgents.length === 0) return;
    // Skip restoring persisted agent when a URL parameter explicitly specifies the assistant
    if (assistantFromUrl) return;

    // Create a key to detect when availableAgents fundamentally changes (e.g., enterprise mode toggle)
    const agentsKey = availableAgents.map((a) => a.backend).join(',');
    if (agentsKey !== lastAvailableAgentsKeyRef.current) {
      // Agent list changed fundamentally, reset auto-selection flag
      lastAvailableAgentsKeyRef.current = agentsKey;
      hasAutoSelectedAgentRef.current = false;
    }

    let cancelled = false;

    const loadLastSelectedAgent = async () => {
      try {
        // Use ref value to avoid dependency cycle
        const currentKey = selectedAgentKeyRef.current;

        // Check if current selectedAgentKey is valid (in availableAgents)
        const currentIsInAvailable = availableAgents.some((agent) => {
          const key = agent.backend === 'custom' && agent.customAgentId ? `custom:${agent.customAgentId}` : agent.backend;
          return key === currentKey;
        });

        // If current selection is not valid (e.g., enterprise mode: 'openclaw-gateway' not available),
        // auto-select the first available agent (e.g., 'remote-agent')
        // Use ref to prevent infinite loops from re-triggering
        if (!currentIsInAvailable && !hasAutoSelectedAgentRef.current) {
          hasAutoSelectedAgentRef.current = true;
          const firstAgent = availableAgents[0];
          const firstKey = firstAgent.backend === 'custom' && firstAgent.customAgentId ? `custom:${firstAgent.customAgentId}` : firstAgent.backend;
          _setSelectedAgentKeyWithRef(firstKey);
          // Save to storage for persistence
          ConfigStorage.set('guid.lastSelectedAgent', firstKey).catch((error) => {
            console.error('Failed to save auto-selected agent:', error);
          });
          return;
        }

        // Current selection is valid or already auto-selected, try to restore saved preference
        // Only restore if it's different from current selection
        const savedAgentKey = await ConfigStorage.get('guid.lastSelectedAgent');
        if (cancelled || !savedAgentKey || savedAgentKey === currentKey) return;

        const isInAvailable = availableAgents.some((agent) => {
          const key = agent.backend === 'custom' && agent.customAgentId ? `custom:${agent.customAgentId}` : agent.backend;
          return key === savedAgentKey;
        });

        if (isInAvailable) {
          _setSelectedAgentKeyWithRef(savedAgentKey);
        }
      } catch (error) {
        console.error('Failed to load last selected agent:', error);
      }
    };

    void loadLastSelectedAgent();

    return () => {
      cancelled = true;
    };
  }, [availableAgents, assistantFromUrl]); // Intentionally NOT including selectedAgentKey/state - use ref instead

  // Load custom agents + extension-contributed assistants
  useEffect(() => {
    if (isEnterprise) return; // 企业模式不需要本地自定义助手
    let isActive = true;
    Promise.all([fetchAssistantsAsConfigs(), ipcBridge.extensions.getAssistants.invoke().catch(() => [] as Record<string, unknown>[])])
      .then(([agents, extAssistants]) => {
        if (!isActive) return;
        const list = agents.filter((agent: AcpBackendConfig) => {
          // Keep preset assistants (builtin + hub-installed) visible on Guid homepage
          // even when ACP detection has not produced custom IDs yet.
          if (agent.isPreset) return true;
          // User-created custom assistants should always be visible regardless of ACP detection
          // (they don't need to be detected as they use existing backends like gemini/claude)
          if (!agent.isBuiltin) return true;
          return availableCustomAgentIds.has(agent.id);
        });

        // 对于内置助手，如果用户尚未自定义 presetAgentType，则回退为 ASSISTANT_PRESETS 的默认值
        // 已保存的用户选择会被保留，确保用户能够修改内置助手的主代理
        // For builtin assistants, fall back to ASSISTANT_PRESETS default only when the user has not
        // customized presetAgentType. User-saved choices are preserved so the main agent of a
        // builtin assistant can actually be modified from the UI.
        for (const agent of list) {
          if (agent.id.startsWith('builtin-') && !agent.presetAgentType) {
            const presetId = agent.id.replace('builtin-', '');
            const preset = getPresetById(presetId);
            if (preset && preset.presetAgentType) {
              agent.presetAgentType = preset.presetAgentType;
            }
          }
        }

        // Merge extension-contributed assistants (they are preset assistants that don't need
        // to be in availableCustomAgentIds because they use existing backends like gemini/claude)
        for (const ext of extAssistants) {
          const id = typeof ext.id === 'string' ? ext.id : '';
          if (!id || list.some((a) => a.id === id)) continue;
          list.push({
            id,
            name: typeof ext.name === 'string' ? ext.name : id,
            nameI18n: ext.nameI18n as Record<string, string> | undefined,
            avatar: typeof ext.avatar === 'string' ? ext.avatar : undefined,
            isPreset: true,
            enabled: true,
            presetAgentType: typeof ext.presetAgentType === 'string' ? ext.presetAgentType : undefined,
            context: typeof ext.context === 'string' ? ext.context : undefined,
            contextI18n: ext.contextI18n as Record<string, string> | undefined,
            enabledSkills: Array.isArray(ext.enabledSkills) ? (ext.enabledSkills as string[]) : undefined,
            prompts: Array.isArray(ext.prompts) ? (ext.prompts as string[]) : undefined,
            promptsI18n: ext.promptsI18n as Record<string, string[]> | undefined,
          } as AcpBackendConfig);
        }

        setCustomAgents(list);
      })
      .catch((error) => {
        console.error('Failed to load custom agents:', error);
      });
    return () => {
      isActive = false;
    };
  }, [isEnterprise, availableCustomAgentIds]);

  // Pre-select assistant from URL parameter (assistantFromUrl)
  useEffect(() => {
    if (!assistantFromUrl || !customAgents || customAgents.length === 0) return;

    // Find the assistant by name (assistantFromUrl is the assistant name, not ID)
    const matchedAgent = customAgents.find((agent) => agent.name === assistantFromUrl || agent.id === assistantFromUrl);
    if (matchedAgent) {
      const agentKey = `custom:${matchedAgent.id}`;
      setSelectedAgentKey(agentKey);
    }
  }, [assistantFromUrl, customAgents, setSelectedAgentKey]);

  // Load cached ACP model lists
  useEffect(() => {
    let isActive = true;
    ConfigStorage.get('acp.cachedModels')
      .then((cached) => {
        if (!isActive) return;
        setAcpCachedModels(cached || {});
      })
      .catch(() => {
        // Silently ignore - cached models are optional
      });
    return () => {
      isActive = false;
    };
  }, []);

  // Probe account/config-scoped model info on first selection so the Guid page
  // can show switchable models before the first conversation starts.
  useEffect(() => {
    const backendToProbe: AcpBackend | null = selectedAgentKey === 'codex' || selectedAgentKey === 'scode' ? selectedAgentKey : null;
    if (!backendToProbe) return;
    if (probedModelBackendsRef.current.has(backendToProbe)) return;

    let cancelled = false;
    probedModelBackendsRef.current.add(backendToProbe);

    ipcBridge.acpConversation.probeModelInfo
      .invoke({ backend: backendToProbe })
      .then(async (result) => {
        if (cancelled) return;
        const modelInfo = result.success ? result.data?.modelInfo : null;
        if (!modelInfo?.availableModels?.length) {
          probedModelBackendsRef.current.delete(backendToProbe);
          return;
        }

        console.log(`[Guid][${backendToProbe}] Probed model info:`, modelInfo);

        const cached = (await ConfigStorage.get('acp.cachedModels').catch(() => ({}))) || {};
        if (cancelled) return;

        const nextCachedModels = {
          ...cached,
          [backendToProbe]: modelInfo,
        };

        setAcpCachedModels((prev) => ({
          ...prev,
          [backendToProbe]: modelInfo,
        }));

        await ConfigStorage.set('acp.cachedModels', nextCachedModels).catch((error) => {
          console.error('Failed to save probed ACP model info:', error);
        });
      })
      .catch((error) => {
        probedModelBackendsRef.current.delete(backendToProbe);
        console.warn(`[Guid][${backendToProbe}] Failed to probe model info:`, error);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedAgentKey]);

  // Reset selected ACP model when agent changes: prefer saved preference, fallback to cached default
  useEffect(() => {
    const backend = selectedAgentKey.startsWith('custom:') ? 'custom' : selectedAgentKey;

    let cancelled = false;
    // Read preferred model from acp.config[backend], fallback to cached model list default
    void ConfigStorage.get('acp.config')
      .then((config) => {
        if (cancelled) return;
        const preferred = config?.[backend as AcpBackend]?.preferredModelId;
        const cachedInfo = acpCachedModels[backend];
        _setSelectedAcpModel(
          resolvePreferredAcpModelId({
            backend,
            preferredModelId: preferred,
            cachedModelId: cachedInfo?.currentModelId ?? null,
          })
        );
      })
      .catch(() => {
        if (cancelled) return;
        const cachedInfo = acpCachedModels[backend];
        _setSelectedAcpModel(
          resolvePreferredAcpModelId({
            backend,
            cachedModelId: cachedInfo?.currentModelId ?? null,
          })
        );
      });

    return () => {
      cancelled = true;
    };
  }, [selectedAgentKey, acpCachedModels]);

  // Read preferred mode or fallback to legacy yoloMode config
  useEffect(() => {
    _setSelectedMode('default');
    selectedAgentRef.current = selectedAgent;
    if (!selectedAgent) return;

    let cancelled = false;

    const loadPreferredMode = async () => {
      try {
        // Read preferredMode from the agent's own config, fallback to legacy yoloMode
        let preferred: string | undefined;
        let yoloMode = false;

        if (selectedAgent === 'gemini') {
          const config = await ConfigStorage.get('gemini.config');
          preferred = config?.preferredMode;
          yoloMode = config?.yoloMode ?? false;
        } else if (selectedAgent !== 'custom') {
          const config = await ConfigStorage.get('acp.config');
          const backendConfig = config?.[selectedAgent as AcpBackend];
          preferred = backendConfig?.preferredMode;
          yoloMode = backendConfig?.yoloMode ?? false;
        }

        if (cancelled) return;

        // 1. Use preferredMode if valid
        if (preferred) {
          const modes = getAgentModes(selectedAgent);
          if (modes.some((m) => m.value === preferred)) {
            _setSelectedMode(preferred);
            return;
          }
        }

        // 2. Fallback: legacy yoloMode
        if (yoloMode) {
          const yoloValues: Record<string, string> = {
            claude: 'bypassPermissions',
            gemini: 'yolo',
            codex: 'yolo',
            iflow: 'yolo',
            qwen: 'yolo',
          };
          _setSelectedMode(yoloValues[selectedAgent] || 'yolo');
        }
      } catch {
        /* silent */
      }
    };

    void loadPreferredMode();

    return () => {
      cancelled = true;
    };
  }, [selectedAgent]);

  // --- Preset assistant resolution ---
  const resolvePresetRulesAndSkills = useCallback(
    async (agentInfo: { backend: AcpBackend; customAgentId?: string; context?: string; name?: string } | undefined): Promise<{ rules?: string; skills?: string }> => {
      if (!agentInfo) return {};
      if (agentInfo.backend !== 'custom') {
        return { rules: agentInfo.context };
      }

      const customAgentId = agentInfo.customAgentId;
      if (!customAgentId) return { rules: agentInfo.context };

      // Get agent name from agentInfo or customAgents list
      const agentName = agentInfo.name || customAgents.find((agent) => agent.id === customAgentId)?.name;

      let rules = '';
      let skills = '';

      try {
        rules = await ipcBridge.fs.readAssistantRule.invoke({
          assistantId: customAgentId,
          locale: localeKey,
        });
      } catch (error) {
        console.warn(`Failed to load rules for ${customAgentId}:`, error);
      }

      try {
        skills = await ipcBridge.fs.readAssistantSkill.invoke({
          assistantId: customAgentId,
          locale: localeKey,
        });
      } catch (_error) {
        // skills may not exist, this is normal
      }

      // Fallback for builtin assistants
      if (customAgentId.startsWith('builtin-')) {
        const presetId = customAgentId.replace('builtin-', '');
        const preset = getPresetById(presetId);
        if (preset) {
          if (!rules && preset.ruleFile) {
            try {
              rules = await ipcBridge.fs.readBuiltinRule.invoke({ fileName: preset.ruleFile });
            } catch (e) {
              console.warn(`Failed to load builtin rules for ${customAgentId}:`, e);
            }
          }
          if (!skills && preset.skillFile) {
            try {
              skills = await ipcBridge.fs.readBuiltinSkill.invoke({ fileName: preset.skillFile });
            } catch (_e) {
              // skills fallback failure is ok
            }
          }
        }
      }

      // Inject identity override if rules don't have explicit identity
      // 为没有明确身份声明的规则注入身份覆盖块
      const finalRules = rules || agentInfo.context || '';
      if (agentName && !hasExplicitIdentity(finalRules)) {
        const identityBlock = localeKey.startsWith('zh')
          ? `[Identity Override - 最高优先级]
你的身份是：${agentName}
当用户询问"你是谁"或类似身份问题时，必须回答："我是${agentName}，有什么可以帮助你的吗？"
此身份声明优先级高于 USER.md 中的默认身份声明。
\n\n`
          : `[Identity Override - Highest Priority]
Your identity is: ${agentName}
When users ask "Who are you" or similar identity questions, you MUST answer: "I am ${agentName}. How can I help you?"
This identity statement takes priority over the default identity in USER.md.
\n\n`;
        rules = identityBlock + finalRules;
      } else {
        rules = finalRules;
      }

      return { rules, skills };
    },
    [localeKey, customAgents]
  );

  const resolvePresetContext = useCallback(
    async (agentInfo: { backend: AcpBackend; customAgentId?: string; context?: string } | undefined): Promise<string | undefined> => {
      const { rules } = await resolvePresetRulesAndSkills(agentInfo);
      return rules;
    },
    [resolvePresetRulesAndSkills]
  );

  const resolvePresetAgentType = useCallback(
    (agentInfo: { backend: AcpBackend; customAgentId?: string } | undefined): string => {
      if (!agentInfo) return DEFAULT_PRESET_AGENT_TYPE;
      if (agentInfo.backend !== 'custom') return agentInfo.backend as string;
      const customAgent = customAgents.find((agent) => agent.id === agentInfo.customAgentId);
      return resolvePresetAgentBackend(customAgent?.presetAgentType);
    },
    [customAgents]
  );

  const resolveEnabledSkills = useCallback(
    (agentInfo: { backend: AcpBackend; customAgentId?: string } | undefined): string[] | undefined => {
      if (!agentInfo) return undefined;
      if (agentInfo.backend !== 'custom') return undefined;
      const customAgent = customAgents.find((agent) => agent.id === agentInfo.customAgentId);
      // For preset assistants (custom backend), treat missing enabledSkills as
      // an explicit empty array so that downstream consumers do not fall back to
      // loading *all* skills.
      return customAgent?.enabledSkills ?? [];
    },
    [customAgents]
  );

  // --- Availability checks ---
  const isMainAgentAvailable = useCallback(
    (agentType: string): boolean => {
      const actualBackend = resolvePresetAgentBackend(agentType);
      return (
        availableAgents?.some((agent) => {
          if (agent.backend !== actualBackend) return false;
          if (actualBackend === 'scode') return !!agent.cliPath;
          return true;
        }) ?? false
      );
    },
    [availableAgents]
  );

  const getAvailableFallbackAgent = useCallback((): string | null => {
    const fallbackOrder: PresetAgentType[] = ['claude'];
    for (const agentType of fallbackOrder) {
      if (isMainAgentAvailable(agentType)) {
        return agentType;
      }
    }
    return null;
  }, [isMainAgentAvailable]);

  const getEffectiveAgentType = useCallback(
    (agentInfo: { backend: AcpBackend; customAgentId?: string } | undefined): EffectiveAgentInfo => {
      const originalType = resolvePresetAgentType(agentInfo);
      const isAvailable = isMainAgentAvailable(originalType);
      return { agentType: originalType, isFallback: false, originalType, isAvailable };
    },
    [resolvePresetAgentType, isMainAgentAvailable]
  );

  const currentEffectiveAgentInfo = useMemo(() => {
    if (!isPresetAgent) {
      const isAvailable = isMainAgentAvailable(selectedAgent as string);
      return { agentType: selectedAgent as string, isFallback: false, originalType: selectedAgent as string, isAvailable };
    }
    return getEffectiveAgentType(selectedAgentInfo);
  }, [isPresetAgent, selectedAgent, selectedAgentInfo, getEffectiveAgentType, isMainAgentAvailable]);

  const currentAcpCachedModelInfo = useMemo(() => {
    const backend = selectedAgentKey.startsWith('custom:') ? 'custom' : selectedAgentKey;
    const cached = acpCachedModels[backend];
    if (cached) return cached;

    // Fallback: when no cached models exist for codex (e.g., first launch or stale cache),
    // use the hardcoded default list so the Guid page shows a model selector immediately.
    if (backend === 'codex' && DEFAULT_CODEX_MODELS.length > 0) {
      return {
        source: 'models' as const,
        currentModelId: DEFAULT_CODEX_MODELS[0].id,
        currentModelLabel: DEFAULT_CODEX_MODELS[0].label,
        availableModels: DEFAULT_CODEX_MODELS.map((m) => ({ id: m.id, label: m.label })),
        canSwitch: true,
      } satisfies AcpModelInfo;
    }

    return null;
  }, [selectedAgentKey, acpCachedModels]);

  // Auto-switch only for Gemini agent
  useEffect(() => {
    if (!availableAgents || availableAgents.length === 0) return;
    if (selectedAgent === 'gemini' && !currentEffectiveAgentInfo.isAvailable) {
      console.log('[Guid] Gemini is not configured. Will check for alternatives when sending.');
    }
  }, [availableAgents, currentEffectiveAgentInfo, selectedAgent]);

  const refreshCustomAgents = useCallback(async () => {
    try {
      if (isEnterprise) {
        await mutate('eeclaw.agents.cloud');
        return;
      }
      await ipcBridge.acpConversation.refreshCustomAgents.invoke();
      await mutate('acp.agents.available');

      // Reload customAgents state from assistantHub
      const agents = await fetchAssistantsAsConfigs();

      // Apply presetAgentType fallback for builtin assistants
      for (const agent of agents) {
        if (agent.id.startsWith('builtin-') && !agent.presetAgentType) {
          const presetId = agent.id.replace('builtin-', '');
          const preset = getPresetById(presetId);
          if (preset && preset.presetAgentType) {
            agent.presetAgentType = preset.presetAgentType;
          }
        }
      }

      setCustomAgents(agents);
    } catch (error) {
      console.error('Failed to refresh custom agents:', error);
    }
  }, [isEnterprise]);

  useEffect(() => {
    void refreshCustomAgents();
  }, [refreshCustomAgents]);

  // Defensive: re-scan available agents whenever the user clicks "New Chat"
  // so that newly installed agents (e.g. Claude Code) appear even if the
  // Guid page was never unmounted and the mount-only effect didn't re-run.
  // Uses rescanAgents to re-run full CLI detection on the main process,
  // then revalidates the SWR cache so the UI picks up the change.
  useEffect(() => {
    const handler = () => {
      if (isEnterprise) {
        void mutate('eeclaw.agents.cloud');
        return;
      }
      void ipcBridge.acpConversation.rescanAgents.invoke().then(() => {
        void mutate('acp.agents.available');
      });
    };
    emitter.on('guid.reset', handler);
    return () => {
      emitter.off('guid.reset', handler);
    };
  }, [isEnterprise]);

  // Reset agent selection to default state (no assistant selected)
  // In enterprise mode, directly select the first available agent (remote-agent)
  // 企业模式下直接选择第一个可用 agent
  const resetSelection = useCallback(() => {
    _setSelectedAgentKey(isEnterprise ? 'remote-agent' : DEFAULT_PRESET_AGENT_TYPE);
    selectedAgentKeyRef.current = isEnterprise ? 'remote-agent' : DEFAULT_PRESET_AGENT_TYPE;
    _setSelectedMode('default');
    _setSelectedAcpModel(null);
    hasAutoSelectedAgentRef.current = false;
    // Clear persisted agent key so it won't be restored on next mount
    ConfigStorage.set('guid.lastSelectedAgent', '').catch((error) => {
      console.error('Failed to clear saved agent:', error);
    });

    // Check if openclaw-gateway is available (non-enterprise mode)
    // If not available (enterprise mode), select first available agent directly
    const agents = availableAgentsRef.current;
    const openclawAvailable = agents?.some((a) => a.backend === 'openclaw-gateway');
    if (openclawAvailable) {
      _setSelectedAgentKey('openclaw-gateway');
      selectedAgentKeyRef.current = 'openclaw-gateway';
    } else if (agents && agents.length > 0) {
      // Enterprise mode: select first available agent (remote-agent)
      const firstAgent = agents[0];
      const firstKey = firstAgent.backend === 'custom' && firstAgent.customAgentId ? `custom:${firstAgent.customAgentId}` : firstAgent.backend;
      _setSelectedAgentKey(firstKey);
      selectedAgentKeyRef.current = firstKey;
      ConfigStorage.set('guid.lastSelectedAgent', firstKey).catch((error) => {
        console.error('Failed to save auto-selected agent:', error);
      });
    } else {
      // No agents available yet, set default and let auto-selection handle it later
      _setSelectedAgentKey(DEFAULT_PRESET_AGENT_TYPE);
      selectedAgentKeyRef.current = DEFAULT_PRESET_AGENT_TYPE;
    }
  }, [isEnterprise]);

  return {
    selectedAgentKey,
    setSelectedAgentKey,
    selectedAgent,
    selectedAgentInfo,
    isPresetAgent,
    availableAgents,
    customAgents,
    selectedMode,
    setSelectedMode,
    acpCachedModels,
    selectedAcpModel,
    setSelectedAcpModel,
    currentAcpCachedModelInfo,
    currentEffectiveAgentInfo,
    getAgentKey,
    findAgentByKey,
    resolvePresetRulesAndSkills,
    resolvePresetContext,
    resolvePresetAgentType,
    resolveEnabledSkills,
    isMainAgentAvailable,
    getAvailableFallbackAgent,
    getEffectiveAgentType,
    refreshCustomAgents,
    customAgentAvatarMap,
    resetSelection,
  };
};
