/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/storage';
import { STORAGE_KEYS } from '@/common/storageKeys';
import { Message } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import ChatWorkspace from './workspace';
import BrowserPanel from './right-panel/BrowserPanel';
import TerminalPanel from './right-panel/TerminalPanel';
import './workspace/workspace-card.css';

type RightPanelTab = 'workspace' | 'browser' | 'terminal';

const ChatSider: React.FC<{
  conversation?: TChatConversation;
}> = ({ conversation }) => {
  const { t } = useTranslation();
  const [messageApi, messageContext] = Message.useMessage({ maxCount: 1 });
  const storageKey = React.useMemo(() => (conversation?.id ? `${STORAGE_KEYS.RIGHT_PANEL_ACTIVE_TAB}:${conversation.id}` : null), [conversation?.id]);
  const [activeTab, setActiveTab] = React.useState<RightPanelTab>('workspace');

  React.useEffect(() => {
    if (!storageKey) {
      setActiveTab('workspace');
      return;
    }

    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === 'workspace' || stored === 'browser' || stored === 'terminal') {
        setActiveTab(stored);
        return;
      }
    } catch {
      // ignore
    }

    setActiveTab('workspace');
  }, [storageKey]);

  React.useEffect(() => {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, activeTab);
    } catch {
      // ignore
    }
  }, [activeTab, storageKey]);

  let workspaceNode: React.ReactNode = null;
  const extra = conversation?.extra as { workspace?: string; workspaceDisplayName?: string; backend?: string } | undefined;
  const workspace = extra?.workspace;

  if (conversation?.type === 'acp' && workspace) {
    workspaceNode = <ChatWorkspace conversation_id={conversation.id} workspace={workspace} workspaceDisplayName={extra.workspaceDisplayName} eventPrefix='acp' backend={extra.backend} messageApi={messageApi} />;
  } else if (conversation?.type === 'remote-agent') {
    workspaceNode = <ChatWorkspace conversation_id={conversation.id} workspace={workspace || conversation.id} workspaceDisplayName={extra?.workspaceDisplayName} eventPrefix='remote-agent' backend='remote-agent' dataSource='moss-session' readonly messageApi={messageApi} />;
  }

  return (
    <>
      {messageContext}
      <div className='flex h-full min-h-0 flex-col bg-[var(--color-bg-1)]'>
        <div className='right-panel-tabs'>
          {(['workspace', 'browser', 'terminal'] as RightPanelTab[]).map((tab) => {
            const isActive = activeTab === tab;
            return (
              <button key={tab} type='button' role='tab' aria-selected={isActive} className={`right-panel-tabs__item ${isActive ? 'right-panel-tabs__item--active' : ''}`} onClick={() => setActiveTab(tab)}>
                <span className='relative z-10'>{t(`conversation.rightPanel.tabs.${tab}`)}</span>
                <span aria-hidden='true' className='right-panel-tabs__indicator' />
              </button>
            );
          })}
        </div>
        <div className='right-panel-stack'>
          <div className={`right-panel-stack__pane ${activeTab === 'workspace' ? 'right-panel-stack__pane--active' : ''}`}>{workspaceNode}</div>
          <div className={`right-panel-stack__pane ${activeTab === 'browser' ? 'right-panel-stack__pane--active' : ''}`}>
            <BrowserPanel active={activeTab === 'browser'} />
          </div>
          <div className={`right-panel-stack__pane ${activeTab === 'terminal' ? 'right-panel-stack__pane--active' : ''}`}>
            <TerminalPanel cwd={workspace} active={activeTab === 'terminal'} />
          </div>
        </div>
      </div>
    </>
  );
};

export default ChatSider;
