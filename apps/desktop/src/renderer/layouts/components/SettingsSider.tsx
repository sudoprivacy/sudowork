/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Bot, Building2, Cable, Cloud, CreditCard, Globe, HardDrive, Info, MessageSquare, Monitor, Puzzle, Settings, ShieldCheck, Sparkles, User, Users, Wrench } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { Tooltip } from '@arco-design/web-react';
import { extensions as extensionsIpc, type IExtensionSettingsTab } from '@sudowork/host-bridge/ipcBridge';
import { useAppMode } from '@/renderer/hooks/useAppMode';
import { useAuth } from '@/renderer/context/AuthContext';
import { useExtI18n } from '@/renderer/hooks/useExtI18n';
import { fetchSystemConfig, normalizeRechargeMode, type RechargeMode } from '@/common/systemConfig';
import { isElectronDesktop, resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import { getSiderTooltipProps } from '@/renderer/utils/siderTooltip';
import SidebarNavItem from '@/renderer/layouts/components/SidebarNavItem';

/** Builtin settings tab IDs in display order (must match router paths). */
const BUILTIN_TAB_IDS = ['profile', 'recharge', 'members', 'model', 'agent', 'tools', 'skill', 'security', 'display', 'channels', 'runtime', 'system', 'about'] as const; // 隐藏'copilot'；'cron'已移至左侧边栏

/** Enterprise mode builtin tab IDs (restricted subset). */
const ENTERPRISE_BUILTIN_TAB_IDS = ['profile', 'enterprise', 'mcp', 'display', 'channels', 'system', 'about'] as const;

type SiderItem = {
  id: string;
  label: string;
  icon: React.ReactElement;
  isImageIcon?: boolean;
  /** Route path segment — for builtins: `/settings/{path}`, for extensions: `/settings/ext/{id}` */
  path: string;
  hidden?: boolean;
};

const SettingsSider: React.FC<{ collapsed?: boolean; tooltipEnabled?: boolean }> = ({ collapsed = false, tooltipEnabled = false }) => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const isDesktop = isElectronDesktop();
  const { isEnterprise } = useAppMode();
  const { isGuest } = useAuth();

  const [extensionTabs, setExtensionTabs] = useState<IExtensionSettingsTab[]>([]);
  const [rechargeMode, setRechargeMode] = useState<RechargeMode>('pay');
  const { resolveExtTabName } = useExtI18n();

  const loadExtensionTabs = useCallback(async (): Promise<IExtensionSettingsTab[]> => {
    const maxAttempts = 20;
    const retryDelayCapMs = 300;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const tabs = (await extensionsIpc.getSettingsTabs.invoke()) ?? [];
        if (tabs.length > 0 || attempt === maxAttempts - 1) {
          return tabs;
        }
      } catch (error) {
        lastError = error;
        if (attempt === maxAttempts - 1) {
          throw error;
        }
      }

      await new Promise((resolve) => window.setTimeout(resolve, Math.min(100 * (attempt + 1), retryDelayCapMs)));
    }

    if (lastError) {
      throw lastError;
    }

    return [];
  }, []);

  useEffect(() => {
    let disposed = false;

    const syncExtensionTabs = async () => {
      try {
        const tabs = await loadExtensionTabs();
        if (!disposed) {
          setExtensionTabs(tabs);
        }
      } catch (err) {
        if (!disposed) {
          console.error('[SettingsSider] Failed to load extension settings tabs:', err);
        }
      }
    };

    void syncExtensionTabs();
    const unsubscribe = extensionsIpc.stateChanged.on(() => {
      void syncExtensionTabs();
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [loadExtensionTabs]);

  useEffect(() => {
    let isDisposed = false;

    void fetchSystemConfig().then((config) => {
      if (!isDisposed) {
        setRechargeMode(normalizeRechargeMode(config?.recharge_mode));
      }
    });

    return () => {
      isDisposed = true;
    };
  }, []);

  const menus: SiderItem[] = useMemo(() => {
    // Build builtin items
    const builtinMap: Record<string, SiderItem> = {
      profile: { id: 'profile', label: t('settings.profile'), icon: <User />, path: 'profile' },
      enterprise: { id: 'enterprise', label: t('settings.enterprise', { defaultValue: '企业设置' }), icon: <Building2 />, path: 'enterprise' },
      mcp: { id: 'mcp', label: t('settings.mcpService', { defaultValue: 'MCP 服务' }), icon: <Cable />, path: 'mcp' },
      recharge: {
        id: 'recharge',
        label: rechargeMode === 'approve' ? t('settings.creditApplication.title', '积分申请') : t('settings.rechargeCenter') || '充值中心',
        icon: <CreditCard />,
        path: 'recharge',
        hidden: rechargeMode === 'disabled',
      },
      members: {
        id: 'members',
        label: t('settings.memberManagement'),
        icon: <Users />,
        path: 'members',
        hidden: true, // 固定隐藏，服务端已只有一个企业
      },
      model: { id: 'model', label: t('settings.model'), icon: <Cloud />, path: 'model' },
      agent: { id: 'agent', label: t('settings.agent'), icon: <Bot />, path: 'agent' },
      tools: { id: 'tools', label: t('settings.tools'), icon: <Wrench />, path: 'tools' },
      skill: { id: 'skill', label: t('settings.skill'), icon: <Sparkles />, path: 'skill' },
      security: { id: 'security', label: t('settings.security'), icon: <ShieldCheck />, path: 'security' },
      display: { id: 'display', label: t('settings.display'), icon: <Monitor />, path: 'display' },
      // copilot: { id: 'copilot', label: t('settings.copilot'), icon: <BotMessageSquare />, path: 'copilot' },
      channels: { id: 'channels', label: t('settings.webui'), icon: isDesktop ? <Globe /> : <MessageSquare />, path: 'channels' },
      runtime: { id: 'runtime', label: t('settings.runtime'), icon: <HardDrive />, path: 'runtime' },
      system: { id: 'system', label: t('settings.system'), icon: <Settings />, path: 'system' },
      about: { id: 'about', label: t('settings.about'), icon: <Info />, path: 'about' },
    };

    // Start with ordered builtin IDs (enterprise mode uses restricted set)
    const activeBuiltinTabIds = isEnterprise ? ENTERPRISE_BUILTIN_TAB_IDS : BUILTIN_TAB_IDS;
    const result: SiderItem[] = activeBuiltinTabIds.map((id) => builtinMap[id]).filter((item) => !item.hidden && !(isGuest && (item.id === 'profile' || item.id === 'recharge')));

    // Extension tabs with position anchoring
    const beforeMap = new Map<string, IExtensionSettingsTab[]>();
    const afterMap = new Map<string, IExtensionSettingsTab[]>();
    const unanchored: IExtensionSettingsTab[] = [];

    for (const tab of extensionTabs) {
      if (!tab.position) {
        unanchored.push(tab);
        continue;
      }
      const { anchor, placement } = tab.position;
      const map = placement === 'before' ? beforeMap : afterMap;
      let list = map.get(anchor);
      if (!list) {
        list = [];
        map.set(anchor, list);
      }
      list.push(tab);
    }

    // Helper to create SiderItem from extension tab
    const toSiderItem = (tab: IExtensionSettingsTab): SiderItem => {
      const resolvedIcon = resolveExtensionAssetUrl(tab.icon) || tab.icon;
      return {
        id: tab.id,
        label: resolveExtTabName(tab),
        icon: resolvedIcon ? <img src={resolvedIcon} alt='' className='size-full object-contain' /> : <Puzzle />,
        isImageIcon: Boolean(resolvedIcon),
        path: `ext/${tab.id}`,
      };
    };

    // Insert anchored tabs (reverse iteration to preserve indices)
    for (let i = result.length - 1; i >= 0; i--) {
      const builtinId = result[i].id;
      const afters = afterMap.get(builtinId);
      if (afters) {
        result.splice(i + 1, 0, ...afters.map(toSiderItem));
      }
      const befores = beforeMap.get(builtinId);
      if (befores) {
        result.splice(i, 0, ...befores.map(toSiderItem));
      }
    }

    // Append unanchored before "system"
    if (unanchored.length > 0) {
      const systemIdx = result.findIndex((item) => item.id === 'system');
      const insertIdx = systemIdx >= 0 ? systemIdx : result.length;
      result.splice(insertIdx, 0, ...unanchored.map(toSiderItem));
    }

    // Enterprise mode: filter extension tabs whose anchor targets a hidden builtin tab
    // Keep: unanchored extension tabs, and extension tabs anchored to ENTERPRISE_BUILTIN_TAB_IDS
    // Remove: extension tabs anchored to hidden builtins (e.g., agent, tools, skill, etc.)
    if (isEnterprise) {
      const enterpriseIds = new Set<string>(ENTERPRISE_BUILTIN_TAB_IDS);
      for (let i = result.length - 1; i >= 0; i--) {
        const item = result[i];
        // Builtin tabs are already filtered by activeBuiltinTabIds above,
        // but extension tabs may have been inserted via anchoring.
        // Only remove extension tabs (path starts with "ext/") that were anchored
        // to a hidden builtin. Unanchored and enterprise-anchored extensions stay.
        if (item.path.startsWith('ext/')) {
          const extTab = extensionTabs.find((t) => t.id === item.id);
          if (extTab?.position?.anchor && !enterpriseIds.has(extTab.position.anchor)) {
            result.splice(i, 1);
          }
        }
      }
    }

    return result;
  }, [t, rechargeMode, isDesktop, extensionTabs, resolveExtTabName, isEnterprise, isGuest]);

  const siderTooltipProps = getSiderTooltipProps(tooltipEnabled);
  return (
    <div className='flex-1 min-h-0 settings-sider flex flex-col gap-0.5 overflow-y-auto overflow-x-hidden scrollbar-hide'>
      {menus.map((item) => {
        const isSelected = pathname.includes(item.path);
        return (
          <Tooltip key={item.id} {...siderTooltipProps} content={item.label} position='right'>
            <SidebarNavItem
              icon={
                item.isImageIcon ? (
                  <span className='f-center size-5'>{item.icon}</span>
                ) : (
                  React.cloneElement(item.icon as React.ReactElement<{ size?: string | number; strokeWidth?: number; className?: string }>, {
                    size: '20',
                    strokeWidth: 1.8,
                    className: 'flex',
                  })
                )
              }
              label={item.label}
              selected={isSelected}
              collapsed={collapsed}
              className='settings-sider__item shrink-0'
              dataAttributes={{
                'data-settings-id': item.id,
                'data-settings-path': item.path,
              }}
              onClick={() => {
                Promise.resolve(navigate(`/settings/${item.path}`, { replace: true })).catch((error) => {
                  console.error('Navigation failed:', error);
                });
              }}
            />
          </Tooltip>
        );
      })}
    </div>
  );
};

export default SettingsSider;
