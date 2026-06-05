import { ipcBridge } from '@/common';
import { FitAddon } from '@xterm/addon-fit';
import { Tooltip } from '@arco-design/web-react';
import { Add, Close } from '@icon-park/react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Terminal } from 'xterm';
import 'xterm/css/xterm.css';

type TerminalTab = {
  id: string;
  sessionId: string | null;
};

type TerminalSessionRuntime = {
  terminal: Terminal;
  fitAddon: FitAddon;
  cleanup: () => void;
};

type TerminalPanelProps = {
  cwd?: string;
  active?: boolean;
};

const getThemeColor = (name: string, fallback: string): string => {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};

const createTab = (): TerminalTab => ({
  id: `terminal-tab-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  sessionId: null,
});

const TerminalPanel: React.FC<TerminalPanelProps> = ({ cwd, active = false }) => {
  const { t } = useTranslation();
  const [tabs, setTabs] = useState<TerminalTab[]>(() => [createTab()]);
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0]?.id || '');

  const terminalContainerRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const terminalScreenRef = useRef<HTMLDivElement | null>(null);
  const runtimeRefs = useRef<Record<string, TerminalSessionRuntime | undefined>>({});
  const activeTabIdRef = useRef(activeTabId);
  const activePanelRef = useRef(active);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  useEffect(() => {
    activePanelRef.current = active;
  }, [active]);

  const patchTab = useCallback((tabId: string, patch: Partial<TerminalTab>) => {
    setTabs((prev) => prev.map((tab) => (tab.id === tabId ? { ...tab, ...patch } : tab)));
  }, []);

  const resizeRuntime = useCallback(
    (tabId: string) => {
      const runtime = runtimeRefs.current[tabId];
      const container = terminalContainerRefs.current[tabId];
      const sessionId = tabs.find((tab) => tab.id === tabId)?.sessionId;
      if (!runtime || !container || !sessionId) return;

      requestAnimationFrame(() => {
        try {
          runtime.fitAddon.fit();
          void ipcBridge.terminal.resize.invoke({ sessionId, cols: runtime.terminal.cols, rows: runtime.terminal.rows });
        } catch (error) {
          console.error('[TerminalPanel] fit:error', error);
        }
      });
    },
    [tabs]
  );

  useEffect(() => {
    for (const runtime of Object.values(runtimeRefs.current)) {
      if (!runtime) continue;
      runtime.terminal.options.disableStdin = !active;
      if (!active) {
        runtime.terminal.blur();
      }
    }
  }, [active]);

  useEffect(() => {
    if (active) return;
    const runtime = runtimeRefs.current[activeTabId];
    runtime?.terminal.blur();
    terminalContainerRefs.current[activeTabId]?.querySelector('textarea')?.blur();
  }, [active, activeTabId]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setTimeout(() => {
      resizeRuntime(activeTabId);
    }, 0);
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

  const attachRuntime = useCallback(
    async (tabId: string) => {
      const tab = tabs.find((item) => item.id === tabId);
      const container = terminalContainerRefs.current[tabId];
      if (!tab || tab.sessionId || !container) return;

      const res = await ipcBridge.terminal.create.invoke({ cwd });
      if (!res?.success) return;

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
      terminal.attachCustomKeyEventHandler(() => activePanelRef.current && tabId === activeTabIdRef.current);
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

      runtimeRefs.current[tabId] = { terminal, fitAddon, cleanup };
      patchTab(tabId, { sessionId });
      scheduleFit();
    },
    [cwd, patchTab, resizeRuntime, tabs]
  );

  const openTab = () => {
    const nextTab = createTab();
    setTabs((prev) => [...prev, nextTab]);
    setActiveTabId(nextTab.id);
  };

  const closeTab = (tabId: string) => {
    let sessionIdToDispose: string | null = null;
    setTabs((prev) => {
      if (prev.length <= 1) return prev;
      const target = prev.find((item) => item.id === tabId);
      sessionIdToDispose = target?.sessionId || null;
      const nextTabs = prev.filter((item) => item.id !== tabId);
      if (activeTabIdRef.current === tabId) {
        const nextActive = nextTabs[nextTabs.length - 1] || nextTabs[0];
        if (nextActive) setActiveTabId(nextActive.id);
      }
      return nextTabs;
    });

    const runtime = runtimeRefs.current[tabId];
    runtime?.cleanup();
    delete runtimeRefs.current[tabId];
    delete terminalContainerRefs.current[tabId];

    if (sessionIdToDispose) {
      void ipcBridge.terminal.dispose.invoke({ sessionId: sessionIdToDispose });
    }
  };

  useEffect(() => {
    const activeTab = tabs.find((tab) => tab.id === activeTabId);
    if (!activeTab) return;

    void attachRuntime(activeTab.id);
    if (activeTab.sessionId) {
      resizeRuntime(activeTab.id);
    }
  }, [activeTabId, attachRuntime, resizeRuntime, tabs]);

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
              onClick={() => setActiveTabId(tab.id)}
            >
              <span className='terminal-root__tab-label'>
                {t('conversation.rightPanel.terminal.tab', { defaultValue: 'Terminal' })} {index + 1}
              </span>
              {tabs.length > 1 && (
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
              )}
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
        {tabs.map((tab) => (
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
