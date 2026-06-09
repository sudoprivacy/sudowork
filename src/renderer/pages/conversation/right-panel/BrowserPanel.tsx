import { ipcBridge } from '@/common';
import { BROWSER_PANEL_PARTITION, DEFAULT_BROWSER_PANEL_HOMEPAGE, normalizeBrowserUrl } from '@/common/browserPanelUrl';
import WebviewHost from '@/renderer/components/WebviewHost';
import { useAddEventListener } from '@/renderer/utils/emitter';
import { Message, Modal, Tooltip } from '@arco-design/web-react';
import { Add, Close, Delete } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type BrowserTab = {
  id: string;
  title: string;
  url: string;
};

type ConvBrowserState = {
  tabs: BrowserTab[];
  activeTabId: string;
};

const FALLBACK_CONV_KEY = '__global__';

const createTab = (url: string, title?: string): BrowserTab => ({
  id: `browser-tab-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  title: title || url,
  url,
});

const makeInitialState = (defaultUrl: string): ConvBrowserState => {
  const tab = createTab(defaultUrl, defaultUrl);
  return { tabs: [tab], activeTabId: tab.id };
};

// Module-level per-conversation state. Keyed by `convKey =
// conversationId ?? '__global__'`. Survives across BrowserPanel unmounts
// (e.g. when the user switches conversations) so each conv's tab list and
// active tab return verbatim on re-entry. Same shape as the per-conv
// terminal store from feat/per-conversation-terminal (commit 76d19d5a).
const moduleStates = new Map<string, ConvBrowserState>();
const moduleListeners = new Set<() => void>();

function notifyListeners(): void {
  for (const l of moduleListeners) l();
}

function getOrCreateConvState(convKey: string, defaultUrl: string): ConvBrowserState {
  let state = moduleStates.get(convKey);
  if (!state) {
    state = makeInitialState(defaultUrl);
    moduleStates.set(convKey, state);
  }
  return state;
}

function dropConvBrowserState(convKey: string): void {
  if (moduleStates.delete(convKey)) {
    notifyListeners();
  }
}

interface BrowserPanelProps {
  active?: boolean;
  conversationId?: string;
}

const BrowserPanel: React.FC<BrowserPanelProps> = ({ active = false, conversationId }) => {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Settings — not per-conv. Stay in component-local useState.
  const [defaultUrl, setDefaultUrl] = useState<string>(DEFAULT_BROWSER_PANEL_HOMEPAGE);
  const [reloadEpoch, setReloadEpoch] = useState(0); // bump to force-reload all tabs after cache clear
  const partition = useMemo(() => BROWSER_PANEL_PARTITION, []);

  // Subscribe to the module-level store so this component re-renders when
  // any conv's state mutates. Keyed by useReducer's incrementing counter
  // pattern (same as TerminalPanel).
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    moduleListeners.add(forceUpdate);
    return () => {
      moduleListeners.delete(forceUpdate);
    };
  }, []);

  const convKey = conversationId ?? FALLBACK_CONV_KEY;
  const currentState = getOrCreateConvState(convKey, defaultUrl);
  const tabs = currentState.tabs;
  const activeTabId = currentState.activeTabId;

  // Fetch the user-configured default URL once on mount. Backfill it into
  // any conv state whose initial tab still points at DEFAULT_BROWSER_PANEL_HOMEPAGE
  // (avoids the first-tab racing with the settings fetch).
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

  // Inform main which tab is currently focused for this conversation. Main
  // uses this for the activeWebContentsId fallback when a tool call doesn't
  // explicitly pass a tabId.
  useEffect(() => {
    if (activeTabId) {
      ipcBridge.browserPanel.setActiveTab.invoke({ tabId: activeTabId, conversationId: conversationId || undefined }).catch(() => {
        // ignore — main may not yet have the tab registered (race on first mount)
      });
    }
  }, [activeTabId, conversationId]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => {
      focusActiveWebview();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [active, activeTabId, focusActiveWebview]);

  const setActiveTabId = useCallback(
    (tabId: string) => {
      const state = getOrCreateConvState(convKey, defaultUrl);
      if (state.activeTabId === tabId) return;
      state.activeTabId = tabId;
      notifyListeners();
    },
    [convKey, defaultUrl],
  );

  const openNewTab = useCallback(
    (url: string) => {
      const normalized = normalizeBrowserUrl(url);
      if (!normalized) return;
      const state = getOrCreateConvState(convKey, defaultUrl);
      const nextTab = createTab(normalized, normalized);
      state.tabs = [...state.tabs, nextTab];
      state.activeTabId = nextTab.id;
      notifyListeners();
    },
    [convKey, defaultUrl],
  );

  // Subscribe to "open in right-panel browser". Accept the emit when:
  //   - it carries no `conversationId` (unscoped — fsBridge file-write,
  //     /tab/open from sudowork-browser MCP, etc.); the currently mounted
  //     panel is the user-visible target, so handle it
  //   - it carries a `conversationId` matching this panel's convKey
  // Skip when the emit is scoped to a different conversation. This is the
  // filter that delivers the per-conv isolation: each BrowserPanel only
  // reacts to navigation emits intended for it.
  const handleOpenBrowserUrl = useCallback(
    (payload: { url: string; switchTab?: boolean; conversationId?: string }) => {
      if (!payload?.url) return;
      const emitConv = payload.conversationId;
      const isMatch = !emitConv || emitConv === convKey;
      if (!isMatch) return;
      openNewTab(payload.url);
    },
    [convKey, openNewTab],
  );

  useAddEventListener('right-panel.browser.open', handleOpenBrowserUrl, [handleOpenBrowserUrl]);

  useEffect(() => {
    const unsubscribe = ipcBridge.rightPanelBrowser.open.on(handleOpenBrowserUrl);
    return () => {
      unsubscribe();
    };
  }, [handleOpenBrowserUrl]);

  // Listen for "conversation deleted" cleanup from main (closeBrowserTabsByConversation
  // → ipcBridge.rightPanelBrowser.convClosed.emit). Drop the matching entry
  // from the module-level state so its tabs don't reappear if the user later
  // creates a new conversation that happens to reuse the same id (unlikely
  // given uuid ids, but cheap to be defensive).
  useEffect(() => {
    const unsubscribe = ipcBridge.rightPanelBrowser.convClosed.on((payload) => {
      if (!payload?.conversationId) return;
      dropConvBrowserState(payload.conversationId);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const updateTabUrl = useCallback(
    (tabId: string, nextUrl: string) => {
      const state = getOrCreateConvState(convKey, defaultUrl);
      const idx = state.tabs.findIndex((tab) => tab.id === tabId);
      if (idx < 0) return;
      if (state.tabs[idx].url === nextUrl) return;
      state.tabs = state.tabs.map((tab) => (tab.id === tabId ? { ...tab, url: nextUrl, title: nextUrl } : tab));
      notifyListeners();
    },
    [convKey, defaultUrl],
  );

  const closeTab = useCallback(
    (tabId: string) => {
      const state = getOrCreateConvState(convKey, defaultUrl);
      if (state.tabs.length <= 1) return;
      const nextTabs = state.tabs.filter((tab) => tab.id !== tabId);
      state.tabs = nextTabs;
      if (state.activeTabId === tabId) {
        const nextActive = nextTabs[nextTabs.length - 1] || nextTabs[0];
        if (nextActive) state.activeTabId = nextActive.id;
      }
      notifyListeners();
      ipcBridge.browserPanel.unregisterTab.invoke({ tabId }).catch(() => {});
    },
    [convKey, defaultUrl],
  );

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
                ipcBridge.browserPanel.registerTab.invoke({ tabId: tab.id, webContentsId, conversationId: conversationId || undefined }).catch(() => {
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
