import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR, { mutate } from 'swr';
import { ipcBridge } from '@/common';
import { resolvePreferredAcpModelId } from '@/common/acp/defaultModels';
import { getPresetById } from '@/common/presets/presetResolver';
import { DEFAULT_CODEX_MODELS } from '@/common/codex/codexModels';
import type { IProvider } from '@/common/storage';
import { ConfigStorage } from '@/common/storage';
import { DEFAULT_PRESET_AGENT_TYPE, resolvePresetAgentBackend } from '@/types/acpTypes';
import { fetchAssistantsAsConfigs } from '@/renderer/shared/agents/assistantAdapter';
import { getAgentModes } from '@/renderer/utils/agentModes';
import { useAppMode } from '@/renderer/hooks/useAppMode';
import { emitter } from '@/renderer/utils/emitter';
import { EECLAW_AUTH_STORAGE_KEY } from '@/renderer/context/AuthContext';
import type { AcpBackend, AcpBackendConfig, AcpModelInfo, AvailableAgent, EffectiveAgentInfo, PresetAgentType } from '../types';
import { resolveGuidModelBackendKey } from '../utils/modelBackendKey';

// Module-level cache for cross-component-tree synchronous access (e.g., useConversations)
// 模块级缓存，供非 GuidPage 组件树（如 useConversations）同步读取
let rendererCachedSessionMode: 'remote' | 'local' = 'remote';

/** 供 useConversations 等非 GuidPage 组件树同步读取当前 sessionMode */
export function getRendererSessionMode(): 'remote' | 'local' {
  return rendererCachedSessionMode;
}

export function setRendererSessionMode(mode: 'remote' | 'local'): void {
  rendererCachedSessionMode = mode;
}

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

type CloudAssistant = {
  key: string;
  name: string;
  avatar?: string;
  emoji?: string;
  description?: string;
  isBuiltin?: boolean;
  isHubInstalled?: boolean;
  sourceType?: string | null;
  tag?: string;
};

function getCloudAssistantSourceType(assistant: CloudAssistant): string {
  return assistant.sourceType || assistant.tag || (assistant.isHubInstalled ? 'hub' : '');
}

function isSelectableCloudAssistant(assistant: CloudAssistant): boolean {
  if (!assistant.key || assistant.isBuiltin) return false;
  const sourceType = getCloudAssistantSourceType(assistant);
  return assistant.isHubInstalled || sourceType === 'hub' || sourceType === 'custom' || sourceType === 'upload';
}

function getAssistantDisplayName(agent: Pick<AcpBackendConfig, 'name' | 'nameI18n'>): string {
  return agent.nameI18n?.['zh-CN'] || agent.nameI18n?.['en-US'] || agent.name;
}

function getAssistantDedupeKey(agent: Pick<AcpBackendConfig, 'id' | 'name' | 'nameI18n'>): string {
  return getAssistantDisplayName(agent).trim().toLowerCase() || agent.id;
}

function dedupeAssistantConfigs(agents: AcpBackendConfig[]): AcpBackendConfig[] {
  const seen = new Set<string>();
  const deduped: AcpBackendConfig[] = [];
  for (const agent of agents) {
    const keys = [agent.id, getAssistantDedupeKey(agent)].filter(Boolean);
    if (keys.some((key) => seen.has(key))) continue;
    for (const key of keys) {
      seen.add(key);
    }
    deduped.push(agent);
  }
  return deduped;
}

function toCloudAssistantConfig(assistant: CloudAssistant): AcpBackendConfig {
  const id = assistant.key || assistant.name;
  const avatar = assistant.avatar || assistant.emoji;
  return {
    id,
    name: assistant.name || id,
    nameI18n: { 'zh-CN': assistant.name || id, 'en-US': assistant.name || id },
    description: assistant.description,
    avatar,
    enabled: true,
    isPreset: true,
    presetAgentType: 'remote-agent',
  };
}

function mergeAssistantConfigs(localAgents: AcpBackendConfig[], cloudAssistants: CloudAssistant[]): AcpBackendConfig[] {
  const merged = dedupeAssistantConfigs(localAgents);
  const seen = new Set<string>();
  for (const agent of merged) {
    seen.add(agent.id);
    seen.add(getAssistantDedupeKey(agent));
  }

  for (const assistant of cloudAssistants) {
    if (!isSelectableCloudAssistant(assistant)) continue;
    const cloudConfig = toCloudAssistantConfig(assistant);
    const keys = [cloudConfig.id, getAssistantDedupeKey(cloudConfig)].filter(Boolean);
    if (keys.some((key) => seen.has(key))) continue;
    merged.push(cloudConfig);
    for (const key of keys) {
      seen.add(key);
    }
  }
  return merged;
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
  /** Available agents filtered for mention selector (enterprise local mode only exposes scode) */
  mentionAvailableAgents: AvailableAgent[] | undefined;
  customAgents: AcpBackendConfig[];
  /** Current session mode (remote/local) - only meaningful in enterprise mode */
  sessionMode: 'remote' | 'local';
  /** Set session mode and trigger history refresh */
  setSessionMode: (mode: 'remote' | 'local') => void;
  selectedMode: string;
  setSelectedMode: React.Dispatch<React.SetStateAction<string>>;
  acpCachedModels: Record<string, AcpModelInfo>;
  selectedAcpModel: string | null;
  setSelectedAcpModel: React.Dispatch<React.SetStateAction<string | null>>;
  currentAcpCachedModelInfo: AcpModelInfo | null;
  modelBackendKey: string;
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
export const useGuidAgentSelection = ({ localeKey, assistantFromUrl }: UseGuidAgentSelectionOptions): GuidAgentSelectionResult => {
  const { isEnterprise } = useAppMode();

  // Initial selected agent key: enterprise mode defaults to generic 'remote-agent'
  const getInitialAgentKey = useCallback(() => {
    return isEnterprise ? 'remote-agent' : DEFAULT_PRESET_AGENT_TYPE;
  }, [isEnterprise]);

  const [selectedAgentKey, _setSelectedAgentKey] = useState<string>(() => getInitialAgentKey());
  // Track selectedAgentKey with ref to avoid dependency array cycles
  const selectedAgentKeyRef = useRef<string>(getInitialAgentKey());
  const [availableAgents, setAvailableAgents] = useState<AvailableAgent[]>();
  // Track availableAgents with ref for resetSelection to access
  const availableAgentsRef = useRef<AvailableAgent[] | undefined>(undefined);
  const [customAgents, setCustomAgents] = useState<AcpBackendConfig[]>([]);
  // Session mode state (remote/local) - SSOT for enterprise mode
  // sessionMode 状态（remote/local）— 企业模式的唯一权威来源
  const [sessionMode, _setSessionMode] = useState<'remote' | 'local'>('remote');
  const [selectedMode, _setSelectedMode] = useState<string>('default');
  // Track whether mode was loaded from preferences to avoid overwriting during initial load
  const selectedAgentRef = useRef<string | null>(null);
  const modelBackendKeyRef = useRef<string>(isEnterprise ? 'remote-agent' : DEFAULT_PRESET_AGENT_TYPE);
  const probedModelBackendsRef = useRef(new Set<string>());
  // Track whether we've auto-selected first agent (enterprise mode case) to prevent infinite loops
  const hasAutoSelectedAgentRef = useRef(false);
  // Track the last availableAgents to detect mode changes
  const lastAvailableAgentsKeyRef = useRef<string>('');
  const [acpCachedModels, setAcpCachedModels] = useState<Record<string, AcpModelInfo>>({});
  const [selectedAcpModel, _setSelectedAcpModel] = useState<string | null>(null);

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
      const modelBackendKey = modelBackendKeyRef.current;
      if (modelBackendKey && modelBackendKey !== 'gemini' && newModelId) {
        // For remote-agent, save to Moss Server via IPC
        if (modelBackendKey === 'remote-agent') {
          ipcBridge.moss.setUserModel.invoke({ modelId: newModelId }).catch((error) => {
            console.warn('[Guid][remote-agent] Failed to save model preference:', error);
          });
        } else {
          void savePreferredModelId(modelBackendKey, newModelId);
        }
      }
      return newModelId;
    });
  }, []);

  // --- sessionMode: initialization from ConfigStorage ---
  // 应用启动时从 ConfigStorage 异步读取 sessionMode，同步更新模块缓存
  // 仅企业模式需要 sessionMode，C端用户无需初始化
  useEffect(() => {
    if (!isEnterprise) return;
    void ConfigStorage.get('guid.sessionMode').then(async (stored) => {
      let mode = stored ?? 'remote';
      // Validate localModeAvailable: fallback to remote if 'local' persisted but user lacks permission
      if (mode === 'local') {
        try {
          const eeclawStored = localStorage.getItem(EECLAW_AUTH_STORAGE_KEY);
          const authData = eeclawStored ? JSON.parse(eeclawStored) : null;
          if (!authData?.user?.localModeAvailable) {
            mode = 'remote';
            await ConfigStorage.set('guid.sessionMode', 'remote').catch(() => {});
          }
        } catch {
          mode = 'remote';
          await ConfigStorage.set('guid.sessionMode', 'remote').catch(() => {});
        }
      }
      _setSessionMode(mode);
      rendererCachedSessionMode = mode;
      if (mode === 'local') {
        _setSelectedAgentKey('scode');
        selectedAgentKeyRef.current = 'scode';
      } else {
        _setSelectedAgentKey('remote-agent');
        selectedAgentKeyRef.current = 'remote-agent';
      }
      emitter.emit('chat.history.refresh');
    });
  }, [isEnterprise]);

  // --- sessionMode: setSessionMode wrapper with side effects ---
  // setSessionMode 封装：同步模块缓存 + 持久化 + IPC + 刷新历史 + 重置 agent 选择
  const setSessionMode = useCallback((mode: 'remote' | 'local') => {
    _setSessionMode(mode);
    rendererCachedSessionMode = mode;
    ConfigStorage.set('guid.sessionMode', mode).catch(() => {});
    ipcBridge.eeclaw.setSessionMode.invoke({ mode }).catch(() => {});
    emitter.emit('chat.history.refresh');

    setCustomAgents([]);

    // Reset selectedAgentKey to the default for the new mode
    // 切换 mode 时重置 agent 选择为对应 mode 的默认值
    if (mode === 'local') {
      _setSelectedAgentKey('scode');
      selectedAgentKeyRef.current = 'scode';
    } else {
      _setSelectedAgentKey('remote-agent');
      selectedAgentKeyRef.current = 'remote-agent';
    }
  }, []);

  // When isEnterprise changes, update the default agent selection
  useEffect(() => {
    if (isEnterprise) {
      // Enterprise mode: default to generic 'remote-agent' (no specific assistant)
      if (selectedAgentKeyRef.current !== 'remote-agent' && !selectedAgentKeyRef.current.startsWith('custom:')) {
        _setSelectedAgentKey('remote-agent');
        selectedAgentKeyRef.current = 'remote-agent';
        ConfigStorage.set('guid.lastSelectedAgent', 'remote-agent').catch((error) => {
          console.error('Failed to save enterprise agent:', error);
        });
      }
    } else {
      // Consumer mode: reset to default preset if currently on remote-agent or custom
      if (selectedAgentKeyRef.current === 'remote-agent' || selectedAgentKeyRef.current.startsWith('custom:')) {
        _setSelectedAgentKey(DEFAULT_PRESET_AGENT_TYPE);
        selectedAgentKeyRef.current = DEFAULT_PRESET_AGENT_TYPE;
        ConfigStorage.set('guid.lastSelectedAgent', DEFAULT_PRESET_AGENT_TYPE).catch((error) => {
          console.error('Failed to save consumer agent:', error);
        });
      }
    }
  }, [isEnterprise]);

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
    return agent.customAgentId ? `custom:${agent.customAgentId}` : agent.backend;
  };

  /**
   * Find agent by key.
   * Supports both "custom:uuid" format and plain backend type.
   * For enterprise mode, also checks customAgents for local assistants.
   */
  const findAgentByKey = (key: string): AvailableAgent | undefined => {
    if (key.startsWith('custom:')) {
      const customAgentId = key.slice(7);

      // First check availableAgents (for non-enterprise custom agents)
      const foundInAvailable = availableAgents?.find((a) => a.customAgentId === customAgentId);
      if (foundInAvailable) return foundInAvailable;

      // Check customAgents (local assistants from hub/tenant/custom/system directories)
      const assistant = customAgents.find((a) => a.id === customAgentId);
      if (assistant) {
        return {
          backend: 'custom' as AcpBackend,
          name: assistant.name,
          customAgentId: assistant.id,
          isPreset: assistant.isPreset,
          context: assistant.description || '',
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
  const modelBackendKey = useMemo(
    () =>
      resolveGuidModelBackendKey({
        isEnterprise,
        sessionMode,
        selectedAgentKey,
        selectedAgentInfo,
        customAgents,
      }),
    [customAgents, isEnterprise, selectedAgentInfo, selectedAgentKey, sessionMode]
  );
  modelBackendKeyRef.current = modelBackendKey;

  const customAgentAvatarMap = useMemo(() => {
    return new Map(customAgents.map((agent) => [agent.id, agent.avatar]));
  }, [customAgents]);

  // --- SWR: Fetch available agents ---
  // E端 Remote 模式使用云端助手列表，其他模式使用本地 ACP agent 列表
  const swrKey = isEnterprise && sessionMode === 'remote' ? 'eeclaw.agents.cloud' : 'acp.agents.available';
  const { data: availableAgentsData } = useSWR(swrKey, async () => {
    if (isEnterprise && sessionMode === 'remote') {
      const result = await ipcBridge.eeclaw.getCloudAssistants.invoke();
      return result.data ?? [];
    }
    const result = await ipcBridge.acpConversation.getAvailableAgents.invoke();
    return result.data ?? [];
  });

  useEffect(() => {
    if (isEnterprise && sessionMode === 'remote') {
      // Enterprise Remote mode: availableAgents only contains Remote Agent for the top AgentPillBar.
      // customAgents are loaded from local hub/tenant/custom/system folders by the effect below
      // (those folders are kept in sync with the remote Moss server, so no extra cloud fetch is needed here).
      // E端 Remote 模式：availableAgents 只占位 Remote Agent；customAgents 由下方 effect 从本地 hub/tenant/custom/system 加载。
      const mapped: AvailableAgent[] = [
        {
          backend: 'remote-agent' as AcpBackend,
          name: 'Remote Agent',
          customAgentId: undefined,
        },
      ];
      setAvailableAgents(mapped);
      availableAgentsRef.current = mapped;
      return;
    }
    if (availableAgentsData && Array.isArray(availableAgentsData)) {
      // Consumer mode / Enterprise Local: unchanged
      setAvailableAgents(availableAgentsData as AvailableAgent[]);
      availableAgentsRef.current = availableAgentsData as AvailableAgent[];
    }
  }, [availableAgentsData, isEnterprise, sessionMode]);

  // Enterprise mode Remote session: keep current selection if valid
  useEffect(() => {
    if (isEnterprise && sessionMode === 'remote' && availableAgents && availableAgents.length > 0) {
      const currentKey = selectedAgentKeyRef.current;
      // 'remote-agent' is always valid
      if (currentKey === 'remote-agent') return;

      // Check if current selection is a valid local assistant
      const isValidAssistant = customAgents.some((a) => `custom:${a.id}` === currentKey);

      if (!isValidAssistant) {
        _setSelectedAgentKey('remote-agent');
        selectedAgentKeyRef.current = 'remote-agent';
      }
    }
  }, [isEnterprise, sessionMode, availableAgents, customAgents]);

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

        // If current selection is not valid, auto-select first available — BUT NOT in enterprise mode
        // (enterprise mode: 'remote-agent' is always valid, and we don't force-select specific agents)
        if (!currentIsInAvailable && !hasAutoSelectedAgentRef.current && !isEnterprise) {
          hasAutoSelectedAgentRef.current = true;
          const firstAgent = availableAgents[0];
          const firstKey = firstAgent.customAgentId ? `custom:${firstAgent.customAgentId}` : firstAgent.backend;
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

        if (isInAvailable && !(isEnterprise && sessionMode === 'local')) {
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
  // 所有模式（E 端 Remote/Local 和 C 端）都从本地 hub/tenant/custom/system 加载助手；
  // 企业 Remote 模式下，这些目录已从 Moss server 同步，因此无需另走云端接口。
  useEffect(() => {
    let isActive = true;
    // Use the visibility-aware variant so admin-revoked enterprise assistants
    // disappear from the picker. Token comes from localStorage via the same
    // helper used by sessionBinding; falls back to the unfiltered list when
    // logged out, keeping personal-mode behavior intact.
    const assistantsPromise = (async () => {
      try {
        const { readAccessToken } = await import('@/renderer/shared/dify/sessionBinding');
        const { fetchVisibleAssistantsAsConfigs } = await import('@/renderer/shared/agents/assistantAdapter');
        return fetchVisibleAssistantsAsConfigs(readAccessToken());
      } catch {
        return fetchAssistantsAsConfigs();
      }
    })();
    Promise.all([
      assistantsPromise,
      ipcBridge.extensions.getAssistants.invoke().catch(() => [] as Record<string, unknown>[]),
      isEnterprise && sessionMode === 'remote' ? ipcBridge.eeclaw.getCloudAssistants.invoke().catch(() => ({ data: [] as CloudAssistant[] })) : Promise.resolve({ data: [] as CloudAssistant[] }),
    ])
      .then(([agents, extAssistants, cloudAssistantsResult]) => {
        if (!isActive) return;
        const cloudAssistants = Array.isArray(cloudAssistantsResult?.data) ? (cloudAssistantsResult.data as CloudAssistant[]) : [];
        const mergedAgents = isEnterprise && sessionMode === 'remote' ? mergeAssistantConfigs(agents, cloudAssistants) : agents;
        const list = mergedAgents.filter((agent: AcpBackendConfig) => {
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
  }, [isEnterprise, sessionMode, availableCustomAgentIds]);

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
    const backendToProbe: AcpBackend | null = modelBackendKey === 'codex' || modelBackendKey === 'scode' ? modelBackendKey : null;
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
  }, [modelBackendKey]);

  // Probe Moss Server model info for remote-agent in enterprise mode
  // 企业模式下为 remote-agent 获取 Moss Server 模型列表
  useEffect(() => {
    if (!isEnterprise) return;
    if (modelBackendKey !== 'remote-agent') return;
    if (sessionMode !== 'remote') return;
    if (probedModelBackendsRef.current.has('remote-agent')) return;

    let cancelled = false;
    probedModelBackendsRef.current.add('remote-agent');

    console.log('[Guid][remote-agent] Probing Moss Server model info...');

    ipcBridge.moss.getAvailableModels
      .invoke()
      .then(async (modelsResult) => {
        if (cancelled) return;
        if (!modelsResult.success || !modelsResult.data) {
          probedModelBackendsRef.current.delete('remote-agent');
          return;
        }

        const availableModels = modelsResult.data.map((m: any) => ({
          id: m.id,
          label: m.label || m.id,
        }));

        // Also get user preference and system default
        const userPrefResult = await ipcBridge.moss.getUserModel.invoke();
        if (cancelled) return;

        let currentModelId = '';
        if (userPrefResult.success && userPrefResult.data?.modelId) {
          currentModelId = userPrefResult.data.modelId;
        } else if (userPrefResult.success && userPrefResult.data?.systemDefaultModel) {
          currentModelId = userPrefResult.data.systemDefaultModel;
        } else if (availableModels.length > 0) {
          currentModelId = availableModels[0].id;
        }

        const modelInfo: AcpModelInfo = {
          source: 'models',
          currentModelId,
          currentModelLabel: availableModels.find((m) => m.id === currentModelId)?.label || currentModelId,
          canSwitch: availableModels.length > 1,
          availableModels,
        };

        console.log(`[Guid][remote-agent] Moss model info: ${JSON.stringify(modelInfo)}`);

        setAcpCachedModels((prev) => ({
          ...prev,
          ['remote-agent']: modelInfo,
        }));

        // Set selected model
        _setSelectedAcpModel(currentModelId);
      })
      .catch((error) => {
        probedModelBackendsRef.current.delete('remote-agent');
        console.warn('[Guid][remote-agent] Failed to probe Moss model info:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [isEnterprise, modelBackendKey, sessionMode]);

  // Reset selected ACP model when agent changes: prefer saved preference, fallback to cached default
  useEffect(() => {
    const backend = modelBackendKey;

    let cancelled = false;
    if (backend === 'remote-agent') {
      const cachedInfo = acpCachedModels[backend];
      _setSelectedAcpModel(cachedInfo?.currentModelId ?? null);
      return () => {
        cancelled = true;
      };
    }

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
  }, [modelBackendKey, acpCachedModels]);

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
      } catch {
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
            } catch {
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
    const backend = modelBackendKey;
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
  }, [modelBackendKey, acpCachedModels]);

  // Auto-switch only for Gemini agent
  useEffect(() => {
    if (!availableAgents || availableAgents.length === 0) return;
    if (selectedAgent === 'gemini' && !currentEffectiveAgentInfo.isAvailable) {
      console.log('[Guid] Gemini is not configured. Will check for alternatives when sending.');
    }
  }, [availableAgents, currentEffectiveAgentInfo, selectedAgent]);

  const refreshCustomAgents = useCallback(async () => {
    try {
      // Enterprise modes (remote + local) and Consumer mode all read customAgents from local
      // hub/tenant/custom/system. Only Consumer/Enterprise-Local need ACP availableAgents refresh.
      // 企业模式（Remote/Local）和 C 端都从本地 hub/tenant/custom/system 重读；仅非企业 Remote 路径需要刷新 ACP availableAgents。
      if (!(isEnterprise && sessionMode === 'remote')) {
        await ipcBridge.acpConversation.refreshCustomAgents.invoke();
        await mutate('acp.agents.available');
      }

      const [agents, cloudAssistantsResult] = await Promise.all([fetchAssistantsAsConfigs(), isEnterprise && sessionMode === 'remote' ? ipcBridge.eeclaw.getCloudAssistants.invoke().catch(() => ({ data: [] as CloudAssistant[] })) : Promise.resolve({ data: [] as CloudAssistant[] })]);
      const cloudAssistants = Array.isArray(cloudAssistantsResult?.data) ? (cloudAssistantsResult.data as CloudAssistant[]) : [];
      const mergedAgents = isEnterprise && sessionMode === 'remote' ? mergeAssistantConfigs(agents, cloudAssistants) : agents;

      // Apply presetAgentType fallback for builtin assistants
      for (const agent of mergedAgents) {
        if (agent.id.startsWith('builtin-') && !agent.presetAgentType) {
          const presetId = agent.id.replace('builtin-', '');
          const preset = getPresetById(presetId);
          if (preset && preset.presetAgentType) {
            agent.presetAgentType = preset.presetAgentType;
          }
        }
      }

      setCustomAgents(mergedAgents);
    } catch (error) {
      console.error('Failed to refresh custom agents:', error);
    }
  }, [isEnterprise, sessionMode]);

  useEffect(() => {
    void refreshCustomAgents();
  }, [refreshCustomAgents]);

  useEffect(() => {
    const handler = () => {
      void refreshCustomAgents();
    };
    emitter.on('assistants.changed', handler);
    return () => {
      emitter.off('assistants.changed', handler);
    };
  }, [refreshCustomAgents]);

  // Defensive: re-scan available agents whenever the user clicks "New Chat"
  // so that newly installed agents (e.g. Claude Code) appear even if the
  // Guid page was never unmounted and the mount-only effect didn't re-run.
  // Uses rescanAgents to re-run full CLI detection on the main process,
  // then revalidates the SWR cache so the UI picks up the change.
  useEffect(() => {
    const handler = () => {
      if (isEnterprise && sessionMode === 'remote') {
        // Enterprise Remote: customAgents come from local hub/tenant/custom/system; re-read them.
        // 企业 Remote 模式：customAgents 来自本地目录，重新读取即可。
        void refreshCustomAgents();
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
  }, [isEnterprise, sessionMode, refreshCustomAgents]);

  // Reset agent selection to default state (no assistant selected)
  // In enterprise mode, directly select the first available agent (remote-agent)
  // 企业模式下直接选择第一个可用 agent
  const resetSelection = useCallback(() => {
    // In enterprise remote mode, default to remote-agent; in local mode, default to scode
    const defaultKey = isEnterprise && sessionMode === 'remote' ? 'remote-agent' : isEnterprise && sessionMode === 'local' ? 'scode' : DEFAULT_PRESET_AGENT_TYPE;
    _setSelectedAgentKey(defaultKey);
    selectedAgentKeyRef.current = defaultKey;
    _setSelectedMode('default');
    // Don't clear selectedAcpModel - keep the user's model preference
    // 不要清除 selectedAcpModel - 保留用户的模型偏好
    hasAutoSelectedAgentRef.current = false;

    // Clear persisted agent key so it won't be restored on next mount
    ConfigStorage.set('guid.lastSelectedAgent', '').catch((error) => {
      console.error('Failed to clear saved agent:', error);
    });

    // Enterprise mode: refresh local assistants from hub/tenant/custom/system directories
    if (isEnterprise) {
      void mutate('assistantHub.installed');
      return;
    }

    // Consumer mode: check for scode availability
    const agents = availableAgentsRef.current;
    const scodeAvailable = agents?.some((a) => a.backend === 'scode');
    if (scodeAvailable) {
      _setSelectedAgentKey('scode');
      selectedAgentKeyRef.current = 'scode';
    } else if (agents && agents.length > 0) {
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
  }, [isEnterprise, sessionMode]);

  // For enterprise Local mode, only expose scode to the mention selector
  const mentionAvailableAgents = useMemo(() => {
    if (isEnterprise && sessionMode === 'local') {
      return (availableAgents ?? []).filter((a) => a.backend === 'scode');
    }
    return availableAgents;
  }, [isEnterprise, sessionMode, availableAgents]);

  return {
    selectedAgentKey,
    setSelectedAgentKey,
    selectedAgent,
    selectedAgentInfo,
    isPresetAgent,
    availableAgents,
    mentionAvailableAgents,
    customAgents,
    sessionMode,
    setSessionMode,
    selectedMode,
    setSelectedMode,
    acpCachedModels,
    selectedAcpModel,
    setSelectedAcpModel,
    currentAcpCachedModelInfo,
    modelBackendKey,
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
