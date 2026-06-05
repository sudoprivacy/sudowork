import { STORAGE_KEYS } from '@/common/storageKeys';
import WebviewHost from '@/renderer/components/WebviewHost';
import { Tooltip } from '@arco-design/web-react';
import { Add, Close } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type BrowserTab = {
  id: string;
  title: string;
  url: string;
};

const DEFAULT_URL = 'https://www.baidu.com/';

const createTab = (url: string, title?: string): BrowserTab => ({
  id: `browser-tab-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  title: title || url,
  url,
});

const BrowserPanel: React.FC<{ active?: boolean }> = ({ active = false }) => {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [tabs, setTabs] = useState<BrowserTab[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.RIGHT_PANEL_BROWSER_TABS);
      if (stored) {
        const parsed = JSON.parse(stored) as BrowserTab[];
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore
    }
    return [createTab(DEFAULT_URL, DEFAULT_URL)];
  });
  const [activeTabId, setActiveTabId] = useState<string>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.RIGHT_PANEL_BROWSER_ACTIVE_TAB);
      if (stored) return stored;
    } catch {
      // ignore
    }
    return tabs[0]?.id || '';
  });
  const activeTab = tabs.find((tab) => tab.id === activeTabId) || tabs[0];

  const partition = useMemo(() => 'persist:sudowork-right-panel-browser', []);

  const focusActiveWebview = useCallback(() => {
    const webview = panelRef.current?.querySelector('webview');
    try {
      (webview as HTMLElement | null)?.focus();
    } catch {
      // ignore focus timing issues
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.RIGHT_PANEL_BROWSER_TABS, JSON.stringify(tabs));
    } catch {
      // ignore
    }
  }, [tabs]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.RIGHT_PANEL_BROWSER_ACTIVE_TAB, activeTabId);
    } catch {
      // ignore
    }
  }, [activeTabId]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => {
      focusActiveWebview();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [active, activeTabId, focusActiveWebview]);

  const openNewTab = (url: string) => {
    const normalized = url.trim().startsWith('http://') || url.trim().startsWith('https://') ? url.trim() : `https://${url.trim()}`;
    const nextTab = createTab(normalized, normalized);
    setTabs((prev) => [...prev, nextTab]);
    setActiveTabId(nextTab.id);
  };

  const updateTabUrl = useCallback((tabId: string, nextUrl: string) => {
    setTabs((prev) => prev.map((tab) => (tab.id === tabId ? { ...tab, url: nextUrl, title: nextUrl } : tab)));
  }, []);

  const closeTab = (tabId: string) => {
    setTabs((prev) => {
      if (prev.length <= 1) return prev;
      const nextTabs = prev.filter((tab) => tab.id !== tabId);
      if (activeTabId === tabId) {
        const nextActive = nextTabs[nextTabs.length - 1] || nextTabs[0];
        if (nextActive) {
          setActiveTabId(nextActive.id);
        }
      }
      return nextTabs;
    });
  };

  return (
    <div className='flex h-full min-h-0 flex-1 flex-col'>
      <div className='flex flex-col border-b border-[var(--color-border-2)] flex-shrink-0'>
        <div className='browser-tabs overflow-x-auto'>
          {tabs.map((tab) => (
            <button key={tab.id} type='button' className={`browser-tabs__item ${tab.id === activeTabId ? 'browser-tabs__item--active' : ''}`} onClick={() => setActiveTabId(tab.id)}>
              <span className='max-w-160px truncate'>{tab.title}</span>
              {tabs.length > 1 && (
                <span
                  role='button'
                  tabIndex={-1}
                  className='browser-tabs__close'
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(tab.id);
                  }}
                >
                  <Close size={12} />
                </span>
              )}
              <span aria-hidden='true' className='browser-tabs__indicator' />
            </button>
          ))}
          <Tooltip content={t('conversation.rightPanel.browser.newTab')} position='bottom'>
            <button type='button' className='browser-tabs__new-tab' onClick={() => openNewTab(DEFAULT_URL)} aria-label={t('conversation.rightPanel.browser.newTab')}>
              <Add size={14} />
            </button>
          </Tooltip>
        </div>
      </div>
      <div ref={panelRef} className='flex min-h-0 flex-1' onMouseDown={focusActiveWebview} onPointerDown={focusActiveWebview}>
        {activeTab ? <WebviewHost key={activeTab.id} url={activeTab.url} partition={partition} className='h-full w-full flex-1 min-h-0' showNavBar onUrlChange={(nextUrl) => updateTabUrl(activeTab.id, nextUrl)} defaultZoomFactor={0.9} /> : null}
      </div>
    </div>
  );
};

export default BrowserPanel;
