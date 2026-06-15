/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import ActionChip from '@/renderer/components/ui/ActionChip';
import { getAgentModes, supportsModeSwitch, type AgentModeOption } from '@/renderer/utils/agentModes';
import { useLayoutContext } from '@/renderer/context/LayoutContext';
import { iconColors } from '@/renderer/theme/colors';
import { getAgentLogo } from '@/renderer/utils/agentLogo';
import { Dropdown, Message, Tooltip } from '@arco-design/web-react';
import { Down, Robot } from '@icon-park/react';
import classNames from 'classnames';
import React, { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Walk up the DOM tree to find the nearest ancestor that clips overflow.
 * The full-mode agent pill lives inside `.chat-layout-header` which has
 * `overflow-hidden`. When the workspace sidebar expands and shrinks that
 * header, we must measure against the header's right edge (not the viewport).
 *
 * 向上遍历 DOM 查找最近的裁剪祖先。当工作区侧边栏展开时，会话 header 会变窄，
 * 需要以 header 的右边界（而非视口）作为可用宽度基准。
 */
const findClipAncestor = (el: HTMLElement | null): HTMLElement | null => {
  let node: HTMLElement | null = el?.parentElement ?? null;
  while (node && node !== document.body && node !== document.documentElement) {
    const style = window.getComputedStyle(node);
    const overflowX = style.overflowX;
    const overflow = style.overflow;
    if (overflow === 'hidden' || overflow === 'clip' || overflowX === 'hidden' || overflowX === 'clip' || overflow === 'auto' || overflowX === 'auto') {
      return node;
    }
    node = node.parentElement;
  }
  return null;
};

export interface AgentModeSelectorProps {
  /** Agent backend type / 代理后端类型 */
  backend?: string;
  /** Display name for the agent / 代理显示名称 */
  agentName?: string;
  /** Custom agent logo (SVG path or emoji) / 自定义代理 logo */
  agentLogo?: string;
  /** Whether the logo is an emoji / logo 是否为 emoji */
  agentLogoIsEmoji?: boolean;
  /** Conversation ID for mode switching / 用于切换模式的会话 ID */
  conversationId?: string;
  /** Compact mode: only show mode label + dropdown, no logo/name / 紧凑模式：仅显示模式标签和下拉 */
  compact?: boolean;
  /** Show agent logo in compact mode / 紧凑模式是否显示代理图标 */
  showLogoInCompact?: boolean;
  /** Compact label content: mode label or agent name / 紧凑模式文案：模式名或代理名 */
  compactLabelType?: 'mode' | 'agent';
  /** Initial mode override (for Guid page pre-conversation selection) */
  initialMode?: string;
  /** Callback when mode is selected locally (no conversationId needed) */
  onModeSelect?: (mode: string) => void;
  /** Optional compact label override */
  compactLabelOverride?: string;
  /** Optional compact leading icon */
  compactLeadingIcon?: React.ReactNode;
  /** Optional display label formatter for mode options */
  modeLabelFormatter?: (mode: AgentModeOption) => string;
  /** Optional compact prefix text, e.g. "Permission" / "权限" */
  compactLabelPrefix?: string;
  /** Hide compact prefix on mobile */
  hideCompactLabelPrefixOnMobile?: boolean;
}

/**
 * AgentModeSelector - A dropdown component for switching agent modes
 * Displays agent logo and name, with dropdown menu for mode selection
 *
 * 代理模式选择器 - 用于切换代理模式的下拉组件
 * 显示代理 logo 和名称，通过下拉菜单选择模式
 */
const AgentModeSelector: React.FC<AgentModeSelectorProps> = ({ backend, agentName, agentLogo, agentLogoIsEmoji, conversationId, compact, showLogoInCompact = false, compactLabelType = 'mode', initialMode, onModeSelect, compactLabelOverride, compactLeadingIcon, modeLabelFormatter, compactLabelPrefix, hideCompactLabelPrefixOnMobile = false }) => {
  const { t } = useTranslation();
  const layout = useLayoutContext();
  const isMobile = Boolean(layout?.isMobile);
  const modes = getAgentModes(backend);
  const defaultMode = modes[0]?.value ?? 'default';
  // Validate initialMode against available modes; fall back to backend's default
  // when the provided value doesn't match (e.g. opencode has 'build'/'plan', not 'default')
  const validInitialMode = initialMode && modes.some((m) => m.value === initialMode) ? initialMode : defaultMode;
  const [currentMode, setCurrentMode] = useState<string>(validInitialMode);
  const [isLoading, setIsLoading] = useState(false);
  const [dropdownVisible, setDropdownVisible] = useState(false);
  const getDisplayModeLabel = useCallback((mode: AgentModeOption) => modeLabelFormatter?.(mode) ?? mode.label, [modeLabelFormatter]);

  const canSwitchMode = supportsModeSwitch(backend) && (conversationId || onModeSelect);
  // Mobile conversation header agent pill is display-only by design.
  const canInteract = canSwitchMode && !(compact && compactLabelType === 'agent');

  // When initialMode prop changes (e.g. agent switch on Guid page), update local state.
  // Validate against available modes to handle backends with non-standard default
  // (e.g. opencode uses 'build' instead of 'default').
  useEffect(() => {
    if (initialMode !== undefined) {
      const valid = modes.some((m) => m.value === initialMode) ? initialMode : defaultMode;
      setCurrentMode(valid);
    }
  }, [initialMode, modes, defaultMode]);

  // Sync mode from backend when mounting or switching conversation tabs
  useEffect(() => {
    if (!conversationId || !canSwitchMode) return;
    let cancelled = false;

    ipcBridge.acpConversation.getMode
      .invoke({ conversationId })
      .then((result) => {
        if (!cancelled && result.success && result.data) {
          // Only sync from backend when manager is initialized;
          // before first message, getMode returns { mode: 'default', initialized: false }
          // which would overwrite the correct initialMode (e.g. opencode has no 'default').
          if (result.data.initialized !== false) {
            setCurrentMode(result.data.mode);
          }
        }
      })
      .catch(() => {
        // Silent fail, keep current state
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId, canSwitchMode]);

  const handleModeChange = useCallback(
    async (mode: string) => {
      // Close dropdown immediately after selection
      setDropdownVisible(false);

      if (mode === currentMode) return;

      // Local mode (Guid page): update state and notify parent, no IPC needed
      if (!conversationId && onModeSelect) {
        setCurrentMode(mode);
        onModeSelect(mode);
        return;
      }

      if (!conversationId) return;

      setIsLoading(true);
      try {
        const result = await ipcBridge.acpConversation.setMode.invoke({
          conversationId,
          mode,
        });

        if (result.success) {
          setCurrentMode(result.data?.mode ?? mode);
          Message.success('Mode switched');
        } else {
          const errorMsg = result.msg || 'Switch failed';
          console.warn('[AgentModeSelector] Mode switch failed:', errorMsg);
          Message.warning(errorMsg);
        }
      } catch (error) {
        console.error('[AgentModeSelector] Failed to switch mode:', error);
        Message.error('Switch failed');
      } finally {
        setIsLoading(false);
      }
    },
    [conversationId, currentMode, onModeSelect]
  );

  // Render logo based on source
  const renderLogo = () => {
    const logoContent = (() => {
      if (agentLogo) {
        if (agentLogoIsEmoji) {
          return <span className='text-14px leading-none'>{agentLogo}</span>;
        }
        return <img src={agentLogo} alt={`${agentName || 'agent'} logo`} className='block w-16px h-16px object-contain' />;
      }
      const logo = getAgentLogo(backend);
      if (logo) {
        return <img src={logo} alt={`${backend} logo`} className='block w-16px h-16px object-contain' />;
      }
      return <Robot theme='outline' size={16} fill={iconColors.primary} />;
    })();

    return <span className='inline-flex w-16px h-16px items-center justify-center shrink-0 leading-none'>{logoContent}</span>;
  };

  // Get display label for current mode
  const getCurrentModeLabel = () => {
    const modeOption = modes.find((m) => m.value === currentMode);
    return modeOption ? getDisplayModeLabel(modeOption) : '';
  };

  // Dropdown menu (shared between compact and full mode)
  const dropdownMenu = (
    <div className='flex flex-col gap-2px p-6px rd-12px border bg-popup' style={{ minWidth: 180, boxShadow: '0 8px 28px rgba(0, 0, 0, 0.12)' }}>
      <div className='px-10px py-2 text-12px leading-18px text-t-secondary'>{t('agentMode.switchMode', { defaultValue: 'Switch Mode' })}</div>
      {modes.map((mode: AgentModeOption) => {
        const active = currentMode === mode.value;
        return (
          <div key={mode.value} className={classNames('flex items-center gap-8px px-10px h-38px rd-8px cursor-pointer text-14px text-t-primary transition-colors hover:bg-hover active:bg-active', active && 'bg-2')} onClick={() => void handleModeChange(mode.value)}>
            <span className='w-16px shrink-0 inline-flex items-center justify-center text-primary'>{active ? '✓' : ''}</span>
            <span className='truncate'>{getDisplayModeLabel(mode)}</span>
          </div>
        );
      })}
    </div>
  );

  // Compact mode: render only mode label chip in sendbox area
  if (compact) {
    const legacyCompactBehavior = !showLogoInCompact && compactLabelType === 'mode';
    const baseCompactLabel = compactLabelType === 'agent' ? agentName || backend || 'Agent' : canSwitchMode ? getCurrentModeLabel() : agentName || backend || 'Agent';
    const compactLabel = compactLabelOverride || (compactLabelPrefix && compactLabelType !== 'agent' ? (hideCompactLabelPrefixOnMobile && isMobile ? baseCompactLabel : `${compactLabelPrefix} · ${baseCompactLabel}`) : baseCompactLabel);
    if (!canInteract && legacyCompactBehavior) {
      return null;
    }

    const compactIcon = compactLeadingIcon || (showLogoInCompact ? renderLogo() : undefined);

    const compactContent = (
      <ActionChip
        className={canInteract ? '' : 'agent-mode-compact-pill--readonly'}
        icon={compactIcon}
        label={
          <span className='inline-flex min-w-0 items-center gap-6px'>
            <span className='block truncate leading-none'>{compactLabel}</span>
            {canInteract && <Down size={12} className='text-t-tertiary shrink-0' />}
          </span>
        }
        disabled={isLoading}
        onClick={canInteract ? () => !isLoading && setDropdownVisible((visible) => !visible) : undefined}
      />
    );

    if (!canInteract) {
      return compactContent;
    }

    return (
      <Dropdown trigger='click' popupVisible={dropdownVisible} onVisibleChange={(visible) => !isLoading && setDropdownVisible(visible)} droplist={dropdownMenu}>
        {compactContent}
      </Dropdown>
    );
  }

  // Full mode: logo + name + optional mode label.
  // When the pill cannot fit in its clipping ancestor (e.g. the conversation
  // header narrows because the workspace sidebar is expanded), hide the text
  // entirely so only the logo remains. Hover always reveals the full label.
  const displayName = agentName || backend || '';
  const modeSuffix = canSwitchMode && currentMode !== defaultMode ? getCurrentModeLabel() : '';
  const tooltipLabel = modeSuffix ? `${displayName} · ${modeSuffix}` : displayName;

  const pill = <AgentModePill canSwitchMode={Boolean(canSwitchMode)} isLoading={isLoading} displayName={displayName} modeSuffix={modeSuffix} renderLogo={renderLogo} />;

  // If mode switching is not supported, just render the pill (no dropdown) but keep tooltip.
  // Note: outer wrapper has NO overflow-hidden — we want `findClipAncestor` to land
  // on the real bounding container (`.chat-layout-header`), not this wrapper.
  if (!canSwitchMode) {
    return (
      <div className='ml-16px'>
        <Tooltip content={tooltipLabel} position='bottom'>
          {pill}
        </Tooltip>
      </div>
    );
  }

  // Render dropdown with mode selection menu + tooltip
  return (
    <div className='ml-16px'>
      <Tooltip content={tooltipLabel} position='bottom'>
        <Dropdown trigger='click' popupVisible={dropdownVisible} onVisibleChange={(visible) => !isLoading && setDropdownVisible(visible)} droplist={dropdownMenu}>
          {pill}
        </Dropdown>
      </Tooltip>
    </div>
  );
};

/**
 * Internal pill component for the full (non-compact) AgentModeSelector.
 *
 * Uses a hidden probe that always renders the full content at its natural
 * width, then compares the probe's scrollWidth against the available space
 * between the pill's left edge and the clipping ancestor's right edge. When
 * the full content would overflow, we hide the text entirely (logo stays
 * visible). Measurement is reversible — widening restores text.
 *
 * Critical detail: on initial mount, layout often settles across several
 * frames (fonts, flex computation, workspace-sidebar width application). A
 * single synchronous `useLayoutEffect` measurement can read stale values
 * while the workspace is still expanding. We re-check across multiple
 * phases (rAF x2, setTimeout 100/300/800ms) plus observe the clipping
 * ancestor so any later reflow is also caught.
 */
interface AgentModePillProps {
  canSwitchMode: boolean;
  isLoading: boolean;
  displayName: string;
  modeSuffix: string;
  renderLogo: () => React.ReactNode;
}

const AgentModePill = forwardRef<HTMLDivElement, AgentModePillProps>(function AgentModePill({ canSwitchMode, isLoading, displayName, modeSuffix, renderLogo }, forwardedRef) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const probeRef = useRef<HTMLSpanElement | null>(null);
  const [hideText, setHideText] = useState(false);

  // Combine forwarded ref (for Arco Dropdown trigger) with local container ref.
  const setContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      containerRef.current = node;
      if (typeof forwardedRef === 'function') {
        forwardedRef(node);
      } else if (forwardedRef) {
        (forwardedRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }
    },
    [forwardedRef]
  );

  useLayoutEffect(() => {
    const check = () => {
      const container = containerRef.current;
      const probe = probeRef.current;
      if (!container || !probe) return;
      const rect = container.getBoundingClientRect();
      // Skip when container isn't laid out yet (still mounting offscreen).
      if (rect.width === 0 && rect.height === 0) return;
      const needed = probe.scrollWidth;
      if (needed === 0) return; // probe not measured yet
      const clipAncestor = findClipAncestor(container);
      const clipRight = clipAncestor ? clipAncestor.getBoundingClientRect().right : document.documentElement.clientWidth;
      // Leave 8px breathing room on the right edge.
      const available = clipRight - rect.left - 8;
      setHideText(needed > available);
    };

    // Immediate synchronous check.
    check();

    // Multi-phase re-checks to catch layout settling after initial mount:
    // rAF (after current paint), rAF→rAF (after next paint), then short timeouts
    // to cover font loading / workspace sidebar width application / late reflows.
    const rafIds: number[] = [];
    const raf1 = requestAnimationFrame(() => {
      check();
      const raf2 = requestAnimationFrame(check);
      rafIds.push(raf2);
    });
    rafIds.push(raf1);
    const timeoutIds: number[] = [window.setTimeout(check, 100), window.setTimeout(check, 300), window.setTimeout(check, 800)];

    // Observe the container, its parent, the clipping ancestor, and the root
    // element. Any of these resizing (workspace sidebar toggle, window resize,
    // sidebar reflow) should trigger a re-check.
    const ro = new ResizeObserver(check);
    const container = containerRef.current;
    if (container) {
      ro.observe(container);
      if (container.parentElement) ro.observe(container.parentElement);
      const clipAncestor = findClipAncestor(container);
      if (clipAncestor) ro.observe(clipAncestor);
    }
    ro.observe(document.documentElement);

    const onResize = () => check();
    window.addEventListener('resize', onResize);

    // Re-check once fonts have loaded — font metrics can change natural width.
    let fontsCancelled = false;
    const fonts = (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts;
    if (fonts?.ready && typeof fonts.ready.then === 'function') {
      fonts.ready
        .then(() => {
          if (!fontsCancelled) check();
        })
        .catch(() => {
          // Ignore font loading errors
        });
    }

    return () => {
      rafIds.forEach((id) => cancelAnimationFrame(id));
      timeoutIds.forEach((id) => window.clearTimeout(id));
      ro.disconnect();
      window.removeEventListener('resize', onResize);
      fontsCancelled = true;
    };
  }, [displayName, modeSuffix, canSwitchMode]);

  return (
    <div ref={setContainerRef} className={`relative inline-flex items-center gap-2 bg-2 rounded-full px-[8px] py-[2px] ${canSwitchMode ? 'cursor-pointer hover:bg-3' : ''}`} style={{ opacity: isLoading ? 0.6 : 1, transition: 'opacity 0.2s' }}>
      <span className='shrink-0 inline-flex items-center'>{renderLogo()}</span>
      {!hideText && (
        <>
          <span className='text-sm text-t-primary whitespace-nowrap'>{displayName}</span>
          {canSwitchMode && modeSuffix && <span className='text-xs text-t-tertiary whitespace-nowrap'>({modeSuffix})</span>}
        </>
      )}
      {canSwitchMode && <Down size={12} className='text-t-tertiary shrink-0' />}

      {/* Hidden probe: always renders the full content at natural width.
          Used by the layout effect above to decide whether to hide text. */}
      <span
        ref={probeRef}
        aria-hidden='true'
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          visibility: 'hidden',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          overflow: 'visible',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '2px 8px',
        }}
      >
        <span className='shrink-0 inline-flex items-center'>{renderLogo()}</span>
        <span className='text-sm whitespace-nowrap'>{displayName}</span>
        {canSwitchMode && modeSuffix && <span className='text-xs whitespace-nowrap'>({modeSuffix})</span>}
        {canSwitchMode && <Down size={12} className='shrink-0' />}
      </span>
    </div>
  );
});

export default AgentModeSelector;
