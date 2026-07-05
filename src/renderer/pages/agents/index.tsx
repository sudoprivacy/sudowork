import { Avatar, Button, Collapse, Drawer, Input, Message, Modal, Select, Spin, Tooltip, Typography } from '@arco-design/web-react';
import { Bot, Check, Plus, Search, Share2, Shield } from 'lucide-react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR, { mutate } from 'swr';
import { useNavigate } from 'react-router-dom';
import { ipcBridge, skillHub, assistantHub } from '@/common';
import { parseHubError, type HubError } from '@common/nexus/hubErrors';
import HubEmptyState from '@renderer/components/HubEmptyState';
import { eeclaw } from '@/common/ipcBridge';
import type { IInstalledSkillInfo, IAssistantHubSkill, IAssistantHubVersionLike } from '@/common/ipcBridge';
import { toBackendConfig, resolveAssistantName } from '@/renderer/shared/agents/assistantAdapter';
import Tabs from '@renderer/components/ui/Tabs';
import type { IAssistantInfo } from '@/process/AssistantManager';
import { resolveLocaleKey, uuid } from '@/common/utils';
import coworkSvg from '@/renderer/assets/cowork.svg';
import EmojiPicker from '@/renderer/components/EmojiPicker';
import MarkdownView from '@/renderer/components/Markdown';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { isElectronDesktop, resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import { DEFAULT_PRESET_AGENT_TYPE, normalizePresetAgentType } from '@/types/acpTypes';
import { useAuth } from '@/renderer/context/AuthContext';
import { useAppMode } from '@/renderer/hooks/useAppMode';
import { emitter } from '@/renderer/utils/emitter';
import PageWrapper from '@renderer/components/base/PageWrapper';
import SkillCard from './components/SkillCard';
import HubAssistantCard from './components/HubAssistantCard';
import AssistantDetailModal from './components/AssistantDetailModal';
import InstalledAssistantCard from './components/InstalledAssistantCard';
import UploadConfirmModal from './components/UploadConfirmModal';
import type { AssistantListItem, AssistantLatestVersion } from './types';
import { normalizeAssistantVersion, normalizeAssistantLookupKey, resolveAssistantVersionLike, getSelectableAssistantSkills, isAssistantSkillSelected, isAutoInjectedBuiltinSkill, sanitizeAssistantEnabledSkills, toggleAssistantSkillSelection } from './utils';

// ==================== Types ====================

/** 智能体商店标签页：store = 公共市场，exclusive = 企业专属（租户维度），installed = 本地已安装 */
type AssistantStoreTab = 'store' | 'exclusive' | 'installed';

const VERSION_CACHE_TTL = 5 * 60 * 1000;
const VERSION_FAILURE_CACHE_TTL = 60 * 1000;

const AgentSettings: React.FC = () => {
  const { t, i18n } = useTranslation();
  const localeKey = resolveLocaleKey(i18n.language);

  // Tab state
  const [activeTab, setActiveTab] = useState<AssistantStoreTab>('store');

  // Assistant list state
  const [assistants, setAssistants] = useState<AssistantListItem[]>([]);
  const [activeAssistantId, setActiveAssistantId] = useState<string | null>(null);

  // Drawer state
  const [editVisible, setEditVisible] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editContext, setEditContext] = useState('');
  const [editAvatar, setEditAvatar] = useState('');
  const [editAgent, setEditAgent] = useState<string>(DEFAULT_PRESET_AGENT_TYPE);
  const [isCreating, setIsCreating] = useState(false);
  const [promptViewMode, setPromptViewMode] = useState<'edit' | 'preview'>('preview');
  const [drawerWidth, setDrawerWidth] = useState(500);

  // Skills state
  const [installedSkills, setInstalledSkills] = useState<IInstalledSkillInfo[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const textareaWrapperRef = useRef<HTMLDivElement>(null);

  // Hub state (for store/exclusive tabs)
  const { user } = useAuth();
  const enterpriseCode = user?.enterprise_code?.trim();
  const navigate = useNavigate();
  const [hubAssistantList, setHubAssistantList] = useState<IAssistantHubSkill[]>([]);
  const [hubCategories, setHubCategories] = useState<string[]>([]);
  const [selectedHubCategory, setSelectedHubCategory] = useState('all');
  const [hubSearchQuery, setHubSearchQuery] = useState('');
  const [hubLoading, setHubLoading] = useState(true);
  const [hubLoadingMore, setHubLoadingMore] = useState(false);
  // Typed error from the most recent hub fetch — null on success.
  // Drives the differentiated empty state (token-missing vs
  // network-failed vs actually-empty). See HubEmptyState component.
  const [hubError, setHubError] = useState<HubError | null>(null);
  const [hubHasMore, setHubHasMore] = useState(false);
  const [hubNextCursor, setHubNextCursor] = useState<string | null>(null);
  const [hubDetailAssistant, setHubDetailAssistant] = useState<IAssistantHubSkill | null>(null);
  const [hubDetailVisible, setHubDetailVisible] = useState(false);
  const [hubInstalledAssistants, setHubInstalledAssistants] = useState<Map<string, string>>(new Map());
  const [installingAssistantId, setInstallingAssistantId] = useState<string | null>(null);
  const [updatingAssistantId, setUpdatingAssistantId] = useState<string | null>(null);
  const [latestAssistantVersions, setLatestAssistantVersions] = useState<Map<string, AssistantLatestVersion>>(new Map());
  const [installProgress, setInstallProgress] = useState(0);
  const [hubInstalledSkillsReady, setHubInstalledSkillsReady] = useState(false);
  // Duplicate assistant state
  const [duplicateConfirmVisible, setDuplicateConfirmVisible] = useState(false);
  const [duplicateAssistant, setDuplicateAssistant] = useState<IAssistantHubSkill | null>(null);
  const [duplicateInstalledAssistant, setDuplicateInstalledAssistant] = useState<AssistantListItem | null>(null);
  // Duplicate tenant assistant state (for enterprise mode)
  const [duplicateTenantAssistant, setDuplicateTenantAssistant] = useState<{
    id: string;
    name: string;
    displayName?: string;
    description?: string;
    enabledSkills?: string[];
  } | null>(null);
  // Upload assistant state
  const [uploadConfirmVisible, setUploadConfirmVisible] = useState(false);
  const [uploadAssistant, setUploadAssistant] = useState<AssistantListItem | null>(null);
  const [uploading, setUploading] = useState(false);

  // Enterprise mode detection - use useAppMode hook for renderer process
  const { isEnterprise } = useAppMode();

  // Upload/Publish state for enterprise mode
  const [publishingAssistantName, setPublishingAssistantName] = useState<string | null>(null);

  // Track if sync has been triggered for current tab session (avoid loop)
  const syncTriggeredRef = useRef(false);
  // Skip the debounced-search effect's first mount run — initial load is handled by the category-change effect
  const searchInitializedRef = useRef(false);

  // Sync status state
  const [syncStatus, setSyncStatus] = useState<{
    syncing: boolean;
    skills: { installed: string[]; skipped: string[]; deleted: string[]; failed: Array<{ id: string; name: string; error: string }> };
    assistants: { installed: string[]; skipped: string[]; deleted: string[]; failed: Array<{ id: string; name: string; error: string }> };
  }>({ syncing: false, skills: { installed: [], skipped: [], deleted: [], failed: [] }, assistants: { installed: [], skipped: [], deleted: [], failed: [] } });

  const avatarImageMap = React.useMemo<Record<string, string>>(
    () => ({
      'cowork.svg': coworkSvg,
      '🛠️': coworkSvg,
    }),
    []
  );

  // Extension data
  useSWR('extensions.acpAdapters', () => ipcBridge.extensions.getAcpAdapters.invoke().catch(() => [] as Record<string, unknown>[]));
  const { data: extensionAssistants } = useSWR('extensions.assistants', () => ipcBridge.extensions.getAssistants.invoke().catch(() => [] as Record<string, unknown>[]));

  const normalizedExtensionAssistants = React.useMemo<AssistantListItem[]>(() => {
    if (!Array.isArray(extensionAssistants) || extensionAssistants.length === 0) return [];
    return extensionAssistants
      .map((ext) => {
        const id = typeof ext.id === 'string' ? ext.id : '';
        const name = typeof ext.name === 'string' ? ext.name : '';
        if (!id || !name) return null;
        return {
          id,
          name,
          nameI18n: ext.nameI18n as Record<string, string> | undefined,
          description: typeof ext.description === 'string' ? ext.description : undefined,
          descriptionI18n: ext.descriptionI18n as Record<string, string> | undefined,
          avatar: typeof ext.avatar === 'string' ? ext.avatar : undefined,
          presetAgentType: typeof ext.presetAgentType === 'string' ? ext.presetAgentType : undefined,
          context: typeof ext.context === 'string' ? ext.context : undefined,
          contextI18n: ext.contextI18n as Record<string, string> | undefined,
          models: Array.isArray(ext.models) ? (ext.models as string[]) : undefined,
          enabledSkills: Array.isArray(ext.enabledSkills) ? (ext.enabledSkills as string[]) : undefined,
          prompts: Array.isArray(ext.prompts) ? (ext.prompts as string[]) : undefined,
          promptsI18n: ext.promptsI18n as Record<string, string[]> | undefined,
          isPreset: true,
          isBuiltin: false,
          enabled: true,
          _source: 'extension',
          _extensionName: typeof ext._extensionName === 'string' ? ext._extensionName : undefined,
          _kind: typeof ext._kind === 'string' ? ext._kind : undefined,
        } as AssistantListItem;
      })
      .filter((item): item is AssistantListItem => item !== null);
  }, [extensionAssistants]);

  const isExtensionAssistant = useCallback((assistant: AssistantListItem | null | undefined) => {
    if (!assistant) return false;
    return assistant._source === 'extension' || assistant.id.startsWith('ext-');
  }, []);

  // Auto focus textarea when drawer opens
  useEffect(() => {
    if (editVisible && promptViewMode === 'edit') {
      const timer = setTimeout(() => {
        const textarea = textareaWrapperRef.current?.querySelector('textarea');
        textarea?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [editVisible, promptViewMode]);

  useEffect(() => {
    const updateDrawerWidth = () => {
      if (typeof window === 'undefined') return;
      const nextWidth = Math.min(500, Math.max(320, Math.floor(window.innerWidth - 32)));
      setDrawerWidth(nextWidth);
    };
    updateDrawerWidth();
    window.addEventListener('resize', updateDrawerWidth);
    return () => window.removeEventListener('resize', updateDrawerWidth);
  }, []);

  // Load installed skills
  const loadInstalledSkills = useCallback(async (): Promise<IInstalledSkillInfo[]> => {
    if (!isElectronDesktop()) {
      setInstalledSkills([]);
      setHubInstalledSkillsReady(true);
      return [];
    }
    try {
      const res = await skillHub.getInstalledSkills.invoke();
      if (res.success && res.data) {
        const selectableSkills = getSelectableAssistantSkills(res.data);
        setInstalledSkills(selectableSkills);
        setHubInstalledSkillsReady(true);
        return selectableSkills;
      }
    } catch (error) {
      console.error('Failed to load installed skills:', error);
    }
    setInstalledSkills([]);
    setHubInstalledSkillsReady(true);
    return [];
  }, []);

  const customSelectableSkills = installedSkills.filter((skill) => !skill.isBuiltin);
  const builtinSelectableSkills = installedSkills.filter((skill) => skill.isBuiltin && !isAutoInjectedBuiltinSkill(skill));

  // Hub refs for infinite scroll (mirrors SkillModalContent pattern)
  const sentinelRef = useRef<HTMLDivElement>(null);
  const selectedHubCategoryRef = useRef(selectedHubCategory);
  selectedHubCategoryRef.current = selectedHubCategory;
  const hubSearchQueryRef = useRef(hubSearchQuery);
  hubSearchQueryRef.current = hubSearchQuery;
  const latestAssistantVersionsRef = useRef(latestAssistantVersions);
  latestAssistantVersionsRef.current = latestAssistantVersions;
  const failedAssistantVersionFetchesRef = useRef<Map<string, number>>(new Map());
  const fetchingAssistantVersionIdsRef = useRef<Set<string>>(new Set());

  // Resolve tenant ID for exclusive tab
  const resolveAssistantTenantId = useCallback(
    (tab: AssistantStoreTab): string | undefined => {
      const normalized = enterpriseCode;
      if (tab !== 'exclusive' || !normalized) return undefined;
      return normalized;
    },
    [enterpriseCode]
  );

  const currentAssistantTenantId = resolveAssistantTenantId(activeTab);

  // Keep fetchHubAssistants stable: read current activeTab/currentAssistantTenantId from refs
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;
  const currentAssistantTenantIdRef = useRef(currentAssistantTenantId);
  currentAssistantTenantIdRef.current = currentAssistantTenantId;

  // Fetch installed assistants for comparison with Hub
  const fetchInstalledAssistantNames = useCallback(async () => {
    if (!isElectronDesktop()) return;
    try {
      const res = await ipcBridge.assistantHub.getInstalledAssistants.invoke();
      if (res.success && res.data) {
        const map = new Map<string, string>();
        for (const assistant of res.data) {
          const isHubInstalled = assistant.isHubInstalled || assistant.meta?.source_type === 'hub';
          const installedVersion = isHubInstalled ? normalizeAssistantVersion(assistant.meta?.installed_version) : '';
          const keys = isEnterprise ? [assistant.name] : [assistant.name, assistant.meta?.name, assistant.meta?.id, assistant.meta?.nameI18n?.[localeKey], assistant.meta?.nameI18n?.['zh-CN'], assistant.meta?.nameI18n?.['en-US']];
          keys.forEach((key) => {
            if (key) {
              map.set(key, installedVersion);
            }
            if (isEnterprise) return;
            const normalizedKey = normalizeAssistantLookupKey(key);
            if (normalizedKey) {
              map.set(normalizedKey, installedVersion);
            }
          });
        }
        setHubInstalledAssistants(map);
      }
    } catch (err) {
      console.error('Failed to fetch installed assistants:', err);
    }
  }, [isEnterprise, localeKey]);

  const fetchLatestAssistantVersions = useCallback(
    async (assistantList: IAssistantHubSkill[], existingMap?: Map<string, AssistantLatestVersion>) => {
      if (isEnterprise) {
        return existingMap || new Map<string, AssistantLatestVersion>();
      }

      const now = Date.now();
      const versionMap = existingMap ? new Map(existingMap) : new Map<string, AssistantLatestVersion>();
      let hasInlineVersionMapChange = false;
      const toFetch = assistantList.filter((assistant) => {
        const cached = versionMap.get(assistant.id);
        const failedAt = failedAssistantVersionFetchesRef.current.get(assistant.id);
        const inlineVersion = resolveAssistantVersionLike(assistant, assistant.latestVersion);
        if (fetchingAssistantVersionIdsRef.current.has(assistant.id)) return false;
        if (failedAt && now - failedAt <= VERSION_FAILURE_CACHE_TTL) return false;
        if (inlineVersion && (!cached || cached.version !== inlineVersion.version || cached.sourceUrl !== inlineVersion.sourceUrl || cached.checksum !== inlineVersion.checksum)) {
          versionMap.set(assistant.id, {
            ...inlineVersion,
            fetchedAt: now,
          });
          hasInlineVersionMapChange = true;
          return false;
        }
        if (!cached) return true;
        return now - cached.fetchedAt > VERSION_CACHE_TTL;
      });

      if (hasInlineVersionMapChange) {
        setLatestAssistantVersions(versionMap);
      }

      if (toFetch.length === 0) {
        return versionMap;
      }

      const idsToFetch = toFetch.map((assistant) => assistant.id);
      idsToFetch.forEach((id) => fetchingAssistantVersionIdsRef.current.add(id));

      try {
        const batchSize = 10;
        let hasVersionMapChange = false;
        for (let i = 0; i < toFetch.length; i += batchSize) {
          const batch = toFetch.slice(i, i + batchSize);
          const results = await Promise.all(
            batch.map(async (assistant) => {
              try {
                const res = await assistantHub.fetchAssistantDetail.invoke({ assistantId: assistant.id, silent: true });
                const detailAssistant = res.success ? res.data?.assistant || (res.data as IAssistantHubSkill | undefined) : undefined;
                const latest: IAssistantHubVersionLike | undefined = res.success ? res.data?.versions?.[0] || res.data?.latestVersion || undefined : undefined;
                const fallbackAssistant = {
                  ...assistant,
                  ...detailAssistant,
                  version: detailAssistant?.version || res.data?.version || res.data?.latest_version || assistant.version,
                  _sourceUrl: detailAssistant?._sourceUrl || res.data?.sourceUrl || res.data?.source_url || assistant._sourceUrl,
                };
                const versionInfo = resolveAssistantVersionLike(fallbackAssistant, latest);
                if (versionInfo) {
                  failedAssistantVersionFetchesRef.current.delete(assistant.id);
                  return {
                    assistantId: assistant.id,
                    versionInfo: {
                      ...versionInfo,
                      checksum: versionInfo.checksum || res.data?.checksum || '',
                    } satisfies AssistantLatestVersion,
                  };
                }
                failedAssistantVersionFetchesRef.current.set(assistant.id, Date.now());
              } catch {
                failedAssistantVersionFetchesRef.current.set(assistant.id, Date.now());
              }
              return null;
            })
          );

          for (const result of results) {
            if (result) {
              versionMap.set(result.assistantId, result.versionInfo);
              hasVersionMapChange = true;
            }
          }
        }

        if (hasVersionMapChange) {
          setLatestAssistantVersions(versionMap);
        }
        return versionMap;
      } catch {
        console.log('e');
      }
    },
    [isEnterprise]
  );

  // Fetch Hub assistants list
  const fetchHubAssistants = useCallback(
    async (cursor?: string, append = false) => {
      try {
        if (append) setHubLoadingMore(true);
        else setHubLoading(true);

        const category = selectedHubCategoryRef.current === 'all' ? '' : selectedHubCategoryRef.current;
        const query = hubSearchQueryRef.current.trim();
        // Enterprise mode: use sourceType to specify directory (hub or tenant)
        // Personal mode: use tenantId for tenant assistants
        const sourceType = isEnterprise && activeTabRef.current === 'exclusive' ? 'tenant' : undefined;
        const tenantId = isEnterprise ? undefined : currentAssistantTenantIdRef.current;

        if (isElectronDesktop()) {
          const res = await assistantHub.fetchAssistants.invoke({ cursor, limit: 40, query, category, tenantId, sourceType });
          if (res.success && res.data) {
            // Successful fetch — clear any prior typed error so the
            // empty-state UI falls back to the generic "暂无智能体"
            // case if the catalog is genuinely empty.
            setHubError(null);
            const newAssistants = res.data.assistants || [];
            if (append) {
              setHubAssistantList((prev) => {
                const existingIds = new Set(prev.map((a) => a.id));
                const unique = newAssistants.filter((a) => !existingIds.has(a.id));
                return [...prev, ...unique];
              });
            } else {
              setHubAssistantList(newAssistants);
            }

            const raw = res.data as unknown as Record<string, unknown>;
            let nextCursorValue: string | null = null;
            if (typeof res.data.next_cursor === 'string' && res.data.next_cursor.length > 0) {
              nextCursorValue = res.data.next_cursor;
            } else if (typeof raw.nextCursor === 'string' && (raw.nextCursor as string).length > 0) {
              nextCursorValue = raw.nextCursor as string;
            }

            const hasMoreValue = res.data.has_more === true || raw.hasMore === true;
            setHubNextCursor(nextCursorValue);
            setHubHasMore(hasMoreValue);
            if (!isEnterprise) {
              void fetchLatestAssistantVersions(newAssistants, append ? latestAssistantVersionsRef.current : undefined);
            }
          } else if (!res.success) {
            // Bridge returned a typed failure — surface to the empty
            // state instead of silently showing "暂无智能体". Cast
            // is safe inside this !success branch; the bridge type
            // is a discriminated union but the response interface
            // collapses success: boolean.
            setHubError(parseHubError(res as { success: false; errorCode?: string; msg?: string }));
            if (!append) setHubAssistantList([]);
          }
        }
      } catch (err) {
        console.error('Failed to fetch Hub assistants:', err);
        // Caught exception path → coerce into FETCH_FAILED so the
        // empty-state UI offers a retry CTA.
        setHubError({ code: 'FETCH_FAILED', message: err instanceof Error ? err.message : String(err), retriable: true });
        Message.error(t('settings.assistant.fetchFailed', '获取助手失败'));
      } finally {
        setHubLoading(false);
        setHubLoadingMore(false);
      }
    },
    [fetchLatestAssistantVersions, isEnterprise, t]
  );

  // Load more Hub assistants (infinite scroll)
  const loadMoreHubAssistants = useCallback(() => {
    if (!hubLoadingMore && hubHasMore && hubNextCursor) {
      void fetchHubAssistants(hubNextCursor, true);
    }
  }, [hubLoadingMore, hubHasMore, hubNextCursor, fetchHubAssistants]);

  const loadMoreRef = useRef(loadMoreHubAssistants);
  loadMoreRef.current = loadMoreHubAssistants;

  // Fetch Hub categories
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        if (isElectronDesktop()) {
          const res = await assistantHub.fetchCategories.invoke();
          if (res.success && res.data) {
            setHubCategories(res.data);
          }
        }
      } catch (err) {
        console.error('Failed to fetch assistant categories:', err);
      }
    };
    void fetchCategories();
  }, []);

  // Reload Hub assistants when category changes
  useEffect(() => {
    if (activeTab === 'installed') return;
    setHubAssistantList([]);
    setHubNextCursor(null);
    setHubHasMore(false);
    void fetchHubAssistants();
    void fetchInstalledAssistantNames();
    void loadInstalledSkills();
  }, [activeTab, selectedHubCategory, fetchHubAssistants, fetchInstalledAssistantNames, loadInstalledSkills]);

  // Debounced search reload for Hub
  useEffect(() => {
    if (!searchInitializedRef.current) {
      searchInitializedRef.current = true;
      return;
    }
    if (activeTabRef.current === 'installed') return;
    const timer = setTimeout(() => {
      setHubAssistantList([]);
      setHubNextCursor(null);
      setHubHasMore(false);
      void fetchHubAssistants();
    }, 300);
    return () => clearTimeout(timer);
  }, [hubSearchQuery, fetchHubAssistants]);

  // Trigger sync when switching to store tab in enterprise mode
  // Only trigger once per tab session, not on every syncStatus change
  useEffect(() => {
    if (!isEnterprise || activeTab !== 'store' || !isElectronDesktop()) {
      // Reset ref when leaving store tab
      syncTriggeredRef.current = false;
      return;
    }

    // Skip if already triggered for this tab session
    if (syncTriggeredRef.current) return;

    // Mark as triggered and start sync
    syncTriggeredRef.current = true;
    setSyncStatus({ syncing: true, skills: { installed: [], skipped: [], deleted: [], failed: [] }, assistants: { installed: [], skipped: [], deleted: [], failed: [] } });

    eeclaw.syncFromRemote
      .invoke()
      .then((res) => {
        if (!res.success) {
          // Sync failed, reset status (syncCompleted event won't be emitted)
          console.error('Sync failed:', res.msg);
          setSyncStatus({ syncing: false, skills: { installed: [], skipped: [], deleted: [], failed: [] }, assistants: { installed: [], skipped: [], deleted: [], failed: [] } });
        }
        // If success, syncCompleted event will be emitted and handled separately
      })
      .catch((err) => {
        console.error('Failed to trigger sync:', err);
        setSyncStatus({ syncing: false, skills: { installed: [], skipped: [], deleted: [], failed: [] }, assistants: { installed: [], skipped: [], deleted: [], failed: [] } });
      });
  }, [isEnterprise, activeTab]);

  // IntersectionObserver for infinite scroll
  const findScrollParent = useCallback((el: HTMLElement | null): HTMLElement | null => {
    let node = el?.parentElement ?? null;
    while (node) {
      const { overflowY } = window.getComputedStyle(node);
      if (overflowY === 'auto' || overflowY === 'scroll') return node;
      node = node.parentElement;
    }
    return null;
  }, []);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const root = findScrollParent(sentinel);
    if (!root) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) loadMoreRef.current();
      },
      { root, threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [findScrollParent, hubHasMore]);

  // Handle scroll for fallback infinite scroll
  const handleHubScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      const { scrollTop, scrollHeight, clientHeight } = target;
      if (scrollHeight - scrollTop - clientHeight < 100) loadMoreHubAssistants();
    },
    [loadMoreHubAssistants]
  );

  const refreshAgentDetection = useCallback(async () => {
    try {
      if (isEnterprise) {
        // Enterprise mode: refresh local assistants from hub/tenant/custom/system directories
        await mutate('assistantHub.installed');
        emitter.emit('assistants.changed');
      } else {
        await ipcBridge.acpConversation.refreshCustomAgents.invoke();
        await mutate('acp.agents.available');
        await mutate('assistantHub.installed');
        emitter.emit('assistants.changed');
      }
    } catch {
      // ignore
    }
  }, [isEnterprise]);

  const loadAssistantContext = useCallback(
    async (assistantId: string): Promise<string> => {
      try {
        const content = await ipcBridge.fs.readAssistantRule.invoke({ assistantId, locale: localeKey });
        return content || '';
      } catch (error) {
        console.error(`Failed to load rule for ${assistantId}:`, error);
        return '';
      }
    },
    [localeKey]
  );

  const sortAssistants = useCallback((agents: AssistantListItem[]) => {
    const builtinOrder = ['builtin-copilot', 'builtin-sudoclaw-doctor'];
    return agents.sort((a, b) => {
      const indexA = builtinOrder.indexOf(a.id);
      const indexB = builtinOrder.indexOf(b.id);
      if (indexA !== -1 || indexB !== -1) {
        if (indexA === -1) return 1;
        if (indexB === -1) return -1;
        return indexA - indexB;
      }
      return 0;
    });
  }, []);

  const assistantInfoToHubSkill = useCallback(
    (info: IAssistantInfo): IAssistantHubSkill => {
      const meta = info.meta || {};
      const assistantName = meta.name || info.name;
      const displayName = meta.nameI18n?.[localeKey] || meta.nameI18n?.['zh-CN'] || meta.nameI18n?.['en-US'] || meta.display_name || meta.name || info.name;
      const description = meta.descriptionI18n?.[localeKey] || meta.descriptionI18n?.['zh-CN'] || meta.descriptionI18n?.['en-US'] || '';

      return {
        id: meta.id || assistantName,
        name: assistantName,
        display_name: displayName,
        description,
        avatar: meta.avatar || null,
        emoji: meta.emoji || null,
        category: meta.category_id || (meta.categories || [])[0] || '',
        categories: meta.categories || [],
        preset_agent_type: meta.presetAgentType || null,
        skills: meta.enabledSkills || meta.defaultEnabledSkills || meta.skills || [],
        tag: meta.tag === 'system' ? 'system' : meta.tag === 'custom' ? 'custom' : 'hub',
        homepage: meta.homepage || null,
        author_id: meta.author_id || '',
        star_count: 0,
        applicable_scenarios: meta.applicable_scenarios || null,
        core_features: meta.core_features || null,
        created_at: meta.installed_at || '',
        updated_at: meta.installed_at || '',
        defaultInitPrompt: meta.defaultInitPrompt || null,
        visible_to: meta.visible_to || null,
        version: normalizeAssistantVersion(meta.installed_version),
      };
    },
    [localeKey]
  );

  const loadAssistants = useCallback(async () => {
    try {
      // Fetch raw IAssistantInfo[] and convert to AssistantListItem with _category preserved
      const result = await ipcBridge.assistantHub.getInstalledAssistants.invoke();
      const localAgents: AssistantListItem[] = (result?.data ?? []).map((info) => {
        const isPersonalHubAssistant = !isEnterprise && (info.isHubInstalled || info.meta?.source_type === 'hub');
        return {
          ...toBackendConfig(info),
          _category: info.category,
          _isHubInstalled: info.isHubInstalled,
          _hubId: isPersonalHubAssistant ? info.meta?.id : undefined,
          _installedVersion: isPersonalHubAssistant ? normalizeAssistantVersion(info.meta?.installed_version) : undefined,
          _hubMeta: isPersonalHubAssistant ? assistantInfoToHubSkill(info) : undefined,
        };
      });

      const mergedAgents = [...localAgents];
      for (const extAssistant of normalizedExtensionAssistants) {
        if (!mergedAgents.some((agent) => agent.id === extAssistant.id)) {
          mergedAgents.push(extAssistant);
        }
      }

      const allowedBuiltinIds = new Set(['builtin-copilot', 'builtin-sudoclaw-doctor']);
      const filteredAgents = mergedAgents.filter((agent) => {
        // Builtin assistants: only show explicitly allowed ones
        if (agent.isBuiltin) return allowedBuiltinIds.has(agent.id);
        // All non-builtin assistants (custom, hub, extension) pass through
        return true;
      });

      const sortedAssistants = sortAssistants(filteredAgents);
      setAssistants(sortedAssistants);
      setActiveAssistantId((prev) => {
        if (prev && sortedAssistants.some((assistant) => assistant.id === prev)) return prev;
        return sortedAssistants[0]?.id || null;
      });
    } catch (error) {
      console.error('Failed to load assistant presets:', error);
    }
  }, [assistantInfoToHubSkill, isEnterprise, normalizedExtensionAssistants, sortAssistants]);

  useEffect(() => {
    void loadAssistants();
  }, [loadAssistants]);

  // Listen for sync completed event (enterprise mode)
  useEffect(() => {
    if (!isEnterprise || !isElectronDesktop()) return;

    const handleSyncCompleted = (data: {
      skills: { hub: { installed: string[]; skipped: string[]; deleted: string[]; failed: Array<{ id: string; name: string; error: string }> }; tenant: { installed: string[]; skipped: string[]; deleted: string[]; failed: Array<{ id: string; name: string; error: string }> } };
      assistants: { hub: { installed: string[]; skipped: string[]; deleted: string[]; failed: Array<{ id: string; name: string; error: string }> }; tenant: { installed: string[]; skipped: string[]; deleted: string[]; failed: Array<{ id: string; name: string; error: string }> } };
    }) => {
      // Merge hub and tenant results for display
      const mergedSkills = {
        installed: [...data.skills.hub.installed, ...data.skills.tenant.installed],
        skipped: [...data.skills.hub.skipped, ...data.skills.tenant.skipped],
        deleted: [...data.skills.hub.deleted, ...data.skills.tenant.deleted],
        failed: [...data.skills.hub.failed, ...data.skills.tenant.failed],
      };
      const mergedAssistants = {
        installed: [...data.assistants.hub.installed, ...data.assistants.tenant.installed],
        skipped: [...data.assistants.hub.skipped, ...data.assistants.tenant.skipped],
        deleted: [...data.assistants.hub.deleted, ...data.assistants.tenant.deleted],
        failed: [...data.assistants.hub.failed, ...data.assistants.tenant.failed],
      };
      setSyncStatus({ syncing: false, skills: mergedSkills, assistants: mergedAssistants });
      // Refresh installed list after sync
      void fetchInstalledAssistantNames();
      // Refresh local assistants list (for "我的助手" tab)
      void loadAssistants();
    };

    const unsubscribe = eeclaw.syncCompleted.on(handleSyncCompleted);
    return () => unsubscribe();
  }, [isEnterprise, fetchInstalledAssistantNames, loadAssistants]);

  // Install Hub assistant (defined after loadAssistants since it depends on it)
  const resolveAssistantVersionInfo = useCallback(
    async (assistant: IAssistantHubSkill): Promise<AssistantLatestVersion | null> => {
      if (isEnterprise) {
        if (!assistant._sourceUrl) return null;
        return {
          version: '1.0.0',
          sourceUrl: assistant._sourceUrl,
          checksum: '',
          fetchedAt: Date.now(),
        };
      }

      const cached = latestAssistantVersionsRef.current.get(assistant.id);
      if (cached) return cached;

      const inlineVersion = resolveAssistantVersionLike(assistant, assistant.latestVersion);
      if (inlineVersion) return inlineVersion;

      const fetchedMap = await fetchLatestAssistantVersions([assistant], latestAssistantVersionsRef.current);
      const fetched = fetchedMap.get(assistant.id);
      if (fetched) return fetched;

      const fallbackVersion = normalizeAssistantVersion(assistant.version || (assistant._sourceUrl ? '1.0.0' : ''));
      if (assistant._sourceUrl && fallbackVersion) {
        return {
          version: fallbackVersion,
          sourceUrl: assistant._sourceUrl,
          checksum: '',
          fetchedAt: Date.now(),
        };
      }

      return null;
    },
    [fetchLatestAssistantVersions, isEnterprise]
  );

  const handleInstallHubAssistant = useCallback(
    async (assistantId: string, selectedSkillIds: string[] = []) => {
      if (!isElectronDesktop()) {
        Message.warning(t('settings.assistant.desktopOnly', '助手安装仅在桌面端可用'));
        return;
      }

      const assistant = hubAssistantList.find((a) => a.id === assistantId);
      if (!assistant) return;

      const versionInfo = await resolveAssistantVersionInfo(assistant);

      if (!versionInfo?.sourceUrl) {
        Message.error(t('settings.assistant.noDownloadUrl', '该助手暂不支持安装，请联系管理员'));
        return;
      }

      setInstallingAssistantId(assistantId);
      setInstallProgress(0);

      try {
        const res = await assistantHub.downloadAndInstallAssistant.invoke({
          assistantName: assistant.name,
          displayName: assistant.display_name || assistant.name,
          sourceUrl: versionInfo.sourceUrl,
          version: versionInfo.version,
          checksum: versionInfo.checksum,
          assistantMeta: assistant,
          selectedSkillIds,
        });

        if (res.success && res.data) {
          const installedSkillCount = res.data.installedSkills?.length || 0;
          const failedSkillCount = res.data.failedSkills?.length || 0;
          const displayName = assistant.display_name || assistant.name;

          if (failedSkillCount > 0) {
            Message.warning(
              t('settings.assistant.installPartial', {
                name: displayName,
                skillCount: installedSkillCount,
                failedCount: failedSkillCount,
                defaultValue: `${displayName} 安装成功，${installedSkillCount} 个技能安装成功，${failedSkillCount} 个技能安装失败`,
              })
            );
          } else {
            Message.success(
              t('settings.assistant.installSuccess', {
                name: displayName,
                skillCount: installedSkillCount,
                defaultValue: `成功安装 ${displayName}${installedSkillCount > 0 ? ` 及 ${installedSkillCount} 个关联技能` : ''}`,
              })
            );
          }
          await fetchInstalledAssistantNames();
          await loadAssistants();
          // Refresh agent detection so GuidPage's useGuidAgentSelection picks up the new assistant
          await refreshAgentDetection();
          // Keep modal open so user can directly click "Go Use" button
        } else {
          Message.error(t('settings.assistant.installFailed', { msg: res.msg || 'Unknown error', defaultValue: `安装失败: ${res.msg || '未知错误'}` }));
        }
      } catch (err) {
        console.error('Failed to install assistant:', err);
        Message.error(t('settings.assistant.installFailed', { msg: String(err), defaultValue: `安装失败: ${String(err)}` }));
      } finally {
        setInstallingAssistantId(null);
        setInstallProgress(0);
      }
    },
    [hubAssistantList, resolveAssistantVersionInfo, fetchInstalledAssistantNames, loadAssistants, refreshAgentDetection, t]
  );

  const handleUpdateHubAssistant = useCallback(
    async (assistantId: string, selectedSkillIds: string[] = [], assistantMeta?: IAssistantHubSkill) => {
      if (isEnterprise || !isElectronDesktop()) return;

      const assistant = assistantMeta || hubAssistantList.find((a) => a.id === assistantId) || (hubDetailAssistant?.id === assistantId ? hubDetailAssistant : undefined);
      if (!assistant) return;

      const versionInfo = await resolveAssistantVersionInfo(assistant);
      if (!versionInfo?.sourceUrl) {
        Message.error(t('settings.assistant.noDownloadUrl', '该助手暂不支持安装，请联系管理员'));
        return;
      }

      setUpdatingAssistantId(assistantId);
      setInstallProgress(0);

      try {
        const res = await assistantHub.downloadAndInstallAssistant.invoke({
          assistantName: assistant.name,
          displayName: assistant.display_name || assistant.name,
          sourceUrl: versionInfo.sourceUrl,
          version: versionInfo.version,
          checksum: versionInfo.checksum,
          assistantMeta: assistant,
          selectedSkillIds,
        });

        const displayName = assistant.display_name || assistant.name;
        if (res.success && res.data) {
          Message.success(
            t('settings.assistant.updateSuccess', {
              name: displayName,
              version: versionInfo.version,
              defaultValue: `已更新 ${displayName} 至 v${versionInfo.version}`,
            })
          );
          await fetchInstalledAssistantNames();
          await loadAssistants();
          await refreshAgentDetection();
        } else {
          Message.error(t('settings.assistant.updateFailed', { msg: res.msg || 'Unknown error', defaultValue: `更新失败: ${res.msg || '未知错误'}` }));
        }
      } catch (err) {
        console.error('Failed to update assistant:', err);
        Message.error(t('settings.assistant.updateFailed', { msg: String(err), defaultValue: `更新失败: ${String(err)}` }));
      } finally {
        setUpdatingAssistantId(null);
        setInstallProgress(0);
      }
    },
    [hubAssistantList, hubDetailAssistant, isEnterprise, resolveAssistantVersionInfo, fetchInstalledAssistantNames, loadAssistants, refreshAgentDetection, t]
  );

  // Go use installed assistant (navigate to guid page with assistant pre-selected)
  const handleGoUseHubAssistant = useCallback(async () => {
    if (!hubDetailAssistant) return;
    setHubDetailVisible(false);

    // Use display_name for URL parameter to match customAgents.name in useGuidAgentSelection
    // hubDetailAssistant.name is the identifier (UUID), display_name is the user-facing name
    const assistantName = hubDetailAssistant.display_name || hubDetailAssistant.name;
    await refreshAgentDetection();
    void navigate(`/guid?assistant=${encodeURIComponent(assistantName)}`);
  }, [hubDetailAssistant, navigate, refreshAgentDetection]);

  // Open duplicate confirm modal for hub assistant
  const handleOpenDuplicateModal = useCallback((assistant: IAssistantHubSkill) => {
    setDuplicateAssistant(assistant);
    setDuplicateInstalledAssistant(null);
    setDuplicateTenantAssistant(null);
    setDuplicateConfirmVisible(true);
  }, []);

  // Open duplicate confirm modal for installed assistant
  const handleOpenDuplicateModalFromInstalled = useCallback((assistant: AssistantListItem) => {
    setDuplicateAssistant(null);
    setDuplicateInstalledAssistant(assistant);
    setDuplicateTenantAssistant(null);
    setDuplicateConfirmVisible(true);
  }, []);

  // Open upload confirm modal for custom assistant
  const handleUploadAssistant = useCallback(
    (assistant: AssistantListItem) => {
      // Check tenantId - required for upload
      if (!enterpriseCode) {
        Message.warning(t('settings.assistant.uploadNoTenantId', '用户无租户ID，无法上传助手'));
        return;
      }
      setUploadAssistant(assistant);
      setUploadConfirmVisible(true);
    },
    [enterpriseCode, t]
  );

  // Upload assistant to Hub
  const handleUploadConfirm = useCallback(async () => {
    if (!uploadAssistant) return;
    if (!isElectronDesktop()) {
      Message.warning(t('settings.assistant.desktopOnly', '助手上传仅在桌面端可用'));
      return;
    }

    // Check tenantId again before upload
    if (!enterpriseCode) {
      Message.warning(t('settings.assistant.uploadNoTenantId', '用户无租户ID，无法上传助手'));
      setUploadConfirmVisible(false);
      setUploadAssistant(null);
      return;
    }

    setUploading(true);
    try {
      const displayName = uploadAssistant.nameI18n?.[localeKey] || uploadAssistant.name;
      const description = uploadAssistant.descriptionI18n?.[localeKey] || uploadAssistant.description;

      // Upload to Hub with tenantId
      const result = await ipcBridge.assistantHub.uploadAssistantToHub.invoke({
        name: uploadAssistant.id,
        displayName,
        profession: displayName, // Use display name as profession
        description,
        categories: uploadAssistant._category ? [uploadAssistant._category] : undefined,
        skills: uploadAssistant.enabledSkills,
        tenantId: enterpriseCode,
      });

      if (result.success) {
        Message.success(t('settings.assistant.uploadSuccess', { name: displayName, defaultValue: `助手 "${displayName}" 已上传成功` }));
        setUploadConfirmVisible(false);
        setUploadAssistant(null);
      } else {
        Message.error(t('settings.assistant.uploadFailed', { msg: result.msg || 'Unknown error', defaultValue: `上传失败: ${result.msg || 'Unknown error'}` }));
      }
    } catch (err) {
      console.error('Failed to upload assistant:', err);
      Message.error(t('settings.assistant.uploadFailed', { msg: String(err), defaultValue: `上传失败: ${String(err)}` }));
    } finally {
      setUploading(false);
    }
  }, [uploadAssistant, localeKey, enterpriseCode, t]);

  // ---- Enterprise mode: Upload custom assistant to Moss Server ----
  const handleUploadCustomAssistant = useCallback(
    async (assistant: AssistantListItem): Promise<{ success: boolean; msg?: string }> => {
      console.log('[handleUploadCustomAssistant] Starting upload for assistant:', assistant.id);
      if (!isElectronDesktop()) {
        console.log('[handleUploadCustomAssistant] Not desktop, returning');
        return { success: false, msg: 'Not desktop' };
      }

      // Use assistant name (display name) as assistantName, not UUID
      const assistantName = assistant.nameI18n?.[localeKey] || assistant.name;
      const displayName = assistantName;
      const description = assistant.descriptionI18n?.[localeKey] || assistant.description || '';
      const assistantId = assistant.id; // UUID for server reference

      try {
        console.log('[handleUploadCustomAssistant] Calling eeclaw.uploadCustomAssistant.invoke with:', { assistantName, assistantId, displayName, description });
        const res = await eeclaw.uploadCustomAssistant.invoke({
          assistantName,
          assistantId,
          displayName,
          description,
          enabledSkills: assistant.enabledSkills,
        });
        console.log('[handleUploadCustomAssistant] Upload response:', res);
        if (res.success && res.data) {
          Message.success(
            t('settings.assistant.uploadSuccess', {
              name: displayName,
              defaultValue: `助手 "${displayName}" 已上传到服务器`,
            })
          );
          // Refresh installed list
          void loadAssistants();
          return { success: true };
        } else {
          return { success: false, msg: res.msg || 'Unknown error' };
        }
      } catch (err) {
        console.error('Failed to upload custom assistant:', err);
        return { success: false, msg: String(err) };
      }
    },
    [localeKey, loadAssistants, t]
  );

  // ---- Enterprise mode: Publish assistant as tenant-exclusive ----
  const handlePublishTenantAssistant = useCallback(
    async (assistantId: string, assistantName: string) => {
      if (!isElectronDesktop()) return;

      setPublishingAssistantName(assistantName);
      try {
        const res = await eeclaw.publishTenantAssistant.invoke({ assistantId });
        if (res.success && res.data) {
          Message.success(
            t('settings.assistant.publishSuccess', {
              name: assistantName,
              defaultValue: `助手 "${assistantName}" 已提交发布申请，等待管理员审批`,
            })
          );
          void loadAssistants();
        } else {
          Message.error(
            t('settings.assistant.publishFailed', {
              msg: res.msg || 'Unknown error',
              defaultValue: `发布失败: ${res.msg || '未知错误'}`,
            })
          );
        }
      } catch (err) {
        console.error('Failed to publish tenant assistant:', err);
        Message.error(
          t('settings.assistant.publishFailed', {
            msg: String(err),
            defaultValue: `发布失败: ${String(err)}`,
          })
        );
      } finally {
        setPublishingAssistantName(null);
      }
    },
    [loadAssistants, t]
  );

  // ---- Duplicate assistant to custom list ----
  const handleDuplicateConfirm = useCallback(async () => {
    if (!duplicateAssistant && !duplicateInstalledAssistant && !duplicateTenantAssistant) return;
    if (!isElectronDesktop()) {
      Message.warning(t('settings.assistant.desktopOnly', '助手复制仅在桌面端可用'));
      return;
    }

    try {
      // Handle hub assistant duplication
      if (duplicateAssistant) {
        const baseName = duplicateAssistant.display_name || duplicateAssistant.name;
        const customName = t('settings.assistant.duplicatedName', { name: baseName, defaultValue: `自定义-${baseName}` });
        const customId = uuid(36); // Generate UUID for assistant ID

        // Read the assistant rule content if already installed
        let ruleContent: string | undefined = undefined;
        if (hubInstalledAssistants.has(duplicateAssistant.id) || hubInstalledAssistants.has(duplicateAssistant.name)) {
          try {
            const content = await ipcBridge.fs.readAssistantRule.invoke({
              assistantId: duplicateAssistant.name,
              locale: localeKey,
            });
            if (content && content.trim()) {
              ruleContent = content;
            }
          } catch {
            // No rule content available
          }
        }

        // Create new custom assistant
        await ipcBridge.assistantHub.createAssistant.invoke({
          meta: {
            id: customId,
            nameI18n: { 'zh-CN': customName },
            descriptionI18n: duplicateAssistant.description ? { 'zh-CN': duplicateAssistant.description } : undefined,
            avatar: duplicateAssistant.avatar || duplicateAssistant.emoji,
            presetAgentType: DEFAULT_PRESET_AGENT_TYPE,
            enabled: true,
            source_type: 'custom',
            enabledSkills: duplicateAssistant.skills || [],
            defaultInitPrompt: duplicateAssistant.defaultInitPrompt,
          },
          ruleContent: ruleContent,
        });

        // Enterprise mode: upload to Moss Server
        if (isEnterprise) {
          const result = await ipcBridge.assistantHub.getInstalledAssistants.invoke();
          if (result.success && result.data) {
            const newAssistantInfo = result.data.find((a) => a.meta?.id === customId || a.name === customId);
            if (newAssistantInfo) {
              const newAssistant: AssistantListItem = {
                ...toBackendConfig(newAssistantInfo),
                _category: newAssistantInfo.category,
                _isHubInstalled: newAssistantInfo.isHubInstalled,
              };
              await handleUploadCustomAssistant(newAssistant);
            }
          }
        }

        Message.success(t('settings.assistant.duplicateSuccess', { name: customName, defaultValue: `已复制到自定义列表: ${customName}` }));
      }

      // Handle installed assistant duplication
      if (duplicateInstalledAssistant) {
        const baseName = duplicateInstalledAssistant.nameI18n?.[localeKey] || duplicateInstalledAssistant.name;
        const customName = t('settings.assistant.duplicatedName', { name: baseName, defaultValue: `自定义-${baseName}` });
        const customId = uuid(36); // Generate UUID for assistant ID

        // Read the assistant rule content
        let ruleContent: string | undefined = undefined;
        try {
          const content = await ipcBridge.fs.readAssistantRule.invoke({
            assistantId: duplicateInstalledAssistant.id,
            locale: localeKey,
          });
          if (content && content.trim()) {
            ruleContent = content;
          }
        } catch {
          // No rule content available
        }

        // Create new custom assistant
        await ipcBridge.assistantHub.createAssistant.invoke({
          meta: {
            id: customId,
            nameI18n: { 'zh-CN': customName },
            descriptionI18n: duplicateInstalledAssistant.descriptionI18n || (duplicateInstalledAssistant.description ? { 'zh-CN': duplicateInstalledAssistant.description } : undefined),
            avatar: duplicateInstalledAssistant.avatar,
            presetAgentType: DEFAULT_PRESET_AGENT_TYPE,
            enabled: true,
            source_type: 'custom',
            enabledSkills: duplicateInstalledAssistant.enabledSkills || [],
            defaultInitPrompt: duplicateInstalledAssistant.defaultInitPrompt,
          },
          ruleContent: ruleContent,
        });

        // Enterprise mode: upload to Moss Server
        if (isEnterprise) {
          const result = await ipcBridge.assistantHub.getInstalledAssistants.invoke();
          if (result.success && result.data) {
            const newAssistantInfo = result.data.find((a) => a.meta?.id === customId || a.name === customId);
            if (newAssistantInfo) {
              const newAssistant: AssistantListItem = {
                ...toBackendConfig(newAssistantInfo),
                _category: newAssistantInfo.category,
                _isHubInstalled: newAssistantInfo.isHubInstalled,
              };
              await handleUploadCustomAssistant(newAssistant);
            }
          }
        }

        Message.success(t('settings.assistant.duplicateSuccess', { name: customName, defaultValue: `已复制到自定义列表: ${customName}` }));
      }

      // Handle tenant assistant duplication (enterprise mode)
      if (duplicateTenantAssistant) {
        const baseName = duplicateTenantAssistant.displayName || duplicateTenantAssistant.name;
        const customName = t('settings.assistant.duplicatedName', { name: baseName, defaultValue: `自定义-${baseName}` });
        const customId = uuid(36); // Generate UUID for assistant ID

        // Read the assistant rule content (tenant assistants are synced to local tenant/ directory)
        let ruleContent: string | undefined = undefined;
        try {
          const content = await ipcBridge.fs.readAssistantRule.invoke({
            assistantId: duplicateTenantAssistant.name,
            locale: localeKey,
          });
          if (content && content.trim()) {
            ruleContent = content;
          }
        } catch {
          // No rule content available
        }

        // Create new custom assistant
        await ipcBridge.assistantHub.createAssistant.invoke({
          meta: {
            id: customId,
            nameI18n: { 'zh-CN': customName },
            descriptionI18n: duplicateTenantAssistant.description ? { 'zh-CN': duplicateTenantAssistant.description } : undefined,
            presetAgentType: DEFAULT_PRESET_AGENT_TYPE,
            enabled: true,
            source_type: 'custom',
            enabledSkills: duplicateTenantAssistant.enabledSkills || [],
          },
          ruleContent: ruleContent,
        });

        // Enterprise mode: upload to Moss Server
        if (isEnterprise) {
          const result = await ipcBridge.assistantHub.getInstalledAssistants.invoke();
          if (result.success && result.data) {
            const newAssistantInfo = result.data.find((a) => a.meta?.id === customId || a.name === customId);
            if (newAssistantInfo) {
              const newAssistant: AssistantListItem = {
                ...toBackendConfig(newAssistantInfo),
                _category: newAssistantInfo.category,
                _isHubInstalled: newAssistantInfo.isHubInstalled,
              };
              await handleUploadCustomAssistant(newAssistant);
            }
          }
        }

        Message.success(t('settings.assistant.duplicateSuccess', { name: customName, defaultValue: `已复制到自定义列表: ${customName}` }));
      }

      await loadAssistants();
      setDuplicateConfirmVisible(false);
      setDuplicateAssistant(null);
      setDuplicateInstalledAssistant(null);
      setDuplicateTenantAssistant(null);
    } catch (err) {
      console.error('Failed to duplicate assistant:', err);
      Message.error(t('settings.assistant.duplicateFailed', '复制失败'));
    }
  }, [duplicateAssistant, duplicateInstalledAssistant, duplicateTenantAssistant, hubInstalledAssistants, localeKey, loadAssistants, t, isEnterprise, handleUploadCustomAssistant]);

  const activeAssistant = assistants.find((assistant) => assistant.id === activeAssistantId) || null;
  // Only custom assistants can be edited; hub/tenant-installed, builtin, and extension assistants are readonly
  const isReadonlyAssistant = Boolean(activeAssistant && (isExtensionAssistant(activeAssistant) || activeAssistant._isHubInstalled || activeAssistant.isBuiltin || (isEnterprise && (activeAssistant._category === 'hub' || activeAssistant._category === 'tenant'))));

  // ===== 分类逻辑：以目录分类（_category）为主，其他字段仅作兼容兜底 =====
  // Tenant assistants: 目录分类为 tenant
  const localTenantAssistants = useMemo(() => assistants.filter((a) => a._category === 'tenant'), [assistants]);
  // Filter tenant assistants by search query
  const filteredTenantAssistants = useMemo(() => {
    const query = hubSearchQuery.trim().toLowerCase();
    if (!query) return localTenantAssistants;
    return localTenantAssistants.filter((a) => {
      const displayName = a.nameI18n?.[localeKey] || a.name;
      const description = a.descriptionI18n?.[localeKey] || a.description || '';
      return displayName.toLowerCase().includes(query) || description.toLowerCase().includes(query);
    });
  }, [hubSearchQuery, localTenantAssistants, localeKey]);
  // Hub assistants: 目录分类为 hub（_isHubInstalled 仅作兼容兜底）
  const hubAssistants = useMemo(() => assistants.filter((a) => a._category === 'hub' || (!a._category && !a.isBuiltin && a._isHubInstalled)), [assistants]);
  // Custom assistants: 目录分类为 custom（其他字段仅作兼容兜底）
  const customAssistants = useMemo(() => assistants.filter((a) => a._category === 'custom' || (!a._category && !a.isBuiltin && !a._isHubInstalled && !isExtensionAssistant(a))), [assistants, isExtensionAssistant]);

  const getAssistantLookupKeys = useCallback((assistant: Pick<IAssistantHubSkill, 'id' | 'name'> & Partial<Pick<IAssistantHubSkill, 'display_name'>>) => [assistant.id, assistant.name, assistant.display_name].map(normalizeAssistantLookupKey).filter((key): key is string => Boolean(key)), []);

  const isHubAssistantInstalled = useCallback((assistant: Pick<IAssistantHubSkill, 'id' | 'name'> & Partial<Pick<IAssistantHubSkill, 'display_name'>>) => getAssistantLookupKeys(assistant).some((key) => hubInstalledAssistants.has(key)), [getAssistantLookupKeys, hubInstalledAssistants]);

  const getHubAssistantInstalledVersion = useCallback(
    (assistant: Pick<IAssistantHubSkill, 'id' | 'name'> & Partial<Pick<IAssistantHubSkill, 'display_name'>>) => {
      for (const key of getAssistantLookupKeys(assistant)) {
        const version = hubInstalledAssistants.get(key);
        if (version) return normalizeAssistantVersion(version);
      }
      return '';
    },
    [getAssistantLookupKeys, hubInstalledAssistants]
  );

  const installedAssistantToHubAssistant = useCallback(
    (assistant: AssistantListItem): IAssistantHubSkill => ({
      ...(assistant._hubMeta || {}),
      id: assistant._hubId || assistant.id,
      name: assistant._hubMeta?.name || resolveAssistantName(assistant.id),
      display_name: assistant._hubMeta?.display_name || assistant.nameI18n?.[localeKey] || assistant.name,
      description: assistant._hubMeta?.description || assistant.descriptionI18n?.[localeKey] || assistant.description || '',
      avatar: assistant._hubMeta?.avatar || assistant.avatar || null,
      emoji: assistant._hubMeta?.emoji || null,
      category: assistant._hubMeta?.category || assistant._category || '',
      categories: assistant._hubMeta?.categories || (assistant._category ? [assistant._category] : []),
      preset_agent_type: assistant._hubMeta?.preset_agent_type || assistant.presetAgentType || null,
      skills: assistant._hubMeta?.skills || assistant.enabledSkills || [],
      tag: assistant._hubMeta?.tag || 'hub',
      homepage: assistant._hubMeta?.homepage || null,
      author_id: assistant._hubMeta?.author_id || '',
      star_count: assistant._hubMeta?.star_count || 0,
      applicable_scenarios: assistant._hubMeta?.applicable_scenarios || null,
      core_features: assistant._hubMeta?.core_features || null,
      created_at: assistant._hubMeta?.created_at || '',
      updated_at: assistant._hubMeta?.updated_at || '',
      version: assistant._installedVersion,
    }),
    [localeKey]
  );

  const installedHubVersionTargets = useMemo(() => {
    if (isEnterprise) return [];

    const assistantById = new Map(hubAssistantList.map((assistant) => [assistant.id, assistant]));
    const targets = new Map<string, IAssistantHubSkill>();

    for (const assistant of hubAssistantList) {
      if (isHubAssistantInstalled(assistant)) {
        targets.set(assistant.id, assistant);
      }
    }

    for (const assistant of hubAssistants) {
      const hubId = assistant._hubId;
      if (!hubId || targets.has(hubId)) continue;
      targets.set(hubId, assistantById.get(hubId) || installedAssistantToHubAssistant(assistant));
    }

    return [...targets.values()];
  }, [hubAssistantList, hubAssistants, installedAssistantToHubAssistant, isHubAssistantInstalled, isEnterprise]);

  useEffect(() => {
    if (isEnterprise || installedHubVersionTargets.length === 0) return;
    void fetchLatestAssistantVersions(installedHubVersionTargets, latestAssistantVersionsRef.current);
  }, [fetchLatestAssistantVersions, installedHubVersionTargets, isEnterprise]);

  // Avatar helpers
  const isEmoji = useCallback((str: string) => {
    if (!str) return false;
    const emojiRegex = /^(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*$/u;
    return emojiRegex.test(str);
  }, []);

  const resolveAvatarImageSrc = useCallback(
    (avatar: string | undefined): string | undefined => {
      const value = avatar?.trim();
      if (!value) return undefined;
      const mapped = avatarImageMap[value];
      if (mapped) return mapped;
      const resolved = resolveExtensionAssetUrl(value) || value;
      const isImage = /\.(svg|png|jpe?g|webp|gif)$/i.test(resolved) || /^(https?:|aion-asset:\/\/|file:\/\/|data:)/i.test(resolved);
      return isImage ? resolved : undefined;
    },
    [avatarImageMap]
  );

  // ==================== CRUD Handlers ====================

  const handleEdit = async (assistant: AssistantListItem) => {
    setIsCreating(false);
    setActiveAssistantId(assistant.id);
    setEditName(assistant.nameI18n?.[localeKey] || assistant.name || '');
    setEditDescription(assistant.descriptionI18n?.[localeKey] || assistant.description || '');
    setEditAvatar(assistant.avatar || '');
    setEditAgent(normalizePresetAgentType(assistant.presetAgentType) || DEFAULT_PRESET_AGENT_TYPE);
    setEditVisible(true);

    if (isExtensionAssistant(assistant)) {
      setPromptViewMode('preview');
      setEditContext(assistant.context || '');
      setInstalledSkills([]);
      setSelectedSkills(Array.isArray(assistant.enabledSkills) ? assistant.enabledSkills : []);
      return;
    }

    try {
      const context = await loadAssistantContext(assistant.id);
      setEditContext(context);
      const availableSkills = await loadInstalledSkills();
      setSelectedSkills(sanitizeAssistantEnabledSkills(assistant.enabledSkills, availableSkills));
    } catch (error) {
      console.error('Failed to load assistant content:', error);
      setEditContext('');
      setInstalledSkills([]);
      setSelectedSkills([]);
    }
  };

  const handleCreate = async () => {
    setIsCreating(true);
    setActiveAssistantId(null);
    setEditName('');
    setEditDescription('');
    setEditContext('');
    setEditAvatar('🤖');
    setEditAgent(DEFAULT_PRESET_AGENT_TYPE);
    setSelectedSkills([]);
    setPromptViewMode('edit');
    setEditVisible(true);
    await loadInstalledSkills();
  };

  const handleSave = async () => {
    try {
      // Block saving for readonly assistants (hub, builtin, extension)
      if (!isCreating && isReadonlyAssistant) {
        Message.warning(t('settings.assistantReadonly', 'Hub 安装的助手和内置助手不可修改，可复制到自定义列表后编辑'));
        return;
      }

      if (isCreating) {
        if (!editName.trim()) {
          Message.error(t('settings.assistantNameRequired', 'Assistant name is required'));
          return;
        }
        const newId = uuid(36); // Generate UUID for assistant ID
        await ipcBridge.assistantHub.createAssistant.invoke({
          meta: {
            id: newId,
            nameI18n: { 'zh-CN': editName },
            descriptionI18n: editDescription ? { 'zh-CN': editDescription } : undefined,
            avatar: editAvatar,
            presetAgentType: normalizePresetAgentType(editAgent) || DEFAULT_PRESET_AGENT_TYPE,
            enabled: true,
            source_type: 'custom',
            enabledSkills: sanitizeAssistantEnabledSkills(selectedSkills, installedSkills),
          },
          ruleContent: editContext.trim() || undefined,
        });
        setActiveAssistantId(newId);
        await loadAssistants();

        // Enterprise mode: sync upload to Moss Server after create
        console.log('[AgentModalContent] isEnterprise:', isEnterprise);
        if (isEnterprise) {
          console.log('[AgentModalContent] Enterprise mode: starting sync upload to Moss Server');
          const result = await ipcBridge.assistantHub.getInstalledAssistants.invoke();
          if (result.success && result.data) {
            const newAssistantInfo = result.data.find((a) => a.meta?.id === newId || a.name === newId);
            console.log('[AgentModalContent] newAssistantInfo:', newAssistantInfo);
            if (newAssistantInfo) {
              const newAssistant: AssistantListItem = {
                ...toBackendConfig(newAssistantInfo),
                _category: newAssistantInfo.category,
                _isHubInstalled: newAssistantInfo.isHubInstalled,
              };
              console.log('[AgentModalContent] Calling handleUploadCustomAssistant');
              const uploadRes = await handleUploadCustomAssistant(newAssistant);
              console.log('[AgentModalContent] uploadRes:', uploadRes);
              if (uploadRes.success) {
                Message.success(t('common.createSuccess', 'Created successfully'));
              } else {
                Message.error(t('settings.assistant.uploadFailed', { msg: uploadRes.msg, defaultValue: `上传失败: ${uploadRes.msg}` }));
              }
            } else {
              Message.success(t('common.createSuccess', 'Created successfully'));
            }
          } else {
            Message.success(t('common.createSuccess', 'Created successfully'));
          }
        } else {
          Message.success(t('common.createSuccess', 'Created successfully'));
        }
      } else {
        if (!activeAssistant) return;
        const lookupName = resolveAssistantName(activeAssistant.id);

        // For custom assistants, save all fields (presetAgentType stays locked to Sudo Code)
        await ipcBridge.assistantHub.updateAssistantMeta.invoke({
          name: lookupName,
          updates: {
            nameI18n: { 'zh-CN': editName },
            descriptionI18n: editDescription ? { 'zh-CN': editDescription } : undefined,
            avatar: editAvatar,
            presetAgentType: normalizePresetAgentType(editAgent) || DEFAULT_PRESET_AGENT_TYPE,
            enabledSkills: sanitizeAssistantEnabledSkills(selectedSkills, installedSkills),
          },
        });

        if (editContext.trim()) {
          await ipcBridge.fs.writeAssistantRule.invoke({
            assistantId: activeAssistant.id,
            locale: localeKey,
            content: editContext,
          });
        }

        await loadAssistants();
        Message.success(t('common.saveSuccess', 'Saved successfully'));
      }

      setEditVisible(false);
      await refreshAgentDetection();
    } catch (error) {
      console.error('Failed to save assistant:', error);
      Message.error(t('common.failed', 'Failed'));
    }
  };

  const handleDeleteFromCard = async (assistant: AssistantListItem) => {
    try {
      const lookupName = resolveAssistantName(assistant.id);
      // Pass category for precise assistant location
      const assistantCategory = assistant._category as 'custom' | 'hub' | 'system' | 'tenant' | undefined;
      await ipcBridge.assistantHub.uninstallAssistant.invoke({ name: lookupName, category: assistantCategory });
      await loadAssistants();
      Message.success(t('common.success', 'Success'));
      await refreshAgentDetection();
    } catch (error) {
      console.error('Failed to delete assistant:', error);
      Message.error(t('common.failed', 'Failed'));
    }
  };

  const handleToggleEnabled = async (assistant: AssistantListItem, enabled: boolean) => {
    if (isExtensionAssistant(assistant)) {
      Message.warning(t('settings.extensionAssistantReadonly', 'Extension assistants are read-only. You can duplicate it and edit the copy.'));
      return;
    }
    try {
      const lookupName = resolveAssistantName(assistant.id);
      // Pass category for precise assistant location
      const assistantCategory = assistant._category as 'custom' | 'hub' | 'system' | 'tenant' | undefined;
      let result: Awaited<ReturnType<typeof ipcBridge.assistantHub.enableAssistant.invoke>>;
      if (enabled) {
        result = await ipcBridge.assistantHub.enableAssistant.invoke({ name: lookupName, category: assistantCategory });
      } else {
        result = await ipcBridge.assistantHub.disableAssistant.invoke({ name: lookupName, category: assistantCategory });
      }
      if (isEnterprise && !result.success) throw new Error(result.msg || 'Failed to toggle assistant');
      await loadAssistants();
      await refreshAgentDetection();
    } catch (error) {
      console.error('Failed to toggle assistant:', error);
      Message.error(t('common.failed', 'Failed'));
    }
  };

  // ==================== Render helpers ====================

  const editAvatarImage = resolveAvatarImageSrc(editAvatar);

  const canUploadAssistant = (assistant: AssistantListItem) => {
    if (!isEnterprise) {
      return !assistant.isBuiltin && !assistant._isHubInstalled && !isExtensionAssistant(assistant);
    }
    return assistant._category === 'custom' || (!assistant._category && !assistant.isBuiltin && !assistant._isHubInstalled && !isExtensionAssistant(assistant));
  };

  const renderAssistantGrid = (list: AssistantListItem[], hideDelete = false, allowToggle = false, allowDelete = false) => (
    <div className='grid gap-4' style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
      {list.map((assistant) => {
        const hubId = !isEnterprise ? assistant._hubId : undefined;
        const latestVersion = hubId ? latestAssistantVersions.get(hubId) : undefined;
        const installedVersion = !isEnterprise ? normalizeAssistantVersion(assistant._installedVersion) : '';
        const hasUpdate = Boolean(!isEnterprise && assistant._isHubInstalled && hubId && latestVersion && (!installedVersion || latestVersion.version !== installedVersion));

        return (
          <InstalledAssistantCard
            key={assistant.id}
            assistant={assistant}
            isExtension={isExtensionAssistant(assistant)}
            localeKey={localeKey}
            avatarImageMap={avatarImageMap}
            onToggleEnabled={(enabled) => void handleToggleEnabled(assistant, enabled)}
            onDelete={() => void handleDeleteFromCard(assistant)}
            onDuplicate={() => handleOpenDuplicateModalFromInstalled(assistant)}
            onUpdate={!isEnterprise && hubId ? () => void handleUpdateHubAssistant(hubId, assistant.enabledSkills || [], installedAssistantToHubAssistant(assistant)) : undefined}
            hasUpdate={!isEnterprise && hasUpdate}
            updating={!isEnterprise && hubId ? updatingAssistantId === hubId : false}
            onUpload={canUploadAssistant(assistant) ? () => handleUploadAssistant(assistant) : undefined}
            onClick={() => void handleEdit(assistant)}
            hideDelete={hideDelete}
            allowToggle={allowToggle}
            allowDelete={allowDelete}
            enterpriseMode={isEnterprise}
          />
        );
      })}
    </div>
  );

  // Render custom assistants with enterprise action buttons (publish only, auto-upload on create)
  const renderCustomAssistantGridWithEnterpriseActions = (list: AssistantListItem[]) => (
    <div className='grid gap-4' style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
      {list.map((assistant) => {
        const assistantId = assistant.id;
        const isPublishing = publishingAssistantName === assistantId;
        const publishStatus = (assistant as any).publish_status;

        // Enterprise publish button element - placed below delete button
        const enterprisePublishButton =
          isEnterprise && !publishStatus ? (
            <Tooltip content={t('settings.assistant.publishAsTenant', '发布为专属助手')}>
              <button
                className='store-action-icon'
                onClick={(e) => {
                  e.stopPropagation();
                  void handlePublishTenantAssistant(assistantId, assistant.name);
                }}
                disabled={isPublishing}
              >
                {isPublishing ? <Spin size={12} /> : <Share2 size={12} />}
              </button>
            </Tooltip>
          ) : isEnterprise && publishStatus === 'pending' ? (
            <Tooltip content={t('settings.assistant.publishPending', '发布审批中')}>
              <span className='store-action-badge'>{t('settings.assistant.publishPendingShort', '审核中')}</span>
            </Tooltip>
          ) : isEnterprise && publishStatus === 'approved' ? (
            <Tooltip content={t('settings.assistant.publishApproved', '已发布为专属助手')}>
              <span className='store-action-badge text-success'>{t('settings.assistant.publishedShort', '已发布')}</span>
            </Tooltip>
          ) : undefined;

        return (
          <InstalledAssistantCard
            key={assistantId}
            assistant={assistant}
            isExtension={isExtensionAssistant(assistant)}
            localeKey={localeKey}
            avatarImageMap={avatarImageMap}
            onToggleEnabled={(enabled) => void handleToggleEnabled(assistant, enabled)}
            onDelete={() => void handleDeleteFromCard(assistant)}
            onDuplicate={() => handleOpenDuplicateModalFromInstalled(assistant)}
            hasUpdate={false}
            onClick={() => void handleEdit(assistant)}
            enterprisePublishButton={enterprisePublishButton}
          />
        );
      })}
    </div>
  );

  // ==================== Main render ====================

  return (
    <PageWrapper>
      <div className='flex flex-col h-full w-full'>
        {/* Header: tabs + search + create button */}
        <div className='flex items-center gap-6 mb-3'>
          {/* Tab switcher */}
          <Tabs
            variant='line'
            className='flex-shrink-0'
            value={activeTab}
            onChange={(value) => setActiveTab(value as AssistantStoreTab)}
            items={[
              { value: 'store', label: t('settings.assistant.storeTab', '智能体库') },
              { value: 'exclusive', label: t('settings.assistant.exclusiveTab', '专属智能体') },
              {
                value: 'installed',
                label: (
                  <>
                    {t('settings.assistant.installedTab', '我的智能体')}
                    {assistants.length > 0 && <span className='f-center min-w-4 h-4 ml-5px px-1 rd-full bg-primary text-white text-10px leading-4 font-medium'>{assistants.length}</span>}
                  </>
                ),
              },
            ]}
          />

          {/* Sync status indicator for enterprise mode - compact inline style */}
          {isEnterprise && activeTab === 'store' && syncStatus.syncing && (
            <div className='flex items-center gap-1.5 px-2.5 py-1 bg-primary-light-1 rd-6px flex-shrink-0'>
              <Spin size={12} />
              <span className='text-11px text-primary'>{t('settings.assistant.syncing', '同步中...')}</span>
            </div>
          )}
          {isEnterprise && activeTab === 'store' && !syncStatus.syncing && (syncStatus.assistants.installed.length > 0 || syncStatus.assistants.skipped.length > 0 || syncStatus.assistants.failed.length > 0) && (
            <div className='flex items-center gap-1.5 px-2.5 py-1 bg-success-soft rd-6px flex-shrink-0'>
              <Check size={12} className='text-success' />
              <span className='text-11px text-success'>{t('settings.assistant.syncCompleted', '已同步')}</span>
            </div>
          )}

          {/* Search - for store/exclusive tabs */}
          <Input
            placeholder={t('settings.assistant.searchPlaceholder', '搜索...')}
            value={hubSearchQuery}
            onChange={setHubSearchQuery}
            prefix={<Search size={14} className='text-tertiary' />}
            size='small'
            className={classNames('flex-1 min-w-0 assistant-hub-input', activeTab === 'installed' && 'invisible')}
          />

          {/* Create button — only on installed tab */}
          {activeTab === 'installed' && (
            <button
              type='button'
              className='group h-8.5 px-4 py-0 border border-solid rd-full flex items-center gap-2 flex-shrink-0 cursor-pointer transition-all outline-none bg-[color-mix(in_srgb,var(--color-fill-2)_84%,transparent)] border-[color-mix(in_srgb,var(--color-border-2)_70%,transparent)] hover:bg-[color-mix(in_srgb,var(--color-primary-light-1)_58%,transparent)] hover:border-[color-mix(in_srgb,var(--color-primary)_36%,transparent)]'
              onClick={() => void handleCreate()}
            >
              <span className='size-5.5 rd-full f-center bg-[color-mix(in_srgb,var(--color-primary)_14%,transparent)] text-[var(--color-primary)] transition-transform group-hover:scale-105'>
                <Plus size={13} />
              </span>
              <span className='flex items-baseline gap-5px leading-none'>
                <span className='text-12px font-medium text-foreground'>{t('settings.createAssistant', '创建')}</span>
                <span className='text-11px text-secondary'>{t('settings.customAssistants', '自定义智能体')}</span>
              </span>
            </button>
          )}
        </div>

        {/* ===== STORE TAB ===== */}
        {(activeTab === 'store' || activeTab === 'exclusive') && (
          <>
            {/* Category filter */}
            <div className='flex gap-1.5 mb-3.5 overflow-x-auto pb-0.5 flex-shrink-0 scrollbar-hide'>
              {[{ key: 'all', label: t('settings.assistant.allCategories', '全部分类') }, ...hubCategories.map((c) => ({ key: c, label: c }))].map(({ key, label }) => (
                <span key={key} className={classNames('category-chip', selectedHubCategory === key ? 'category-chip-active' : 'category-chip-idle')} onClick={() => setSelectedHubCategory(key)}>
                  {label}
                </span>
              ))}
            </div>

            {/* Assistant grid */}
            <AionScrollArea className='flex-1 min-h-0' disableOverflow onScroll={handleHubScroll}>
              {/* Enterprise mode: show tenant assistants from local tenant/ directory */}
              {activeTab === 'exclusive' && isEnterprise ? (
                hubLoading ? (
                  <div className='flex justify-center items-center py-12'>
                    <Spin size={28} />
                  </div>
                ) : hubAssistantList.length === 0 ? (
                  <div className='flex flex-col items-center justify-center py-12 text-secondary gap-2'>
                    <Shield size={32} className='text-tertiary' />
                    <span className='text-13px'>{t('settings.assistant.noTenantAssistants', '暂无专属智能体')}</span>
                  </div>
                ) : (
                  <div className='grid gap-4 pb-4' style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                    {hubAssistantList.map((assistant) => {
                      return (
                        <HubAssistantCard
                          key={assistant.id}
                          assistant={assistant}
                          isInstalled={true}
                          installing={false}
                          installProgress={installProgress}
                          onInstall={(e) => {
                            e.stopPropagation();
                            setHubDetailAssistant(assistant);
                            setHubDetailVisible(true);
                          }}
                          onDuplicate={(e) => {
                            e.stopPropagation();
                            handleOpenDuplicateModal(assistant);
                          }}
                          onClick={() => {
                            setHubDetailAssistant(assistant);
                            setHubDetailVisible(true);
                          }}
                        />
                      );
                    })}
                  </div>
                )
              ) : activeTab === 'exclusive' && !enterpriseCode ? (
                <div className='flex flex-col items-center justify-center py-12 text-secondary gap-2'>
                  <Shield size={32} className='text-tertiary' />
                  <span className='text-13px'>{t('settings.assistant.noEnterpriseCode', '当前账号没有企业编码，无法加载专属智能体。')}</span>
                </div>
              ) : hubLoading || !hubInstalledSkillsReady ? (
                <div className='flex justify-center items-center py-12'>
                  <Spin size={28} />
                </div>
              ) : hubAssistantList.length === 0 ? (
                <div className='flex flex-col items-center justify-center py-12 text-secondary gap-2'>
                  <Bot size={32} className='text-tertiary' />
                  <span className='text-13px'>{t('settings.assistant.noResults', '暂无智能体')}</span>
                </div>
              ) : (
                <div className='grid gap-4 pb-4' style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                  {hubAssistantList.map((assistant) => {
                    const isInstalled = isEnterprise ? hubInstalledAssistants.has(assistant.name) : isHubAssistantInstalled(assistant);
                    const isInstalling = installingAssistantId === assistant.id;
                    const isUpdating = !isEnterprise && updatingAssistantId === assistant.id;
                    const latestVersion = !isEnterprise ? latestAssistantVersions.get(assistant.id) : undefined;
                    const installedVersion = !isEnterprise ? getHubAssistantInstalledVersion(assistant) : '';
                    const hasUpdate = !isEnterprise && isInstalled && !!latestVersion && (!installedVersion || latestVersion.version !== installedVersion);
                    return (
                      <HubAssistantCard
                        key={assistant.id}
                        assistant={assistant}
                        isInstalled={isInstalled}
                        installing={isInstalling}
                        installProgress={installProgress}
                        onInstall={(e) => {
                          e.stopPropagation();
                          // Open detail modal for install options
                          setHubDetailAssistant(assistant);
                          setHubDetailVisible(true);
                        }}
                        onUpdate={
                          !isEnterprise
                            ? (e) => {
                                e.stopPropagation();
                                void handleUpdateHubAssistant(assistant.id, assistant.skills || []);
                              }
                            : undefined
                        }
                        hasUpdate={!isEnterprise && hasUpdate}
                        updating={isUpdating}
                        onDuplicate={(e) => {
                          e.stopPropagation();
                          handleOpenDuplicateModal(assistant);
                        }}
                        latestVersion={!isEnterprise ? latestVersion?.version || normalizeAssistantVersion(assistant.version) : undefined}
                        onClick={() => {
                          setHubDetailAssistant(assistant);
                          setHubDetailVisible(true);
                        }}
                      />
                    );
                  })}
                </div>
              )}

              {/* Loading skeleton cards */}
              {hubLoadingMore && (
                <div className='grid gap-4 pb-4' style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={`skel-${i}`} className='bg-fill-1 rd-12px border p-3 flex items-start gap-3 animate-pulse'>
                      <div className='size-12 flex-shrink-0 rd-8px bg-fill-3' />
                      <div className='flex-1 min-w-0 flex flex-col gap-1.5 pt-0.5'>
                        <div className='h-14px w-3/5 rd-4px bg-fill-3' />
                        <div className='h-10px w-full rd-4px bg-fill-3' />
                        <div className='h-10px w-4/5 rd-4px bg-fill-3' />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Sentinel for IntersectionObserver */}
              {hubHasMore && <div ref={sentinelRef} style={{ height: 1, flexShrink: 0 }} />}
            </AionScrollArea>
          </>
        )}

        {/* ===== INSTALLED TAB ===== */}
        {activeTab === 'installed' && (
          <AionScrollArea className='flex-1 min-h-0' disableOverflow>
            {assistants.length === 0 ? (
              <div className='flex flex-col items-center justify-center py-12 gap-2'>
                <Bot size={32} className='text-tertiary' />
                <div className='text-13px text-secondary'>{t('settings.assistantsEmpty', '暂无智能体')}</div>
                <div className='text-12px text-tertiary'>{t('settings.assistantsEmptyHint', '点击下方"创建智能体"按钮添加你的智能体')}</div>
                <Button size='small' type='outline' className='mt-1' onClick={() => handleCreate()}>
                  {t('settings.createAssistant', '创建智能体')}
                </Button>
              </div>
            ) : (
              <div className='pb-4 space-y-5'>
                {/* Custom assistants section */}
                <section>
                  <div className='flex items-center justify-between gap-2 mb-2.5'>
                    <div className='text-13px font-medium text-foreground'>{t('settings.customAssistants', '自定义智能体')}</div>
                    <span className='px-1.5 py-0 bg-fill-2 text-secondary text-11px rd-full leading-18px'>{customAssistants.length}</span>
                  </div>
                  {customAssistants.length > 0 ? (
                    isEnterprise ? (
                      renderCustomAssistantGridWithEnterpriseActions(customAssistants)
                    ) : (
                      renderAssistantGrid(customAssistants)
                    )
                  ) : (
                    <div className='bg-fill-1 border border-dashed rd-12px px-3.5 py-4.5 text-12px text-tertiary'>{t('settings.noCustomAssistants', '暂无自定义智能体')}</div>
                  )}
                </section>

                {/* Tenant assistants section - enterprise mode only */}
                {isEnterprise && (
                  <section>
                    <div className='flex items-center justify-between gap-2 mb-2.5'>
                      <div className='text-13px font-medium text-foreground'>{t('settings.tenantAssistants', '专属智能体')}</div>
                      <span className='px-1.5 py-0 bg-fill-2 text-secondary text-11px rd-full leading-18px'>{filteredTenantAssistants.length}</span>
                    </div>
                    {filteredTenantAssistants.length > 0 ? renderAssistantGrid(filteredTenantAssistants, true, true) : <div className='bg-fill-1 border border-dashed rd-12px px-3.5 py-4.5 text-12px text-tertiary'>{t('settings.noTenantAssistants', '暂无专属智能体')}</div>}
                  </section>
                )}

                {/* Hub/store assistants section */}
                <section>
                  <div className='flex items-center justify-between gap-2 mb-2.5'>
                    <div className='text-13px font-medium text-foreground'>{t('settings.hubAssistants', '智能体库')}</div>
                    <span className='px-1.5 py-0 bg-fill-2 text-secondary text-11px rd-full leading-18px'>{hubAssistants.length}</span>
                  </div>
                  {hubAssistants.length > 0 ? (
                    renderAssistantGrid(hubAssistants, isEnterprise, true, !isEnterprise)
                  ) : hubError ? (
                    <HubEmptyState error={hubError} onRetry={() => void fetchHubAssistants()} />
                  ) : (
                    <div className='bg-fill-1 border border-dashed rd-12px px-3.5 py-4.5 text-12px text-tertiary'>{t('settings.noHubAssistants', '暂无智能体库智能体')}</div>
                  )}
                </section>
              </div>
            )}
          </AionScrollArea>
        )}

        {/* ==================== Edit Drawer ==================== */}
        <Drawer
          title={isCreating ? t('settings.createAssistant', '创建智能体') : t('settings.editAssistant', '智能体详情')}
          closable
          visible={editVisible}
          placement='right'
          width={drawerWidth}
          zIndex={1200}
          autoFocus={false}
          onCancel={() => {
            setEditVisible(false);
          }}
          headerStyle={{ background: 'var(--color-bg-1)' }}
          bodyStyle={{ background: 'var(--color-bg-1)' }}
          footer={
            <div className='flex justify-end gap-2'>
              <Button
                onClick={() => {
                  setEditVisible(false);
                }}
                className='w-[100px] rounded-[100px] bg-fill-2'
              >
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button type='primary' onClick={handleSave} disabled={!isCreating && isReadonlyAssistant} className='w-[100px] rounded-[100px]'>
                {isCreating ? t('common.create', 'Create') : t('common.save', 'Save')}
              </Button>
            </div>
          }
        >
          <div className='flex flex-col h-full overflow-hidden'>
            <div className='flex flex-col flex-1 gap-4 bg-fill-2 rounded-16px p-5 overflow-y-auto'>
              {/* Name & Avatar */}
              <div className='flex-shrink-0'>
                <Typography.Text bold>
                  <span className='text-red-500'>*</span> {t('settings.assistantNameAvatar', '名称及头像')}
                </Typography.Text>
                <div className='mt-2.5 flex items-center gap-3'>
                  {activeAssistant?.isBuiltin || isReadonlyAssistant ? (
                    <Avatar shape='square' size={40} className='rounded-lg'>
                      {editAvatarImage ? <img src={editAvatarImage} alt='' width={24} height={24} style={{ objectFit: 'contain' }} /> : editAvatar ? <span className='text-24px'>{editAvatar}</span> : <Bot size={20} />}
                    </Avatar>
                  ) : (
                    <EmojiPicker value={editAvatar} onChange={(emoji) => setEditAvatar(emoji)} placement='br'>
                      <div className='cursor-pointer'>
                        <Avatar shape='square' size={40} className='rounded-lg hover:bg-fill-2 transition-colors'>
                          {editAvatarImage ? <img src={editAvatarImage} alt='' width={24} height={24} style={{ objectFit: 'contain' }} /> : editAvatar ? <span className='text-24px'>{editAvatar}</span> : <Bot size={20} />}
                        </Avatar>
                      </div>
                    </EmojiPicker>
                  )}
                  <Input value={editName} onChange={(value) => setEditName(value)} disabled={activeAssistant?.isBuiltin || isReadonlyAssistant} placeholder={t('settings.agentNamePlaceholder', 'Enter a name for this agent')} className='flex-1' />
                </div>
              </div>

              {/* Description */}
              <div className='flex-shrink-0'>
                <Typography.Text bold>{t('settings.assistantDescription', '智能体描述')}</Typography.Text>
                <Input className='mt-2.5' value={editDescription} onChange={(value) => setEditDescription(value)} disabled={activeAssistant?.isBuiltin || isReadonlyAssistant} placeholder={t('settings.assistantDescriptionPlaceholder', '帮你解决什么问题')} />
              </div>

              {/* Main Agent - locked to Sudo Code */}
              <div className='flex-shrink-0'>
                <Typography.Text bold>{t('settings.assistantMainAgent', '主智能体')}</Typography.Text>
                <Select className='mt-2.5 w-full' value={DEFAULT_PRESET_AGENT_TYPE} disabled>
                  <Select.Option key='scode' value='scode'>
                    Sudo Code
                  </Select.Option>
                </Select>
              </div>

              {/* Rules */}
              <div className='flex-shrink-0'>
                <Typography.Text bold className='flex-shrink-0'>
                  {t('settings.assistantRules', '规则')}
                </Typography.Text>
                <div className='mt-2.5 border overflow-hidden rounded-8px' style={{ height: '300px' }}>
                  {!activeAssistant?.isBuiltin && !isReadonlyAssistant && (
                    <div className='flex items-center h-9 bg-fill-2 border-b flex-shrink-0'>
                      <div className={`flex items-center h-full px-4 cursor-pointer transition-all text-13px font-medium ${promptViewMode === 'edit' ? 'text-primary border-b-2px border-primary' : 'text-secondary hover:text-foreground'}`} onClick={() => setPromptViewMode('edit')}>
                        {t('settings.promptEdit', 'Edit')}
                      </div>
                      <div className={`flex items-center h-full px-4 cursor-pointer transition-all text-13px font-medium ${promptViewMode === 'preview' ? 'text-primary border-b-2px border-primary' : 'text-secondary hover:text-foreground'}`} onClick={() => setPromptViewMode('preview')}>
                        {t('settings.promptPreview', 'Preview')}
                      </div>
                    </div>
                  )}
                  <div className='bg-fill-2' style={{ height: activeAssistant?.isBuiltin || isReadonlyAssistant ? '100%' : 'calc(100% - 36px)', overflow: 'auto' }}>
                    {promptViewMode === 'edit' && !activeAssistant?.isBuiltin && !isReadonlyAssistant ? (
                      <div ref={textareaWrapperRef} className='h-full'>
                        <Input.TextArea value={editContext} onChange={(value) => setEditContext(value)} placeholder={t('settings.assistantRulesPlaceholder', '请输入 Markdown 格式的规则...')} autoSize={false} className='border-none rounded-none bg-transparent h-full resize-none' />
                      </div>
                    ) : (
                      <div className='p-4'>{editContext ? <MarkdownView hiddenCodeCopyButton>{editContext}</MarkdownView> : <div className='text-secondary text-center py-8'>{t('settings.promptPreviewEmpty', 'No content to preview')}</div>}</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Skills selection */}
              <div className='flex-shrink-0 mt-4'>
                <div className='flex items-center justify-between mb-3'>
                  <Typography.Text bold>{t('settings.assistantSkills', '技能')}</Typography.Text>
                </div>
                <Collapse defaultActiveKey={['custom-skills']}>
                  <Collapse.Item header={<span className='text-13px font-medium'>{t('settings.customSkills', 'Custom Skills')}</span>} name='custom-skills' className='mb-2' extra={<span className='text-12px text-secondary'>{customSelectableSkills.length}</span>}>
                    <div className='grid gap-2' style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                      {customSelectableSkills.map((skill) => (
                        <SkillCard
                          key={skill.name}
                          skill={skill}
                          checked={isAssistantSkillSelected(selectedSkills, skill)}
                          onToggle={() => {
                            if (isReadonlyAssistant) return;
                            setSelectedSkills(toggleAssistantSkillSelection(selectedSkills, skill));
                          }}
                          disabled={isReadonlyAssistant}
                        />
                      ))}
                      {customSelectableSkills.length === 0 && <div className='text-center text-secondary text-12px py-4 col-span-full'>{t('settings.noCustomSkills', 'No custom skills available')}</div>}
                    </div>
                  </Collapse.Item>
                  <Collapse.Item header={<span className='text-13px font-medium'>{t('settings.builtinSkills', 'Builtin Skills')}</span>} name='builtin-skills' extra={<span className='text-12px text-secondary'>{builtinSelectableSkills.length}</span>}>
                    <div className='grid gap-2' style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                      {builtinSelectableSkills.map((skill) => (
                        <SkillCard
                          key={skill.name}
                          skill={skill}
                          checked={isAssistantSkillSelected(selectedSkills, skill)}
                          onToggle={() => {
                            if (isReadonlyAssistant) return;
                            setSelectedSkills(toggleAssistantSkillSelection(selectedSkills, skill));
                          }}
                          disabled={isReadonlyAssistant}
                        />
                      ))}
                      {builtinSelectableSkills.length === 0 && <div className='text-center text-secondary text-12px py-4 col-span-full'>{t('settings.noBuiltinSkills', 'No builtin skills available')}</div>}
                    </div>
                  </Collapse.Item>
                </Collapse>
              </div>
            </div>
          </div>
        </Drawer>

        {/* Duplicate Confirmation Modal */}
        <Modal
          title={t('settings.duplicateAssistantTitle', '复制智能体')}
          visible={duplicateConfirmVisible}
          onCancel={() => {
            setDuplicateConfirmVisible(false);
            setDuplicateAssistant(null);
            setDuplicateInstalledAssistant(null);
          }}
          onOk={handleDuplicateConfirm}
          okText={t('common.confirm', '确认')}
          cancelText={t('common.cancel', '取消')}
          className='w-[90vw] md:w-[400px]'
          wrapStyle={{ zIndex: 10000 }}
          maskStyle={{ zIndex: 9999 }}
        >
          <p>{t('settings.duplicateAssistantConfirm', 'Confirm duplicate this agent to the custom list? After duplication, you can edit it in "My Agents".')}</p>
          {/* Hub agent preview */}
          {duplicateAssistant && (
            <div className='mt-3 p-3 bg-fill-2 rounded-lg flex items-center gap-3'>
              <Avatar.Group size={32}>
                <Avatar className='border-none' shape='square' style={{ backgroundColor: 'var(--color-fill-2)', border: 'none' }}>
                  {(() => {
                    const resolvedAvatar = duplicateAssistant.avatar?.trim();
                    const emojiRegex = /^(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*$/u;
                    const hasEmojiAvatar = Boolean(resolvedAvatar && emojiRegex.test(resolvedAvatar));
                    if (resolvedAvatar && !hasEmojiAvatar) return <img src={resolvedAvatar} alt='' width={19} height={19} style={{ objectFit: 'contain' }} />;
                    if (hasEmojiAvatar) return <span style={{ fontSize: 19 }}>{resolvedAvatar}</span>;
                    return <Bot size={16} />;
                  })()}
                </Avatar>
              </Avatar.Group>
              <div>
                <div className='font-medium'>{duplicateAssistant.display_name || duplicateAssistant.name}</div>
                <div className='text-12px text-secondary line-clamp-2'>{duplicateAssistant.description}</div>
              </div>
            </div>
          )}
          {/* Installed agent preview */}
          {duplicateInstalledAssistant && (
            <div className='mt-3 p-3 bg-fill-2 rounded-lg flex items-center gap-3'>
              <Avatar.Group size={32}>
                <Avatar className='border-none' shape='square' style={{ backgroundColor: 'var(--color-fill-2)', border: 'none' }}>
                  {(() => {
                    const resolvedAvatar = duplicateInstalledAssistant.avatar?.trim();
                    const avatarImg = resolveAvatarImageSrc(resolvedAvatar);
                    const hasEmoji = Boolean(resolvedAvatar && isEmoji(resolvedAvatar));
                    if (avatarImg) return <img src={avatarImg} alt='' width={19} height={19} style={{ objectFit: 'contain' }} />;
                    if (hasEmoji) return <span style={{ fontSize: 19 }}>{resolvedAvatar}</span>;
                    return <Bot size={16} />;
                  })()}
                </Avatar>
              </Avatar.Group>
              <div>
                <div className='font-medium'>{duplicateInstalledAssistant.nameI18n?.[localeKey] || duplicateInstalledAssistant.name}</div>
                <div className='text-12px text-secondary line-clamp-2'>{duplicateInstalledAssistant.descriptionI18n?.[localeKey] || duplicateInstalledAssistant.description}</div>
              </div>
            </div>
          )}
          {/* Name hint */}
          {(duplicateAssistant || duplicateInstalledAssistant) && (
            <div className='mt-3 p-3 rounded-lg'>
              <div className='text-12px text-primary'>
                {t('settings.duplicateAssistantNameHint', {
                  name: duplicateAssistant ? duplicateAssistant.display_name || duplicateAssistant.name : duplicateInstalledAssistant?.nameI18n?.[localeKey] || duplicateInstalledAssistant?.name,
                  defaultValue: `复制后的智能体名称: 自定义-${duplicateAssistant ? duplicateAssistant.display_name || duplicateAssistant.name : duplicateInstalledAssistant?.nameI18n?.[localeKey] || duplicateInstalledAssistant?.name}`,
                })}
              </div>
            </div>
          )}
        </Modal>

        <UploadConfirmModal
          isVisible={uploadConfirmVisible}
          isUploading={uploading}
          assistant={uploadAssistant}
          localeKey={localeKey}
          onCancel={() => {
            setUploadConfirmVisible(false);
            setUploadAssistant(null);
          }}
          onConfirm={handleUploadConfirm}
          resolveAvatarImageSrc={resolveAvatarImageSrc}
        />

        {/* Hub Agent Detail Modal */}
        <AssistantDetailModal
          assistant={hubDetailAssistant}
          visible={hubDetailVisible}
          onClose={() => {
            setHubDetailVisible(false);
            setHubDetailAssistant(null);
          }}
          isInstalled={hubDetailAssistant ? (isEnterprise ? hubInstalledAssistants.has(hubDetailAssistant.name) : isHubAssistantInstalled(hubDetailAssistant)) : false}
          installing={installingAssistantId === hubDetailAssistant?.id}
          installProgress={installProgress}
          onInstall={(selectedSkillIds) => {
            if (hubDetailAssistant) {
              void handleInstallHubAssistant(hubDetailAssistant.id, selectedSkillIds);
            }
          }}
          latestVersionInfo={!isEnterprise && hubDetailAssistant ? latestAssistantVersions.get(hubDetailAssistant.id) : undefined}
          installedVersion={!isEnterprise && hubDetailAssistant ? getHubAssistantInstalledVersion(hubDetailAssistant) : undefined}
          onUpdate={
            !isEnterprise
              ? (selectedSkillIds) => {
                  if (hubDetailAssistant) {
                    void handleUpdateHubAssistant(hubDetailAssistant.id, selectedSkillIds);
                  }
                }
              : undefined
          }
          updating={!isEnterprise && hubDetailAssistant ? updatingAssistantId === hubDetailAssistant.id : false}
          onGoUse={handleGoUseHubAssistant}
          installedSkills={installedSkills}
        />
      </div>
    </PageWrapper>
  );
};

export default AgentSettings;
