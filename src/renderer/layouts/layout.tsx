import { Layout as ArcoLayout } from '@arco-design/web-react';
import classNames from 'classnames';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LayoutContext } from '@renderer/context/LayoutContext';
import { useTenantConfig } from '@renderer/context/TenantConfigContext';
import { useDeepLink } from '@renderer/hooks/useDeepLink';
import { useDirectorySelection } from '@renderer/hooks/useDirectorySelection';
import { useMultiAgentDetection } from '@renderer/hooks/useMultiAgentDetection';
import { cleanupSiderTooltips } from '@renderer/utils/siderTooltip';
import { emitter } from '@renderer/utils/emitter';
import SudoworkIcon from '@renderer/assets/sudowork-icon-dark.svg';
import UpdateModal from '@renderer/layouts/components/UpdateModal';
import DebugPanel from '@renderer/layouts/components/DebugPanel';
import Sider from '@/renderer/layouts/components/Sider';
import Titlebar from '@/renderer/layouts/components/TitleBar';
import { ConfigStorage } from '@/common/storage';
import { ipcBridge } from '@/common';

const useDebug = () => {
  const [count, setCount] = useState(0);
  const timer = useRef<any>(null);
  const onClick = () => {
    const open = () => {
      ipcBridge.application.openDevTools.invoke().catch((error) => {
        console.error('Failed to open dev tools:', error);
      });
      setCount(0);
    };
    if (count >= 3) {
      return open();
    }
    setCount((prev) => {
      if (prev >= 2) {
        open();
        return 0;
      }
      return prev + 1;
    });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      clearTimeout(timer.current);
      setCount(0);
    }, 1000);
  };

  return { onClick };
};

const DEFAULT_SIDER_WIDTH = 260;
const isSiderBrandHidden = import.meta.env.DEV && import.meta.env.VITE_HIDE_SIDER_BRAND === 'true';

const Layout: React.FC = () => {
  const { t } = useTranslation();
  const { config } = useTenantConfig(); // 获取租户配置
  const [collapsed, setCollapsed] = useState(false);
  const { onClick } = useDebug();
  const navigate = useNavigate();
  // 点击侧栏顶部 logo / 应用名时回到新会话页，行为与「新会话」按钮一致
  // Clicking the sidebar-top logo / app name returns to the new conversation page, matching the "New Chat" button
  const goToNewConversation = useCallback(() => {
    cleanupSiderTooltips();
    // 清除持久化的 agent 选择，确保新会话时不恢复之前的助手
    void ConfigStorage.set('guid.lastSelectedAgent', '');
    // 触发 Guide 页面重置所有用户输入状态
    emitter.emit('guid.reset');
    void navigate('/guid');
  }, [navigate]);
  useMultiAgentDetection();
  const { contextHolder: directorySelectionContextHolder } = useDirectorySelection();
  useDeepLink();
  const location = useLocation();
  const workspaceAvailable = location.pathname.startsWith('/conversation/');

  // 清理侧栏 Tooltip 残留节点，避免路由切换后浮层卡在左上角
  useEffect(() => {
    cleanupSiderTooltips();
  }, [collapsed, location.pathname, location.search, location.hash]);

  // Bridge Main Process logs to F12 Console
  useEffect(() => {
    const unsubscribe = ipcBridge.application.logStream.on((entry) => {
      const prefix = `%c[Main:${entry.tag}]%c ${entry.message}`;
      const style = 'color:#7c3aed;font-weight:bold';
      if (entry.level === 'error') {
        console.error(prefix, style, 'color:inherit', ...(entry.data !== undefined ? [entry.data] : []));
      } else if (entry.level === 'warn') {
        console.warn(prefix, style, 'color:inherit', ...(entry.data !== undefined ? [entry.data] : []));
      } else {
        console.log(prefix, style, 'color:inherit', ...(entry.data !== undefined ? [entry.data] : []));
      }
    });
    return () => unsubscribe();
  }, []);

  const layoutContextValue = useMemo(() => ({ siderCollapsed: collapsed, setSiderCollapsed: setCollapsed }), [collapsed, setCollapsed]);

  return (
    <LayoutContext.Provider value={layoutContextValue}>
      <div className={classNames('app-shell relative flex flex-col size-full min-h-0', { 'app-shell--sider-divider': !collapsed })}>
        <Titlebar workspaceAvailable={workspaceAvailable} />

        <ArcoLayout className={'size-full layout flex-1 min-h-0'}>
          <ArcoLayout.Sider collapsedWidth={0} collapsed={collapsed} width={DEFAULT_SIDER_WIDTH} className='layout-sider'>
            {!isSiderBrandHidden && (
              <ArcoLayout.Header className='flex items-center justify-start py-2 px-4 pl-4.5 gap-2.5 layout-sider-header'>
                <div
                  className='shrink-0 size-8.5 relative rd-0.5rem f-center cursor-pointer'
                  onClick={() => {
                    onClick();
                    goToNewConversation();
                  }}
                  aria-label={t('common.ariaLabel.newConversation', '新会话')}
                >
                  <img src={config.logo || SudoworkIcon} alt={config.app_name} className='absolute inset-0 m-auto w-5 h-5 p-0.5 scale-130' style={{ objectFit: 'contain' }} />
                </div>
                <div className='flex-1 text-20px text-1 font-800 cursor-pointer' onClick={goToNewConversation}>
                  {config.app_name}
                </div>
              </ArcoLayout.Header>
            )}
            <ArcoLayout.Content className='p-2.5 layout-sider-content'>
              <Sider />
            </ArcoLayout.Content>
          </ArcoLayout.Sider>

          <ArcoLayout.Content className='bg-2 layout-content flex flex-col min-h-0 overflow-y-hidden'>
            <Outlet />
            {directorySelectionContextHolder}
            <UpdateModal />
            <DebugPanel />
          </ArcoLayout.Content>
        </ArcoLayout>
      </div>
    </LayoutContext.Provider>
  );
};

export default Layout;
