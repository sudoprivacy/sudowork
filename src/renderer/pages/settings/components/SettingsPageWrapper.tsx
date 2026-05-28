import classNames from 'classnames';
import React, { useEffect, useState } from 'react';
import { useLayoutContext } from '@/renderer/context/LayoutContext';
import { SettingsViewModeProvider } from '@/renderer/components/SettingsModal/settingsViewContext';
import { isElectronDesktop, resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import { extensions as extensionsIpc, type IExtensionSettingsTab } from '@/common/ipcBridge';
import { Communication, Computer, Connection, Dollar, Earth, HardDiskOne, Info, Lightning, LinkCloud, Peoples, Puzzle, Robot, Shield, System, Toolkit, User, BuildingTwo } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useExtI18n } from '@/renderer/hooks/useExtI18n';
import { useAppMode } from '@/renderer/hooks/useAppMode';

/** Enterprise mode builtin tab IDs (restricted subset) - synced with SettingsSider */
const ENTERPRISE_BUILTIN_TAB_IDS = ['profile', 'enterprise', 'mcp', 'display', 'webui', 'system', 'about'] as const;
interface SettingsPageWrapperProps {
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

const SettingsPageWrapper: React.FC<SettingsPageWrapperProps> = ({ children, className, contentClassName }) => {
  const layout = useLayoutContext();
  const isMobile = layout?.isMobile ?? false;
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t } = useTranslation();
  const isDesktop = isElectronDesktop();
  const { isEnterprise } = useAppMode();

  const [extensionTabs, setExtensionTabs] = useState<IExtensionSettingsTab[]>([]);

  useEffect(() => {
    void extensionsIpc.getSettingsTabs
      .invoke()
      .then((tabs) => setExtensionTabs(tabs ?? []))
      .catch((err) => console.error('[SettingsPageWrapper] Failed to load extension tabs:', err));
  }, []);

  const { resolveExtTabName } = useExtI18n();

  type NavItem = { label: string; icon: React.ReactElement; path: string; id: string; hidden?: boolean };

  const menuItems = React.useMemo(() => {
    // Sync with SettingsSider menu items / 与 SettingsSider 菜单项保持一致
    const builtinMap: Record<string, NavItem> = {
      profile: { id: 'profile', label: t('settings.profile', { defaultValue: '用户中心' }), icon: <User theme='outline' size='16' />, path: 'profile' },
      enterprise: { id: 'enterprise', label: t('settings.enterprise', { defaultValue: '企业设置' }), icon: <BuildingTwo theme='outline' size='16' />, path: 'enterprise' },
      mcp: { id: 'mcp', label: t('settings.mcpService', { defaultValue: 'MCP 服务' }), icon: <Connection theme='outline' size='16' />, path: 'mcp' },
      recharge: { id: 'recharge', label: t('settings.rechargeCenter') || '充值中心', icon: <Dollar theme='outline' size='16' />, path: 'recharge' },
      members: { id: 'members', label: t('settings.memberManagement', { defaultValue: '成员管理' }), icon: <Peoples theme='outline' size='16' />, path: 'members', hidden: true },
      model: { id: 'model', label: t('settings.model'), icon: <LinkCloud theme='outline' size='16' />, path: 'model' },
      agent: { id: 'agent', label: '数字助手', icon: <Robot theme='outline' size='16' />, path: 'agent' },
      tools: { id: 'tools', label: '工具', icon: <Toolkit theme='outline' size='16' />, path: 'tools' },
      skill: { id: 'skill', label: '技能商店', icon: <Lightning theme='outline' size='16' />, path: 'skill' },
      security: { id: 'security', label: '安全防护', icon: <Shield theme='outline' size='16' />, path: 'security' },
      display: { id: 'display', label: t('settings.display'), icon: <Computer theme='outline' size='16' />, path: 'display' },
      // copilot: { id: 'copilot', label: t('settings.copilot', { defaultValue: 'Copilot' }), icon: <Config theme='outline' size='16' />, path: 'copilot' },
      webui: { id: 'webui', label: '远程连接', icon: isDesktop ? <Earth theme='outline' size='16' /> : <Communication theme='outline' size='16' />, path: 'webui' },
      runtime: { id: 'runtime', label: t('settings.runtime'), icon: <HardDiskOne theme='outline' size='16' />, path: 'runtime' },
      system: { id: 'system', label: t('settings.system'), icon: <System theme='outline' size='16' />, path: 'system' },
      about: { id: 'about', label: t('settings.about'), icon: <Info theme='outline' size='16' />, path: 'about' },
    };

    // Use the same order as SettingsSider / 使用与 SettingsSider 相同的顺序
    const BUILTIN_TAB_IDS = ['profile', 'recharge', 'members', 'model', 'agent', 'tools', 'skill', 'security', 'display', 'webui', 'runtime', 'system', 'about'] as const; // 隐藏'copilot', 'cron'已移至左侧边栏
    const activeBuiltinTabIds = isEnterprise ? ENTERPRISE_BUILTIN_TAB_IDS : BUILTIN_TAB_IDS;
    const builtins: NavItem[] = activeBuiltinTabIds.map((id) => builtinMap[id]).filter((item) => !item.hidden);

    // Insert extension tabs before system (unanchored default) or at anchor position
    const result = [...builtins];
    const unanchored: IExtensionSettingsTab[] = [];
    const beforeMap = new Map<string, IExtensionSettingsTab[]>();
    const afterMap = new Map<string, IExtensionSettingsTab[]>();

    for (const tab of extensionTabs) {
      if (!tab.position) {
        unanchored.push(tab);
        continue;
      }
      const map = tab.position.placement === 'before' ? beforeMap : afterMap;
      let list = map.get(tab.position.anchor);
      if (!list) {
        list = [];
        map.set(tab.position.anchor, list);
      }
      list.push(tab);
    }

    const toNavItem = (tab: IExtensionSettingsTab): NavItem => {
      const resolvedIcon = resolveExtensionAssetUrl(tab.icon) || tab.icon;
      return {
        id: tab.id,
        label: resolveExtTabName(tab),
        icon: resolvedIcon ? <img src={resolvedIcon} alt='' className='w-16px h-16px object-contain' /> : <Puzzle theme='outline' size='16' />,
        path: `ext/${tab.id}`,
      };
    };

    for (let i = result.length - 1; i >= 0; i--) {
      const id = result[i].id;
      const afters = afterMap.get(id);
      if (afters) result.splice(i + 1, 0, ...afters.map(toNavItem));
      const befores = beforeMap.get(id);
      if (befores) result.splice(i, 0, ...befores.map(toNavItem));
    }

    if (unanchored.length > 0) {
      const sysIdx = result.findIndex((item) => item.id === 'system');
      const idx = sysIdx >= 0 ? sysIdx : result.length;
      result.splice(idx, 0, ...unanchored.map(toNavItem));
    }

    // Enterprise mode: filter extension tabs whose anchor targets a hidden builtin tab
    // Keep: unanchored extension tabs, and extension tabs anchored to ENTERPRISE_BUILTIN_TAB_IDS
    // Remove: extension tabs anchored to hidden builtins (e.g., agent, tools, skill, etc.)
    if (isEnterprise) {
      const enterpriseIds = new Set<string>(ENTERPRISE_BUILTIN_TAB_IDS);
      for (let i = result.length - 1; i >= 0; i--) {
        const item = result[i];
        if (item.path.startsWith('ext/')) {
          const extTab = extensionTabs.find((t) => t.id === item.id);
          if (extTab?.position?.anchor && !enterpriseIds.has(extTab.position.anchor)) {
            result.splice(i, 1);
          }
        }
      }
    }

    return result;
  }, [isDesktop, t, extensionTabs, resolveExtTabName, isEnterprise]);

  const containerClass = classNames('settings-page-wrapper w-full min-h-full box-border overflow-y-auto', isMobile ? 'px-16px py-14px' : 'px-12px md:px-40px py-32px', className);

  const contentClass = classNames('settings-page-content mx-auto w-full md:max-w-1024px', contentClassName);

  const navRef = React.useRef<HTMLDivElement>(null);

  // Scroll active menu item into view when route changes
  React.useEffect(() => {
    if (isMobile && navRef.current) {
      const activeItem = navRef.current.querySelector('.settings-mobile-top-nav__item--active') as HTMLElement;
      if (activeItem) {
        // Small delay to ensure DOM is fully rendered
        const timer = setTimeout(() => {
          activeItem.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }, 50);
        return () => clearTimeout(timer);
      }
    }
  }, [isMobile, pathname]);

  return (
    <SettingsViewModeProvider value='page'>
      <div className={containerClass}>
        {isMobile && (
          <div ref={navRef} className='settings-mobile-top-nav'>
            {menuItems.map((item) => {
              const active = pathname.includes(`/settings/${item.path}`);
              return (
                <button
                  key={item.path}
                  type='button'
                  className={classNames('settings-mobile-top-nav__item', {
                    'settings-mobile-top-nav__item--active': active,
                  })}
                  onClick={() => {
                    void navigate(`/settings/${item.path}`, { replace: true });
                  }}
                >
                  <span className='settings-mobile-top-nav__icon'>{item.icon}</span>
                  <span className='settings-mobile-top-nav__label'>{item.label}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className={contentClass}>{children}</div>
      </div>
    </SettingsViewModeProvider>
  );
};

export default SettingsPageWrapper;
