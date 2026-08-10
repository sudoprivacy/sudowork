/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { FileText, Library, MessageCirclePlus } from 'lucide-react';
import React, { Suspense, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import WorkspaceGroupedHistory from '@renderer/pages/conversation/WorkspaceGroupedHistory';
import SettingsSider from './SettingsSider';
import SidebarNavItem from './SidebarNavItem';
import SiderFooter from './SiderFooter';

export default function Sider({ onNewConversation }: ISiderProps) {
  // 侧栏收起由外层 ArcoLayout.Sider 把宽度动画到 0 整体隐藏，内容始终保持展开态，
  // 因此这里不再处理收起态的布局分支。
  const { pathname, search, hash } = useLocation();

  const { t } = useTranslation();
  const navigate = useNavigate();
  const isSettings = pathname.startsWith('/settings');
  const lastNonSettingsPathRef = useRef('/guid');
  const mainMenuItems: IMainMenuItem[] = [
    {
      id: 'new-conversation',
      label: t('common.siderMenu.newConversation'),
      icon: <MessageCirclePlus />,
      path: '/guid',
      onClick: onNewConversation,
    },
    {
      id: 'bid',
      label: t('common.siderMenu.bidGeneration'),
      icon: <FileText />,
      path: '/bid',
    },
    {
      id: 'asset-library',
      label: t('common.siderMenu.assetLibrary'),
      icon: <Library />,
      path: '/asset-library',
    },
  ];

  const workspaceHistoryProps = {
    collapsed: false,
    tooltipEnabled: false,
    activeTab: 'timeline' as const,
  };

  useEffect(() => {
    if (!pathname.startsWith('/settings')) {
      lastNonSettingsPathRef.current = `${pathname}${search}${hash}`;
    }
  }, [pathname, search, hash]);

  const onBackToMain = () => {
    void navigate(lastNonSettingsPathRef.current || '/guid');
  };

  return (
    <div className='size-full flex flex-col'>
      {/* Main content area */}
      <div className='min-h-0 flex-1 overflow-y-auto pt-1 box-border scrollbar-hide'>
        {isSettings ? (
          <Suspense fallback={<div className='size-full' />}>
            <SettingsSider />
          </Suspense>
        ) : (
          <div className='h-full min-h-0 flex flex-col overflow-hidden'>
            <div className='flex shrink-0 flex-col gap-0.5'>
              {mainMenuItems.map((item) => (
                <SidebarNavItem
                  key={item.id}
                  icon={React.cloneElement(item.icon, { size: 20, strokeWidth: 1.8 })}
                  label={item.label}
                  selected={pathname === item.path}
                  onClick={() => {
                    if (item.onClick) {
                      item.onClick();
                    } else {
                      void navigate(item.path);
                    }
                  }}
                />
              ))}
            </div>

            <div className='flex min-h-24 flex-1 flex-col mt-2 border-t border-medium pt-2'>
              <Suspense fallback={<div className='size-full' />}>
                <WorkspaceGroupedHistory {...workspaceHistoryProps} collapsed={false} />
              </Suspense>
            </div>
          </div>
        )}
      </div>

      <SiderFooter isSettings={isSettings} onBackToMain={onBackToMain} />
    </div>
  );
}

interface ISiderProps {
  onNewConversation: () => void;
}

interface IMainMenuItem {
  id: string;
  label: string;
  icon: React.ReactElement<{ size?: number; strokeWidth?: number }>;
  path: string;
  onClick?: () => void;
}
