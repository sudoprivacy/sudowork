/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { getAgentModes, supportsModeSwitch, type AgentModeOption } from '@/renderer/constants/agentModes';
import { useLayoutContext } from '@/renderer/context/LayoutContext';
import { iconColors } from '@/renderer/theme/colors';
import { getAgentLogo } from '@/renderer/utils/agentLogo';
import { Button, Dropdown, Menu, Message, Tooltip } from '@arco-design/web-react';
import { Down, Robot } from '@icon-park/react';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

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
    <Menu onClickMenuItem={(key) => void handleModeChange(key)}>
      <Menu.ItemGroup title={t('agentMode.switchMode', { defaultValue: 'Switch Mode' })}>
        {modes.map((mode: AgentModeOption) => (
          <Menu.Item key={mode.value} className={currentMode === mode.value ? '!bg-2' : ''}>
            <div className='flex items-center gap-8px'>
              {currentMode === mode.value && <span className='text-primary'>✓</span>}
              <span className={currentMode !== mode.value ? 'ml-16px' : ''}>{getDisplayModeLabel(mode)}</span>
            </div>
          </Menu.Item>
        ))}
      </Menu.ItemGroup>
    </Menu>
  );

  // Compact mode: render only mode label chip in sendbox area
  if (compact) {
    const legacyCompactBehavior = !showLogoInCompact && compactLabelType === 'mode';
    const baseCompactLabel = compactLabelType === 'agent' ? agentName || backend || 'Agent' : canSwitchMode ? getCurrentModeLabel() : agentName || backend || 'Agent';
    const compactLabel = compactLabelOverride || (compactLabelPrefix && compactLabelType !== 'agent' ? (hideCompactLabelPrefixOnMobile && isMobile ? baseCompactLabel : `${compactLabelPrefix} · ${baseCompactLabel}`) : baseCompactLabel);
    if (!canInteract && legacyCompactBehavior) {
      return null;
    }

    const compactContent = (
      <Button
        className={`sendbox-model-btn agent-mode-compact-pill ${canInteract ? '' : 'agent-mode-compact-pill--readonly'}`}
        shape='round'
        size='small'
        onClick={canInteract ? () => !isLoading && setDropdownVisible((visible) => !visible) : undefined}
        style={{
          opacity: isLoading ? 0.6 : 1,
          transition: 'opacity 0.2s',
          cursor: canInteract ? 'pointer' : 'default',
        }}
      >
        <span className='flex items-center gap-6px min-w-0 leading-none'>
          {compactLeadingIcon && <span className='shrink-0 inline-flex items-center'>{compactLeadingIcon}</span>}
          {showLogoInCompact && <span className='shrink-0 inline-flex items-center'>{renderLogo()}</span>}
          <span className='block truncate leading-none'>{compactLabel}</span>
          {canInteract && <Down size={12} className='text-t-tertiary shrink-0' />}
        </span>
      </Button>
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

  // Full mode: logo + name + optional mode label, hides text when space is tight.
  // 完整模式：logo + 名称 + 可选模式标签；空间不足时仅显示 logo。
  const displayName = agentName || backend || '';
  const modeLabel = getCurrentModeLabel();
  const showModeSuffix = canSwitchMode && currentMode !== defaultMode && Boolean(modeLabel);
  const tooltipLabel = showModeSuffix ? `${displayName} · ${modeLabel}` : displayName;

  const pill = (
    <AgentModePill
      renderLogo={renderLogo}
      displayName={displayName}
      modeLabel={modeLabel}
      showModeSuffix={showModeSuffix}
      showDropdownArrow={canSwitchMode}
      interactive={canSwitchMode}
      isLoading={isLoading}
      tooltipLabel={tooltipLabel}
    />
  );

  // If mode switching is not supported, just render the pill without dropdown
  if (!canSwitchMode) {
    return <div className='ml-16px'>{pill}</div>;
  }

  // Render dropdown with mode selection menu
  return (
    <div className='ml-16px'>
      <Dropdown trigger='click' popupVisible={dropdownVisible} onVisibleChange={(visible) => !isLoading && setDropdownVisible(visible)} droplist={dropdownMenu}>
        {pill}
      </Dropdown>
    </div>
  );
};

/**
 * AgentModePill — the visible full-mode pill with responsive text hiding.
 *
 * When horizontal space is tight (e.g. window narrows, right-side siblings
 * grow, or the conversation header is crowded), the agent name and mode
 * suffix are hidden entirely from the DOM render path, leaving only the logo
 * (and optional dropdown arrow). The full label is always surfaced on hover
 * via an Arco Tooltip.
 *
 * Implementation note: we render a visible pill plus an invisible "probe"
 * pill that always contains the full content at natural width. The probe's
 * width is compared against space available between the pill's stable left
 * edge and the viewport's right edge. Using the left edge (which doesn't
 * shift when we hide text, because previous siblings in the header don't
 * reflow horizontally) avoids the flip-flop that would otherwise happen if
 * we measured the shrunken pill's own width.
 *
 * 智能体模式胶囊 — 空间紧张时只显示 logo，悬停时通过 Tooltip 展示完整文字。
 */
interface AgentModePillProps {
  renderLogo: () => React.ReactNode;
  displayName: string;
  modeLabel: string;
  showModeSuffix: boolean;
  showDropdownArrow: boolean;
  interactive: boolean;
  isLoading: boolean;
  tooltipLabel: string;
}

const AgentModePill = React.forwardRef<HTMLDivElement, AgentModePillProps>(({ renderLogo, displayName, modeLabel, showModeSuffix, showDropdownArrow, interactive, isLoading, tooltipLabel, ...rest }, forwardedRef) => {
  const [hideText, setHideText] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);

  // Forward the ref to the container for Dropdown/Tooltip positioning.
  React.useImperativeHandle(forwardedRef, () => containerRef.current as HTMLDivElement);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const probe = probeRef.current;
    if (!container || !probe) return;

    const check = () => {
      // Pill's stable left edge (previous siblings' widths don't change when
      // we hide our text, so this stays put regardless of current state).
      const rect = container.getBoundingClientRect();
      // Natural width of the full pill (probe always renders full content).
      const needed = probe.scrollWidth;
      // Available horizontal space until the viewport's right edge.
      const viewportRight = document.documentElement.clientWidth;
      const available = viewportRight - rect.left - 8; // 8px safety margin
      setHideText(needed > available);
    };

    check();
    const ro = new ResizeObserver(check);
    ro.observe(container);
    ro.observe(document.documentElement);
    if (container.parentElement) ro.observe(container.parentElement);
    window.addEventListener('resize', check);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', check);
    };
  }, [displayName, modeLabel, showModeSuffix, showDropdownArrow]);

  const baseClass = `flex items-center gap-2 bg-2 rounded-full px-[8px] py-[2px] min-w-0 max-w-full overflow-hidden ${interactive ? 'cursor-pointer hover:bg-3' : ''}`;

  const renderContent = (forProbe: boolean) => (
    <>
      <span className='shrink-0 inline-flex items-center'>{renderLogo()}</span>
      {(forProbe || !hideText) && (
        <>
          <span className='text-sm text-t-primary whitespace-nowrap'>{displayName}</span>
          {showModeSuffix && <span className='text-xs text-t-tertiary whitespace-nowrap'>({modeLabel})</span>}
        </>
      )}
      {showDropdownArrow && <Down size={12} className='text-t-tertiary shrink-0' />}
    </>
  );

  return (
    <Tooltip content={tooltipLabel} position='bottom'>
      <div className='relative inline-flex max-w-full' {...rest}>
        <div ref={containerRef} className={baseClass} style={{ opacity: isLoading ? 0.6 : 1, transition: 'opacity 0.2s' }}>
          {renderContent(false)}
        </div>
        {/* Invisible probe: always renders the full content to measure natural width. */}
        <div
          ref={probeRef}
          aria-hidden='true'
          className={baseClass}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            visibility: 'hidden',
            pointerEvents: 'none',
            whiteSpace: 'nowrap',
            maxWidth: 'none',
            overflow: 'visible',
          }}
        >
          {renderContent(true)}
        </div>
      </div>
    </Tooltip>
  );
});
AgentModePill.displayName = 'AgentModePill';

export default AgentModeSelector;
