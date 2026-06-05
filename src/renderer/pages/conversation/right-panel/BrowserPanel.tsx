import { STORAGE_KEYS } from '@/common/storageKeys';
import { ipcBridge } from '@/common';
import { BROWSER_PANEL_PARTITION, DEFAULT_BROWSER_PANEL_HOMEPAGE, normalizeBrowserUrl } from '@/common/browserPanelUrl';
import WebviewHost from '@/renderer/components/WebviewHost';
import { useAddEventListener } from '@/renderer/utils/emitter';
import { Message, Modal, Tooltip } from '@arco-design/web-react';
import { Add, Close, Delete } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type BrowserTab = {
  id: string;
  title: string;
  url: string;
};

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
    return [createTab(DEFAULT_BROWSER_PANEL_HOMEPAGE, DEFAULT_BROWSER_PANEL_HOMEPAGE)];
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
  // Default URL used for new-tab and initial first tab — fetched from system settings on mount.
  const [defaultUrl, setDefaultUrl] = useState<string>(DEFAULT_BROWSER_PANEL_HOMEPAGE);
  const [reloadEpoch, setReloadEpoch] = useState(0); // bump to force-reload all tabs after cache clear
  const partition = useMemo(() => BROWSER_PANEL_PARTITION, []);

  useEffect(() => {
    let cancelled = false;
    ipcBridge.systemSettings.getBrowserDefaultUrl
      .invoke()
      .then((url) => {
        if (!cancelled && typeof url === 'string' && url.trim()) {
          setDefaultUrl(url);
        }
      })
      .catch(() => {
        // ignore — fall back to built-in homepage
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const focusActiveWebview = useCallback(() => {
    const webview = panelRef.current?.querySelector(`#${activeTabId} webview`);
    try {
      (webview as HTMLElement | null)?.focus();
    } catch {
      // ignore focus timing issues
    }
  }, [activeTabId]);

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
    if (activeTabId) {
      ipcBridge.browserPanel.setActiveTab.invoke({ tabId: activeTabId }).catch(() => {
        // ignore — main may not yet have the tab registered (race on first mount)
      });
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
    const normalized = normalizeBrowserUrl(url);
    if (!normalized) return;
    const nextTab = createTab(normalized, normalized);
    setTabs((prev) => [...prev, nextTab]);
    setActiveTabId(nextTab.id);
  };

  // Subscribe to "open in right-panel browser" — fired by the main process when
  // the AI writes an HTML file, and (later) by the /browser slash and MCP tools.
  // Listen on both the in-renderer emitter (for renderer-side dispatch) and the
  // IPC emitter (for main-process dispatch), mirroring the preview.open pattern.
  const handleOpenBrowserUrl = useCallback(({ url }: { url: string; switchTab?: boolean }) => {
    if (!url) return;
    openNewTab(url);
  }, []);

  useAddEventListener('right-panel.browser.open', handleOpenBrowserUrl, [handleOpenBrowserUrl]);

  useEffect(() => {
    const unsubscribe = ipcBridge.rightPanelBrowser.open.on(handleOpenBrowserUrl);
    return () => {
      unsubscribe();
    };
  }, [handleOpenBrowserUrl]);

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
    ipcBridge.browserPanel.unregisterTab.invoke({ tabId }).catch(() => {});
  };

  const handleClearCache = useCallback(() => {
    Modal.confirm({
      title: t('conversation.rightPanel.browser.clearCacheConfirmTitle'),
      content: t('conversation.rightPanel.browser.clearCacheConfirmContent'),
      okButtonProps: { status: 'danger' },
      onOk: async () => {
        const response = await ipcBridge.browserPanel.clearCache.invoke();
        if (response?.success) {
          Message.success(t('conversation.rightPanel.browser.clearCacheSuccess'));
          // Force every open tab to reload with the cleared session.
          setReloadEpoch((n) => n + 1);
        } else {
          Message.error(response?.msg || t('conversation.rightPanel.browser.clearCacheFailure'));
        }
      },
    });
  }, [t]);

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
            <button type='button' className='browser-tabs__new-tab' onClick={() => openNewTab(defaultUrl)} aria-label={t('conversation.rightPanel.browser.newTab')}>
              <Add size={14} />
            </button>
          </Tooltip>
          <Tooltip content={t('conversation.rightPanel.browser.clearCache')} position='bottom'>
            <button type='button' className='browser-tabs__new-tab' onClick={handleClearCache} aria-label={t('conversation.rightPanel.browser.clearCache')}>
              <Delete size={14} />
            </button>
          </Tooltip>
        </div>
      </div>
      <div ref={panelRef} className='flex min-h-0 flex-1 relative overflow-hidden' onMouseDown={focusActiveWebview} onPointerDown={focusActiveWebview}>
        {tabs.map((tab) => (
          <div key={tab.id} className='absolute inset-0' style={{ display: tab.id === activeTabId ? 'block' : 'none' }}>
            <WebviewHost
              id={`${tab.id}-${reloadEpoch}`}
              url={tab.url}
              partition={partition}
              className='h-full w-full flex-1 min-h-0'
              showNavBar
              onUrlChange={(nextUrl) => updateTabUrl(tab.id, nextUrl)}
              defaultZoomFactor={0.9}
              onWebContentsIdReady={(webContentsId) => {
                ipcBridge.browserPanel.registerTab.invoke({ tabId: tab.id, webContentsId }).catch(() => {
                  // Best-effort; the agent tools will fall back to "no tab" semantics.
                });
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default BrowserPanel;
