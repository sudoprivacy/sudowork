import { ipcBridge } from '@/common';
import { FitAddon } from '@xterm/addon-fit';
import { Tooltip } from '@arco-design/web-react';
import { Add, Close } from '@icon-park/react';
import React, { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Terminal } from 'xterm';
import 'xterm/css/xterm.css';

type TerminalTab = {
  id: string;
  sessionId: string | null;
};

type ConvState = {
  tabs: TerminalTab[];
  activeTabId: string | null;
};

type StoredRuntime = {
  terminal: Terminal;
  fitAddon: FitAddon;
  ownerConvKey: string;
  cleanup: () => void;
};

type TerminalPanelProps = {
  cwd?: string;
  active?: boolean;
  conversationId?: string;
};

const PER_CONV_TAB_LIMIT = 10;
const FALLBACK_CONV_KEY = '__global__';

// ── Module-scope state ────────────────────────────────────────────────────────
//
// IMPORTANT: ChatSider is remounted by React on every conversation switch
// (verified via BrowserPanelCDP webview destroy/register logs). So state held
// in component refs is wiped on every switch. To get the "switch back and still
// see tabs and history" behavior (Q1 in the design doc), we hoist:
//   - conversation tab state
//   - xterm runtimes (and their DOM elements)
//   - the global terminal.exit listener
// to module scope. The component is a thin view that reads/writes this state
// and reattaches xterm DOM elements to fresh containers on every mount.

const moduleStates = new Map<string, ConvState>();
const moduleRuntimes = new Map<string, StoredRuntime>(); // key: tabId
const moduleListeners = new Set<() => void>();

function notifyListeners(): void {
  for (const l of moduleListeners) l();
}

function getOrCreateConvState(convKey: string): ConvState {
  let state = moduleStates.get(convKey);
  if (!state) {
    state = { tabs: [], activeTabId: null };
    moduleStates.set(convKey, state);
  }
  return state;
}

/** Look up which tab a sessionId belongs to (across all conversations). */
function findTabBySessionId(sessionId: string): { convKey: string; tab: TerminalTab } | null {
  for (const [convKey, state] of moduleStates.entries()) {
    const tab = state.tabs.find((t) => t.sessionId === sessionId);
    if (tab) return { convKey, tab };
  }
  return null;
}

// One process-wide listener for terminal.exit so that ConvState stays accurate
// even while no TerminalPanel is mounted (e.g. user has the workspace tab
// open instead). Cleanup of xterm/runtime is left to user actions (closeTab)
// and conversation deletion (handled externally via closeByConversation IPC).
let exitListenerInstalled = false;
function ensureExitListener(): void {
  if (exitListenerInstalled) return;
  exitListenerInstalled = true;
  ipcBridge.terminal.exit.on(({ sessionId }) => {
    const found = findTabBySessionId(sessionId);
    if (!found) return;
    // Leave the tab in place — user sees `[exit N]` written by the active
    // runtime if mounted, and can manually close the tab. We do clear the
    // sessionId so the panel will spawn a fresh PTY if the user re-attaches.
    // But that's currently disabled because xterm shows the [exit N] marker,
    // and respawning would overwrite history. So just no-op here.
    void found;
  });
}

// ── helpers ───────────────────────────────────────────────────────────────────

const getThemeColor = (name: string, fallback: string): string => {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};

const createTab = (): TerminalTab => ({
  id: `terminal-tab-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  sessionId: null,
});

// ── Component ─────────────────────────────────────────────────────────────────

const TerminalPanel: React.FC<TerminalPanelProps> = ({ cwd, active = false, conversationId }) => {
  const { t } = useTranslation();

  ensureExitListener();

  // Subscribe to module-scope state changes so render is triggered when any
  // tab/state mutates from inside this component (or from another instance,
  // though only one mounts at a time today).
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    moduleListeners.add(forceUpdate);
    return () => {
      moduleListeners.delete(forceUpdate);
    };
  }, []);

  const convKey = conversationId ?? FALLBACK_CONV_KEY;
  const currentState = getOrCreateConvState(convKey);
  const tabs = currentState.tabs;
  const activeTabId = currentState.activeTabId ?? '';

  // Container refs are local to this component instance (one ref per render).
  // We re-attach xterm DOM elements to these containers in useLayoutEffect
  // below — runtimes themselves live in module scope.
  const terminalContainerRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const terminalScreenRef = useRef<HTMLDivElement | null>(null);

  const activeTabIdRef = useRef(activeTabId);
  const activePanelRef = useRef(active);
  const convKeyRef = useRef(convKey);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  useEffect(() => {
    activePanelRef.current = active;
  }, [active]);

  useEffect(() => {
    convKeyRef.current = convKey;
  }, [convKey]);

  const patchTab = useCallback((tabId: string, patch: Partial<TerminalTab>) => {
    for (const state of moduleStates.values()) {
      const idx = state.tabs.findIndex((t) => t.id === tabId);
      if (idx === -1) continue;
      state.tabs = state.tabs.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab));
      notifyListeners();
      return;
    }
  }, []);

  const resizeRuntime = useCallback((tabId: string) => {
    const runtime = moduleRuntimes.get(tabId);
    const container = terminalContainerRefs.current[tabId];
    if (!runtime || !container) return;
    // Find sessionId by tabId via module state.
    let sessionId: string | null = null;
    for (const state of moduleStates.values()) {
      const tab = state.tabs.find((t) => t.id === tabId);
      if (tab) {
        sessionId = tab.sessionId;
        break;
      }
    }
    if (!sessionId) return;

    requestAnimationFrame(() => {
      try {
        runtime.fitAddon.fit();
        void ipcBridge.terminal.resize.invoke({ sessionId, cols: runtime.terminal.cols, rows: runtime.terminal.rows });
      } catch (error) {
        console.error('[TerminalPanel] fit:error', error);
      }
    });
  }, []);

  // Disable stdin / blur on all runtimes whenever panel becomes inactive.
  useEffect(() => {
    for (const runtime of moduleRuntimes.values()) {
      runtime.terminal.options.disableStdin = !active;
      if (!active) runtime.terminal.blur();
    }
  }, [active]);

  useEffect(() => {
    if (active) return;
    const runtime = moduleRuntimes.get(activeTabId);
    runtime?.terminal.blur();
    terminalContainerRefs.current[activeTabId]?.querySelector('textarea')?.blur();
  }, [active, activeTabId]);

  useEffect(() => {
    if (!active) return;
    if (!activeTabId) return;
    const timer = window.setTimeout(() => resizeRuntime(activeTabId), 0);
    return () => window.clearTimeout(timer);
  }, [active, activeTabId, resizeRuntime]);

  useEffect(() => {
    const screenEl = terminalScreenRef.current;
    if (!screenEl) return;
    const observer = new ResizeObserver(() => {
      if (!activePanelRef.current) return;
      resizeRuntime(activeTabIdRef.current);
    });
    observer.observe(screenEl);
    return () => observer.disconnect();
  }, [resizeRuntime]);

  useEffect(() => {
    if (!active) return;
    if (!activeTabId) return;
    const timer = window.setTimeout(() => resizeRuntime(activeTabId), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convKey]);

  const attachRuntime = useCallback(
    async (tabId: string) => {
      const found = (() => {
        for (const [k, s] of moduleStates.entries()) {
          const t = s.tabs.find((tab) => tab.id === tabId);
          if (t) return { ownerConvKey: k, tab: t };
        }
        return null;
      })();
      if (!found) return;
      const { ownerConvKey, tab } = found;
      const container = terminalContainerRefs.current[tabId];
      if (!container) return;
      if (tab.sessionId) return; // already attached
      if (moduleRuntimes.has(tabId)) return; // race guard

      const res = await ipcBridge.terminal.create.invoke({
        cwd,
        conversationId: ownerConvKey === FALLBACK_CONV_KEY ? undefined : ownerConvKey,
      });
      if (!res?.success) {
        console.error('[TerminalPanel] create.failed', res?.msg);
        return;
      }

      const sessionId = res.data.sessionId;
      const terminal = new Terminal({
        cursorBlink: true,
        convertEol: true,
        fontFamily: 'ui-monospace, SFMono-Regular, SF Mono, Menlo, Monaco, Consolas, Liberation Mono, monospace',
        fontSize: 12,
        lineHeight: 1.45,
        scrollback: 5000,
        theme: {
          background: getThemeColor('--color-bg-1', '#161616'),
          foreground: getThemeColor('--color-text-1', '#f5f5f5'),
          cursor: getThemeColor('--ui-accent-orange', '#f59e0b'),
          selectionBackground: 'rgba(245, 158, 11, 0.25)',
        },
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.options.disableStdin = !activePanelRef.current;
      terminal.attachCustomKeyEventHandler(() => activePanelRef.current && tabId === activeTabIdRef.current && ownerConvKey === convKeyRef.current);
      terminal.open(container);

      const scheduleFit = () => resizeRuntime(tabId);
      const onData = terminal.onData((data: string) => {
        void ipcBridge.terminal.write.invoke({ sessionId, data });
      });
      const onOutput = ipcBridge.terminal.output.on((event) => {
        if (event.sessionId !== sessionId) return;
        terminal.write(event.data);
      });
      const onExit = ipcBridge.terminal.exit.on((event) => {
        if (event.sessionId !== sessionId) return;
        terminal.write(`\r\n[exit ${event.exitCode}]\r\n`);
      });
      const resizeObserver = new ResizeObserver(scheduleFit);
      window.addEventListener('resize', scheduleFit);
      resizeObserver.observe(container);

      const cleanup = () => {
        onData.dispose();
        onOutput();
        onExit();
        window.removeEventListener('resize', scheduleFit);
        resizeObserver.disconnect();
        terminal.dispose();
      };

      moduleRuntimes.set(tabId, { terminal, fitAddon, ownerConvKey, cleanup });
      patchTab(tabId, { sessionId });
      scheduleFit();
    },
    [cwd, patchTab, resizeRuntime]
  );

  const openTab = useCallback(() => {
    const state = getOrCreateConvState(convKey);
    if (state.tabs.length >= PER_CONV_TAB_LIMIT) {
      console.warn(`[TerminalPanel] per-conv tab limit reached (${PER_CONV_TAB_LIMIT})`);
      return;
    }
    const nextTab = createTab();
    state.tabs = [...state.tabs, nextTab];
    state.activeTabId = nextTab.id;
    notifyListeners();
  }, [convKey]);

  const closeTab = useCallback(
    (tabId: string) => {
      const state = getOrCreateConvState(convKey);
      const target = state.tabs.find((t) => t.id === tabId);
      const sessionIdToDispose = target?.sessionId || null;
      const nextTabs = state.tabs.filter((t) => t.id !== tabId);
      state.tabs = nextTabs;
      if (state.activeTabId === tabId) {
        state.activeTabId = nextTabs.length > 0 ? nextTabs[nextTabs.length - 1].id : null;
      }
      notifyListeners();

      const runtime = moduleRuntimes.get(tabId);
      runtime?.cleanup();
      moduleRuntimes.delete(tabId);
      delete terminalContainerRefs.current[tabId];

      if (sessionIdToDispose) {
        void ipcBridge.terminal.dispose.invoke({ sessionId: sessionIdToDispose });
      }
    },
    [convKey]
  );

  const setActiveTab = useCallback(
    (tabId: string) => {
      const state = getOrCreateConvState(convKey);
      state.activeTabId = tabId;
      notifyListeners();
    },
    [convKey]
  );

  // When activeTab needs a runtime (no sessionId yet), spawn one.
  useEffect(() => {
    if (!activeTabId) return;
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    if (tab.sessionId || moduleRuntimes.has(activeTabId)) {
      resizeRuntime(activeTabId);
      return;
    }
    void attachRuntime(activeTabId);
  }, [activeTabId, attachRuntime, resizeRuntime, tabs]);

  // Build the list of panes to render. Only render panes belonging to the
  // current conversation — we don't need to keep other conv panes mounted
  // because xterm runtimes are in module scope and we re-attach them on mount.
  const panes = tabs;

  // After every render, ensure each xterm's DOM element is attached to its
  // current React-rendered container. xterm.open() can only be called once,
  // but the underlying DOM element can be moved with appendChild — this is
  // what gives us "switch back and history is preserved" across conversation
  // switches that remount the entire component.
  useLayoutEffect(() => {
    for (const pane of panes) {
      const runtime = moduleRuntimes.get(pane.id);
      const container = terminalContainerRefs.current[pane.id];
      if (!runtime || !container) continue;
      if (runtime.terminal.element && runtime.terminal.element.parentNode !== container) {
        container.appendChild(runtime.terminal.element);
        try {
          runtime.fitAddon.fit();
        } catch {
          // ignore — container may not be visible yet
        }
      }
    }
  });

  return (
    <div className='terminal-root terminal-root--xterm'>
      <div className='terminal-root__header'>
        <div className='terminal-root__tabs'>
          {tabs.map((tab, index) => (
            <button
              key={tab.id}
              type='button'
              className={`terminal-root__tab ${tab.id === activeTabId ? 'terminal-root__tab--active' : ''}`}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => setActiveTab(tab.id)}
            >
              <span className='terminal-root__tab-label'>
                {t('conversation.rightPanel.terminal.tab', { defaultValue: 'Terminal' })} {index + 1}
              </span>
              <span
                role='button'
                tabIndex={-1}
                className='terminal-root__tab-close'
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab.id);
                }}
              >
                <Close size={11} />
              </span>
            </button>
          ))}
          <Tooltip content={t('conversation.rightPanel.terminal.newTab', { defaultValue: 'New terminal' })} position='bottom'>
            <button type='button' className='terminal-root__new-tab' onClick={openTab} aria-label={t('conversation.rightPanel.terminal.newTab', { defaultValue: 'New terminal' })}>
              <Add size={14} />
            </button>
          </Tooltip>
        </div>
      </div>
      <div ref={terminalScreenRef} className='terminal-root__screen terminal-root__screen--xterm'>
        {panes.map((tab) => (
          <div
            key={tab.id}
            ref={(node) => {
              terminalContainerRefs.current[tab.id] = node;
            }}
            className={`terminal-root__pane ${tab.id === activeTabId ? 'terminal-root__pane--active' : ''}`}
          />
        ))}
      </div>
    </div>
  );
};

export default TerminalPanel;
