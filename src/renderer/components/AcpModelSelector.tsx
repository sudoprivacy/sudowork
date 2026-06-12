/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { resolvePreferredAcpModelId } from '@/common/acp/defaultModels';
import type { IResponseMessage } from '@/common/ipcBridge';
import { ConfigStorage } from '@/common/storage';
import type { IProvider } from '@/common/storage';
import type { AcpModelInfo } from '@/types/acpTypes';
import { useLayoutContext } from '@/renderer/context/LayoutContext';
import { usePreviewContext } from '@/renderer/pages/conversation/preview';
import { getModelDisplayLabel } from '@/renderer/utils/agentUiDisplay';
import { buildProviderModelGroups } from '@/renderer/utils/modelProviderGroups';
import { Button, Dropdown, Message, Tooltip } from '@arco-design/web-react';
import { IconRefresh } from '@arco-design/web-react/icon';
import classNames from 'classnames';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useSWR from 'swr';

function buildFallbackModelInfo(modelId?: string | null): AcpModelInfo | null {
  if (!modelId) return null;
  return {
    source: 'models',
    currentModelId: modelId,
    currentModelLabel: modelId,
    canSwitch: false,
    availableModels: [],
  };
}

/**
 * Model selector for ACP-based agents.
 * Fetches model info via IPC and listens for real-time updates via responseStream.
 * Renders three states:
 * - null model info: disabled "Use CLI model" button (backward compatible)
 * - canSwitch=false: read-only display of current model name
 * - canSwitch=true: clickable dropdown selector
 *
 * When backend and initialModelId are provided, the component can show
 * cached model info before the agent manager is created (pre-first-message).
 * When preview panel is open, shows compact version (truncated label).
 */
const AcpModelSelector: React.FC<{
  conversationId: string;
  /** ACP backend name for loading cached models (e.g., 'claude', 'qwen') */
  backend?: string;
  /** Pre-selected model ID from Guid page */
  initialModelId?: string;
}> = ({ conversationId, backend, initialModelId }) => {
  const { t } = useTranslation();
  const { isOpen: isPreviewOpen } = usePreviewContext();
  const layout = useLayoutContext();
  const fallbackModelId = resolvePreferredAcpModelId({
    backend,
    explicitModelId: initialModelId,
  });
  const [modelInfo, setModelInfo] = useState<AcpModelInfo | null>(() => buildFallbackModelInfo(fallbackModelId));
  const modelInfoRef = useRef(modelInfo);
  modelInfoRef.current = modelInfo;
  // Track whether user has manually switched model via dropdown
  const hasUserChangedModel = useRef(false);
  // scode only: manual refresh of the live model list (specific_pricing)
  const [refreshingModels, setRefreshingModels] = useState(false);

  // Fetch initial model info on mount, fallback to cached models if manager not ready
  useEffect(() => {
    let cancelled = false;

    // For remote-agent (Moss Server), fetch models from Moss API
    if (backend === 'remote-agent') {
      fetchMossModelInfo(cancelled);
      return () => {
        cancelled = true;
      };
    }

    // For scode, pull the live model list from sudorouter specific_pricing
    // (rewrites sudocode.json models). Falls back to the standard path on
    // failure so the dropdown still works offline.
    if (backend === 'scode') {
      void fetchScodeLiveModelInfo();
      return () => {
        cancelled = true;
      };
    }

    runStandardModelInfoFetch();

    return () => {
      cancelled = true;
    };

    async function fetchScodeLiveModelInfo() {
      try {
        const result = await ipcBridge.scode.refreshModels.invoke();
        if (cancelled) return;
        if (result.success && result.data && (result.data.availableModels?.length ?? 0) > 0) {
          const info = result.data;
          // Honor a Guid-page pre-selected model on first load.
          if (!hasUserChangedModel.current && initialModelId) {
            const match = info.availableModels.find((m) => m.id === initialModelId);
            if (match) {
              setModelInfo({ ...info, currentModelId: match.id, currentModelLabel: match.label });
              return;
            }
          }
          setModelInfo(info);
          return;
        }
      } catch (error) {
        console.error('[AcpModelSelector][scode] refreshModels failed:', error);
      }
      if (cancelled) return;
      runStandardModelInfoFetch();
    }

    function runStandardModelInfoFetch() {
      ipcBridge.acpConversation.getModelInfo
        .invoke({ conversationId })
        .then((result) => {
          if (cancelled) return;
          if (result.success && result.data?.modelInfo) {
            const info = result.data.modelInfo;
            if (backend === 'codex') {
              console.log('[AcpModelSelector][codex] Initial model info:', info);
            }
            // When agent is not fully initialized, getModelInfo returns
            // canSwitch=false with empty availableModels. Prefer cached data
            // in that case to keep the dropdown functional.
            if (info.availableModels?.length > 0) {
              setModelInfo(info);
            } else if (backend) {
              void loadCachedModelInfo(backend, cancelled);
            } else if (info.currentModelId || info.currentModelLabel) {
              setModelInfo(info);
            } else {
              setModelInfo(buildFallbackModelInfo(fallbackModelId));
            }
          } else if (backend) {
            // Manager not yet created — load cached model list from storage
            void loadCachedModelInfo(backend, cancelled);
          } else {
            setModelInfo(buildFallbackModelInfo(fallbackModelId));
          }
        })
        .catch(() => {
          if (!cancelled && backend) {
            void loadCachedModelInfo(backend, cancelled);
          } else if (!cancelled) {
            setModelInfo(buildFallbackModelInfo(fallbackModelId));
          }
        });
    }

    async function fetchMossModelInfo(isCancelled: boolean) {
      try {
        // Fetch available models from Moss Server
        const modelsResult = await ipcBridge.moss.getAvailableModels.invoke();
        if (isCancelled) return;

        if (!modelsResult.success || !modelsResult.data) {
          setModelInfo(buildFallbackModelInfo(fallbackModelId));
          return;
        }

        const availableModels = modelsResult.data.map((m: any) => ({
          id: m.id,
          label: m.label || m.id,
        }));

        // Fetch user's current model preference
        const userPrefResult = await ipcBridge.moss.getUserModel.invoke();
        if (isCancelled) return;

        let currentModelId = '';
        let currentModelLabel = '';

        // Priority: user preference > system default > first available
        if (userPrefResult.success && userPrefResult.data?.modelId) {
          // User has explicit preference
          currentModelId = userPrefResult.data.modelId;
          const match = availableModels.find((m: any) => m.id === currentModelId);
          currentModelLabel = match?.label || currentModelId;
        } else if (userPrefResult.success && userPrefResult.data?.systemDefaultModel) {
          // Use system default model from server
          currentModelId = userPrefResult.data.systemDefaultModel;
          const match = availableModels.find((m: any) => m.id === currentModelId);
          currentModelLabel = match?.label || currentModelId;
        } else if (availableModels.length > 0) {
          // Fallback to first available model
          currentModelId = availableModels[0].id;
          currentModelLabel = availableModels[0].label;
        }

        console.log(`[AcpModelSelector][remote-agent] Model selection: ${currentModelId} (userPref: ${userPrefResult.data?.modelId}, systemDefault: ${userPrefResult.data?.systemDefaultModel})`);

        setModelInfo({
          source: 'models',
          currentModelId,
          currentModelLabel,
          canSwitch: availableModels.length > 1,
          availableModels,
        });
      } catch (error) {
        console.error('[AcpModelSelector][remote-agent] Failed to fetch Moss model info:', error);
        if (!isCancelled) {
          setModelInfo(buildFallbackModelInfo(fallbackModelId));
        }
      }
    }

    async function loadCachedModelInfo(backendKey: string, isCancelled: boolean) {
      try {
        const cached = await ConfigStorage.get('acp.cachedModels');
        if (isCancelled) return;
        const cachedInfo = cached?.[backendKey];
        if (cachedInfo?.availableModels?.length > 0) {
          if (backendKey === 'codex') {
            console.log('[AcpModelSelector][codex] Loaded cached model info:', cachedInfo);
          }
          const effectiveModelId = resolvePreferredAcpModelId({
            backend: backendKey,
            explicitModelId: initialModelId,
            cachedModelId: cachedInfo.currentModelId || null,
          });
          setModelInfo({
            ...cachedInfo,
            currentModelId: effectiveModelId,
            currentModelLabel: (effectiveModelId && cachedInfo.availableModels.find((m) => m.id === effectiveModelId)?.label) || effectiveModelId,
          });
        } else {
          setModelInfo(buildFallbackModelInfo(fallbackModelId));
        }
      } catch {
        if (!isCancelled) {
          setModelInfo(buildFallbackModelInfo(fallbackModelId));
        }
      }
    }
  }, [conversationId, backend, fallbackModelId, initialModelId]);

  // Track pending model switch for showing success message
  const pendingModelSwitchRef = useRef<string | null>(null);

  // Listen for acp_model_info / codex_model_info events from responseStream
  useEffect(() => {
    const handler = (message: IResponseMessage) => {
      if (message.conversation_id !== conversationId) return;
      if (message.type === 'acp_model_info' && message.data) {
        const incoming = message.data as AcpModelInfo;
        if (backend === 'codex') {
          console.log('[AcpModelSelector][codex] Stream model info:', incoming);
        }
        // For remote-agent, check if this is a model switch confirmation
        if (backend === 'remote-agent' && pendingModelSwitchRef.current) {
          const modelLabel = incoming.currentModelLabel || incoming.currentModelId;
          Message.success(t('common.modelSwitchSuccess', { model: modelLabel }));
          pendingModelSwitchRef.current = null;
          // For remote-agent, preserve availableModels from current state
          // since server only sends currentModelId in model_changed event
          if (!incoming.availableModels?.length && modelInfo?.availableModels?.length) {
            setModelInfo({
              ...incoming,
              canSwitch: modelInfo.canSwitch,
              availableModels: modelInfo.availableModels,
            });
            return;
          }
        }
        // Preserve pre-selected model from Guid page until user manually switches.
        // The agent emits its default model during start (before re-apply), which
        // would otherwise overwrite the user's Guid page selection.
        if (initialModelId && !hasUserChangedModel.current && incoming.availableModels?.length > 0) {
          const match = incoming.availableModels.find((m) => m.id === initialModelId);
          if (match && incoming.currentModelId !== initialModelId) {
            setModelInfo({
              ...incoming,
              currentModelId: initialModelId,
              currentModelLabel: match.label || initialModelId,
            });
            return;
          }
        }
        setModelInfo(incoming);
      } else if (message.type === 'codex_model_info' && message.data) {
        // Codex model info: always read-only display
        const data = message.data as { model: string };
        if (data.model) {
          setModelInfo({
            source: 'models',
            currentModelId: data.model,
            currentModelLabel: data.model,
            canSwitch: false,
            availableModels: [],
          });
        }
      }
    };
    return ipcBridge.acpConversation.responseStream.on(handler);
  }, [conversationId, backend, initialModelId, t, modelInfo]);

  const handleSelectModel = useCallback(
    (modelId: string) => {
      hasUserChangedModel.current = true;

      // For remote-agent (Moss Server), use user model preference API
      // The new model will take effect on the next message
      if (backend === 'remote-agent') {
        ipcBridge.moss.setUserModel
          .invoke({ modelId })
          .then(async (result) => {
            if (result.success) {
              const match = modelInfo?.availableModels.find((m) => m.id === modelId);
              const modelLabel = match?.label || modelId;

              // Also try to switch model for current session via WebSocket
              // This will take effect immediately for the current session
              // The UI will be updated when model_changed event is received
              if (conversationId) {
                // Set pending model switch to show success message when confirmed
                pendingModelSwitchRef.current = modelId;
                const setModelResult = await ipcBridge.acpConversation.setModel.invoke({ conversationId, modelId });
                console.log('[AcpModelSelector][remote-agent] setModel result:', setModelResult);
                // Success message will be shown when acp_model_info event is received
              } else {
                // No active session, just update preference and show success
                setModelInfo({
                  ...modelInfo!,
                  currentModelId: modelId,
                  currentModelLabel: modelLabel,
                });
                Message.success(t('common.modelSwitchSuccess', { model: modelLabel }));
              }
            } else {
              Message.error(result.msg || t('common.modelSwitchFailed'));
            }
          })
          .catch((error) => {
            console.error('[AcpModelSelector][remote-agent] Failed to set model:', error);
            Message.error(t('common.modelSwitchFailed'));
          });
        return;
      }

      ipcBridge.acpConversation.setModel
        .invoke({ conversationId, modelId })
        .then((result) => {
          if (result.success && result.data?.modelInfo) {
            setModelInfo(result.data.modelInfo);
            const modelLabel = result.data.modelInfo.currentModelLabel || modelId;
            Message.success(t('common.modelSwitchSuccess', { model: modelLabel }));
          }
        })
        .catch((error) => {
          console.error('[AcpModelSelector] Failed to set model:', error);
        });
    },
    [conversationId, backend, modelInfo, t]
  );

  // scode only: re-pull the live model list from sudorouter specific_pricing.
  const handleRefreshModels = useCallback(async () => {
    if (backend !== 'scode' || refreshingModels) return;
    setRefreshingModels(true);
    try {
      const result = await ipcBridge.scode.refreshModels.invoke();
      if (result.success && result.data) {
        const data = result.data;
        // Keep the current selection if it's still in the refreshed list.
        setModelInfo((prev) => {
          const keepId = prev?.currentModelId && data.availableModels.some((m) => m.id === prev.currentModelId) ? prev.currentModelId : data.currentModelId;
          const keepLabel = data.availableModels.find((m) => m.id === keepId)?.label || keepId;
          return { ...data, currentModelId: keepId, currentModelLabel: keepLabel };
        });
        Message.success(t('common.modelListRefreshed'));
      } else {
        Message.error(result.msg || t('common.modelListRefreshFailed'));
      }
    } catch (error) {
      console.error('[AcpModelSelector][scode] handleRefreshModels failed:', error);
      Message.error(t('common.modelListRefreshFailed'));
    } finally {
      setRefreshingModels(false);
    }
  }, [backend, refreshingModels, t]);

  const defaultModelLabel = t('common.defaultModel');
  const rawDisplayLabel = modelInfo?.currentModelLabel || modelInfo?.currentModelId || '';
  const displayLabel = getModelDisplayLabel({
    selectedValue: modelInfo?.currentModelId,
    selectedLabel: rawDisplayLabel,
    defaultModelLabel,
    fallbackLabel: t('conversation.welcome.useCliModel'),
  });
  const compact = isPreviewOpen || layout?.isMobile;
  const isMobileCompact = Boolean(layout?.isMobile);

  // 获取模型配置数据（包含健康状态）
  const { data: modelConfig } = useSWR<IProvider[]>('model.config', () => ipcBridge.mode.getModelConfig.invoke());

  const providerModelGroups = React.useMemo(() => buildProviderModelGroups(modelInfo?.availableModels || [], modelConfig), [modelInfo?.availableModels, modelConfig]);

  // 获取当前模型的健康状态
  const currentModelHealth = React.useMemo(() => {
    if (!modelInfo?.currentModelId || !modelConfig) return { status: 'unknown', color: 'bg-gray-400' };
    const providerConfig = modelConfig.find((p) => p.platform?.includes(backend || ''));
    const healthStatus = providerConfig?.modelHealth?.[modelInfo.currentModelId]?.status || 'unknown';
    const healthColor = healthStatus === 'healthy' ? 'bg-green-500' : healthStatus === 'unhealthy' ? 'bg-red-500' : 'bg-gray-400';
    return { status: healthStatus, color: healthColor };
  }, [modelInfo?.currentModelId, modelConfig, backend]);

  const [dropdownOpen, setDropdownOpen] = useState(false);

  // State 1: No model info — show disabled "Use CLI model" button
  if (!modelInfo) {
    return (
      <Tooltip content={t('conversation.welcome.modelSwitchNotSupported')} position='top'>
        <Button className={classNames('sendbox-model-btn header-model-btn', compact && '!max-w-[120px]', isMobileCompact && '!max-w-[160px]')} shape='round' size='small' style={{ cursor: 'default' }}>
          <span className='flex items-center gap-6px min-w-0'>
            <span className={compact ? 'block truncate' : undefined}>{t('conversation.welcome.useCliModel')}</span>
          </span>
        </Button>
      </Tooltip>
    );
  }

  // State 2: Has model info but cannot switch — read-only display
  if (!modelInfo.canSwitch) {
    return (
      <Tooltip content={displayLabel} position='top'>
        <Button className={classNames('sendbox-model-btn header-model-btn', compact && '!max-w-[120px]', isMobileCompact && '!max-w-[160px]')} shape='round' size='small' style={{ cursor: 'default' }}>
          <span className='flex items-center gap-6px min-w-0'>
            {currentModelHealth.status !== 'unknown' && <div className={`w-6px h-6px rounded-full shrink-0 ${currentModelHealth.color}`} />}
            <span className={compact ? 'block truncate' : undefined}>{displayLabel}</span>
          </span>
        </Button>
      </Tooltip>
    );
  }

  // State 3: Can switch — dropdown selector
  return (
    <Dropdown
      trigger='click'
      popupVisible={dropdownOpen}
      onVisibleChange={setDropdownOpen}
      droplist={
        <div className='flex flex-col gap-2px p-6px rd-12px border border-solid border-[var(--border-base)] bg-popup max-h-[min(60vh,420px)] overflow-y-auto scrollbar-hide' style={{ minWidth: 200, boxShadow: '0 8px 28px rgba(0, 0, 0, 0.12)' }}>
          {providerModelGroups.map((group, groupIndex) => (
            <div key={group.key} className='flex flex-col gap-2px'>
              <div className='flex items-center justify-between gap-8px pl-10px pr-2px pt-4px pb-2px min-h-24px'>
                <span className='text-12px leading-18px text-t-secondary truncate'>{group.name || t('common.other', { defaultValue: 'Other' })}</span>
                {backend === 'scode' && groupIndex === 0 && (
                  <span onClick={(e) => e.stopPropagation()}>
                    <Tooltip content={t('common.refresh')} position='top'>
                      <Button size='mini' shape='circle' type='text' icon={<IconRefresh spin={refreshingModels} />} loading={refreshingModels} onClick={handleRefreshModels} />
                    </Tooltip>
                  </span>
                )}
              </div>
              {group.models.map((model) => {
                // 获取模型健康状态
                const providerConfig = group.provider || modelConfig?.find((p) => p.platform?.includes(backend || ''));
                const healthStatus = providerConfig?.modelHealth?.[model.id]?.status || 'unknown';
                const healthColor = healthStatus === 'healthy' ? 'bg-green-500' : healthStatus === 'unhealthy' ? 'bg-red-500' : 'bg-gray-400';
                const selected = model.id === modelInfo.currentModelId;

                return (
                  <div
                    key={`${group.key}-${model.id}`}
                    className={classNames('flex items-center gap-8px px-10px h-38px rd-8px cursor-pointer text-14px text-t-primary transition-colors hover:bg-hover active:bg-active', selected && 'bg-2')}
                    onClick={() => {
                      handleSelectModel(model.id);
                      setDropdownOpen(false);
                    }}
                  >
                    {healthStatus !== 'unknown' && <div className={`w-6px h-6px rounded-full shrink-0 ${healthColor}`} />}
                    <span className='truncate'>{model.label}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      }
    >
      <Button className={classNames('sendbox-model-btn header-model-btn', compact && '!max-w-[120px]', isMobileCompact && '!max-w-[160px]')} shape='round' size='small'>
        <span className='flex items-center gap-6px min-w-0'>
          {currentModelHealth.status !== 'unknown' && <div className={`w-6px h-6px rounded-full shrink-0 ${currentModelHealth.color}`} />}
          <span className={compact ? 'block truncate' : undefined}>{displayLabel}</span>
        </span>
      </Button>
    </Dropdown>
  );
};

export default AcpModelSelector;
