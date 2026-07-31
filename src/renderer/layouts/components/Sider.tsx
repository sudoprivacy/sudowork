/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { MessageCirclePlus } from 'lucide-react';
import classNames from 'classnames';
import React, { Suspense, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@arco-design/web-react';
import { cleanupSiderTooltips } from '@renderer/utils/siderTooltip';
import { emitter } from '@renderer/utils/emitter';
import { ConfigStorage } from '@common/storage';

import WorkspaceGroupedHistory from '@renderer/pages/conversation/WorkspaceGroupedHistory';
import SettingsSider from './SettingsSider';
import SiderFooter from './SiderFooter';

const Sider: React.FC = () => {
  // 侧栏收起由外层 ArcoLayout.Sider 把宽度动画到 0 整体隐藏，内容始终保持展开态，
  // 因此这里不再处理收起态的布局分支。
  const { pathname, search, hash } = useLocation();

  // 选中会话 / 触发导航后清理 tooltip 残留
  // Clean up tooltip remnants after selecting a session / navigating
  const onSessionClick = useCallback(() => {
    cleanupSiderTooltips();
  }, []);

  const { t } = useTranslation();
  const navigate = useNavigate();
  const isSettings = pathname.startsWith('/settings');
  const isNewConversationSelected = pathname === '/guid';
  const lastNonSettingsPathRef = useRef('/guid');

  const workspaceHistoryProps = {
    collapsed: false,
    tooltipEnabled: false,
    onSessionClick,
    activeTab: 'timeline' as const,
  };

  useEffect(() => {
    if (!pathname.startsWith('/settings')) {
      lastNonSettingsPathRef.current = `${pathname}${search}${hash}`;
    }
  }, [pathname, search, hash]);

  const onBackToMain = () => {
    cleanupSiderTooltips();
    void navigate(lastNonSettingsPathRef.current || '/guid');
    onSessionClick();
  };

  return (
    <div className='size-full flex flex-col'>
      {/* Main content area */}
      <div className='flex-1 min-h-0 overflow-y-auto scrollbar-hide'>
        {isSettings ? (
          <Suspense fallback={<div className='size-full' />}>
            <SettingsSider />
          </Suspense>
        ) : (
          <div className='h-full min-h-0 flex flex-col overflow-hidden pt-1 box-border'>
            <Button
              type='text'
              long
              className={classNames('h-9 shrink-0 justify-start! gap-2.5 px-2.5! rounded-lg! text-foreground! hover:bg-fill-default! active:bg-fill-deep!', isNewConversationSelected && 'bg-fill-medium!')}
              aria-current={isNewConversationSelected ? 'page' : undefined}
              onClick={() => {
                cleanupSiderTooltips();
                void ConfigStorage.set('guid.lastSelectedAgent', '');
                emitter.emit('guid.reset');
                void navigate('/guid');
                onSessionClick();
              }}
            >
              <MessageCirclePlus size={16} strokeWidth={2} className='shrink-0' />
              <span className='truncate text-sm font-500'>{t('conversation.welcome.newConversation')}</span>
            </Button>

            <div className='flex min-h-24 flex-1 flex-col mt-2'>
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
};

export default Sider;
