/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Dropdown, Menu } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useAddEventListener } from '@/renderer/utils/emitter';
import { ipcBridge } from '@/common';
import { STORAGE_KEYS } from '@/common/storageKeys';
import type { TChatConversation } from '@/common/storage';
import ChatWorkspace from './workspace';
import BrowserPanel from './right-panel/BrowserPanel';
import DeliverablesPanel from './right-panel/DeliverablesPanel';
import TerminalPanel from './right-panel/TerminalPanel';
import './workspace/workspace-card.css';

type RightPanelTab = 'workspace' | 'browser' | 'terminal' | 'deliverables';
type OverflowPanelTab = Extract<RightPanelTab, 'browser' | 'terminal'>;

const BUILTIN_RIGHT_PANEL_TABS: RightPanelTab[] = ['workspace', 'browser', 'terminal', 'deliverables'];
const OVERFLOW_PANEL_TABS: OverflowPanelTab[] = ['browser', 'terminal'];

/** Optional 5th tab (e.g. team members) — when omitted, ChatSider behaves exactly as before (附录 II P1-2). */
export interface ExtraPanelTab {
  id: string;
  label: React.ReactNode;
  node: React.ReactNode;
}

const ChatSider: React.FC<{
  conversation?: TChatConversation;
  extraTab?: ExtraPanelTab;
  isOverflowTabsEnabled?: boolean;
  onActiveTabChange?: (tabId: string) => void;
  teamId?: string;
}> = ({ conversation, extraTab, isOverflowTabsEnabled = false, onActiveTabChange, teamId }) => {
  const { t } = useTranslation();
  const storageKey = React.useMemo(() => (conversation?.id ? `${STORAGE_KEYS.RIGHT_PANEL_ACTIVE_TAB}:${conversation.id}` : null), [conversation?.id]);
  const isOverflowMode = isOverflowTabsEnabled && Boolean(extraTab);
  const [activeTab, setActiveTab] = React.useState<RightPanelTab | string>('workspace');
  const [promotedOverflowTab, setPromotedOverflowTab] = React.useState<OverflowPanelTab | null>(null);

  React.useEffect(() => {
    if (!storageKey) {
      setActiveTab('workspace');
      setPromotedOverflowTab(null);
      return;
    }

    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === 'workspace' || stored === 'browser' || stored === 'terminal' || stored === 'deliverables') {
        setActiveTab(stored);
        setPromotedOverflowTab(isOverflowMode && (stored === 'browser' || stored === 'terminal') ? stored : null);
        return;
      }
    } catch {
      // ignore
    }

    setActiveTab('workspace');
    setPromotedOverflowTab(null);
  }, [isOverflowMode, storageKey]);

  React.useEffect(() => {
    if (isOverflowMode) return;
    setPromotedOverflowTab(null);
  }, [isOverflowMode]);

  React.useEffect(() => {
    onActiveTabChange?.(activeTab);
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, activeTab);
    } catch {
      // ignore
    }
  }, [activeTab, onActiveTabChange, storageKey]);

  // When the AI generates an HTML file (or any caller asks to open a URL in
  // the right-panel browser), switch to the browser tab so the result is
  // visible. The BrowserPanel itself listens to the same event and opens the
  // tab — this hook is purely for visibility.
  const onBrowserOpen = React.useCallback(
    ({ switchTab }: { url: string; switchTab?: boolean }) => {
      if (switchTab === false) return;
      if (isOverflowMode) setPromotedOverflowTab('browser');
      setActiveTab('browser');
    },
    [isOverflowMode]
  );

  useAddEventListener('right-panel.browser.open', onBrowserOpen, [onBrowserOpen]);

  React.useEffect(() => {
    const unsubscribe = ipcBridge.rightPanelBrowser.open.on(onBrowserOpen);
    return () => {
      unsubscribe();
    };
  }, [onBrowserOpen]);

  const onOverflowTabSelect = React.useCallback((tab: OverflowPanelTab) => {
    setPromotedOverflowTab(tab);
    setActiveTab(tab);
  }, []);

  let workspaceNode: React.ReactNode = null;
  const extra = conversation?.extra as { workspace?: string; workspaceDisplayName?: string; backend?: string } | undefined;
  const workspace = extra?.workspace;

  if (conversation?.type === 'acp' && workspace) {
    workspaceNode = <ChatWorkspace conversation_id={conversation.id} workspace={workspace} workspaceDisplayName={extra.workspaceDisplayName} eventPrefix='acp' backend={extra.backend} />;
  } else if (conversation?.type === 'remote-agent') {
    workspaceNode = <ChatWorkspace conversation_id={conversation.id} workspace={workspace || conversation.id} workspaceDisplayName={extra?.workspaceDisplayName} eventPrefix='remote-agent' backend='remote-agent' dataSource='moss-session' readonly />;
  }

  const renderBuiltInTab = (tab: RightPanelTab) => {
    const isActive = activeTab === tab;
    return (
      <button key={tab} type='button' role='tab' aria-selected={isActive} className={`right-panel-tabs__item ${isActive ? 'right-panel-tabs__item--active' : ''}`} onClick={() => setActiveTab(tab)}>
        <span className='relative z-10'>{t(`conversation.rightPanel.tabs.${tab}`)}</span>
        <span aria-hidden='true' className='right-panel-tabs__indicator' />
      </button>
    );
  };

  const overflowMenuTabs = OVERFLOW_PANEL_TABS.filter((tab) => tab !== promotedOverflowTab);
  const overflowMenu = (
    <Menu onClickMenuItem={(key) => onOverflowTabSelect(key as OverflowPanelTab)}>
      {overflowMenuTabs.map((tab) => (
        <Menu.Item key={tab}>{t(`conversation.rightPanel.tabs.${tab}`)}</Menu.Item>
      ))}
    </Menu>
  );

  const renderOverflowTrigger = () => (
    <Dropdown trigger='click' position='br' droplist={overflowMenu} getPopupContainer={() => document.body} unmountOnExit={false}>
      <button type='button' className='right-panel-tabs__item right-panel-tabs__more-trigger' aria-label={t('common.ariaLabel.more', { defaultValue: t('common.more') })} aria-haspopup='menu'>
        <span className='right-panel-tabs__more-dots' aria-hidden='true'>
          <span className='right-panel-tabs__more-dot' />
          <span className='right-panel-tabs__more-dot' />
          <span className='right-panel-tabs__more-dot' />
        </span>
      </button>
    </Dropdown>
  );

  return (
    <>
      <div className='flex h-full min-h-0 flex-col bg-[var(--color-bg-1)]'>
        <div className={`right-panel-tabs ${isOverflowMode ? 'right-panel-tabs--overflow' : ''}`}>
          {isOverflowMode ? (
            <>
              <div className='right-panel-tabs__scroller'>
                {(['workspace', 'deliverables'] as RightPanelTab[]).map(renderBuiltInTab)}
                {extraTab ? (
                  <button type='button' role='tab' aria-selected={activeTab === extraTab.id} className={`right-panel-tabs__item ${activeTab === extraTab.id ? 'right-panel-tabs__item--active' : ''}`} onClick={() => setActiveTab(extraTab.id)}>
                    <span className='relative z-10'>{extraTab.label}</span>
                    <span aria-hidden='true' className='right-panel-tabs__indicator' />
                  </button>
                ) : null}
                {promotedOverflowTab ? renderBuiltInTab(promotedOverflowTab) : null}
              </div>
              <div className='right-panel-tabs__actions'>{renderOverflowTrigger()}</div>
            </>
          ) : (
            <>
              {BUILTIN_RIGHT_PANEL_TABS.map(renderBuiltInTab)}
              {extraTab ? (
                <button type='button' role='tab' aria-selected={activeTab === extraTab.id} className={`right-panel-tabs__item ${activeTab === extraTab.id ? 'right-panel-tabs__item--active' : ''}`} onClick={() => setActiveTab(extraTab.id)}>
                  <span className='relative z-10'>{extraTab.label}</span>
                  <span aria-hidden='true' className='right-panel-tabs__indicator' />
                </button>
              ) : null}
            </>
          )}
        </div>
        <div className='right-panel-stack'>
          <div className={`right-panel-stack__pane ${activeTab === 'workspace' ? 'right-panel-stack__pane--active' : ''}`}>{workspaceNode}</div>
          <div className={`right-panel-stack__pane ${activeTab === 'browser' ? 'right-panel-stack__pane--active' : ''}`}>
            <BrowserPanel active={activeTab === 'browser'} conversationId={conversation?.id} />
          </div>
          <div className={`right-panel-stack__pane ${activeTab === 'terminal' ? 'right-panel-stack__pane--active' : ''}`}>
            <TerminalPanel cwd={workspace} active={activeTab === 'terminal'} conversationId={conversation?.id} />
          </div>
          <div className={`right-panel-stack__pane ${activeTab === 'deliverables' ? 'right-panel-stack__pane--active' : ''}`}>
            <DeliverablesPanel conversationId={conversation?.id} teamId={teamId} active={activeTab === 'deliverables'} />
          </div>
          {extraTab ? <div className={`right-panel-stack__pane ${activeTab === extraTab.id ? 'right-panel-stack__pane--active' : ''}`}>{extraTab.node}</div> : null}
        </div>
      </div>
    </>
  );
};

export default ChatSider;
