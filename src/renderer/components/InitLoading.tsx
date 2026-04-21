/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { init } from '@/common/ipcBridge';
import { useInit } from '../context/InitContext';
import WindowControls from './WindowControls';

// 运行时判断 / Runtime check
const isDesktopRuntime = typeof window !== 'undefined' && Boolean(window.electronAPI);

// 窗口控制按钮悬浮容器样式 / Floating container style for window controls
const WINDOW_CONTROLS_WRAPPER_STYLE: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  right: 0,
  zIndex: 9999,
  WebkitAppRegion: 'no-drag',
} as React.CSSProperties;

// ── Step definitions ─────────────────────────────────────────────────────────
type StepId = 'git' | 'node' | 'claude' | 'sudoclaw' | 'nexus' | 'bdpan';
type StepStatus = 'pending' | 'active' | 'done' | 'error';

interface Step {
  id: StepId;
  label: string;
  description: string;
}

const STEPS: Step[] = [
  { id: 'sudoclaw', label: 'Sudoclaw', description: 'AI 代理核心引擎' },
  { id: 'nexus', label: 'Nexus OS 核心引擎', description: '本地核心服务引擎' },
  { id: 'git', label: 'Git 环境', description: '版本控制基础组件' },
  { id: 'node', label: 'Node.js 运行时', description: 'JavaScript 执行环境' },
  { id: 'claude', label: 'Claude Code CLI', description: '命令行代理工具' },
  { id: 'bdpan', label: 'bdpan CLI', description: '文件同步工具' },
];

const STEP_ORDER: StepId[] = STEPS.map((s) => s.id);
const PRIMARY_STEP_IDS: StepId[] = ['sudoclaw', 'nexus'];
const PRIMARY_STEPS = STEPS.filter((step) => PRIMARY_STEP_IDS.includes(step.id));
const SECONDARY_STEPS = STEPS.filter((step) => !PRIMARY_STEP_IDS.includes(step.id));

// Braille spinner frames
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function getHeaderMessage(message: string | undefined, isReady: boolean, isError: boolean): string {
  if (isReady) return '所有组件就绪';
  if (isError) return '初始化失败';
  if (message === '正在启动核心服务...') return '核心服务启动中，请等待 Sudoclaw 与 Nexus 完成就绪';
  if (message === '正在校验组件状态...') return '正在确认核心服务状态，请稍候';
  if (!message || message === '组件安装中' || message === '正在并行准备运行环境...') return '正在准备运行环境...';
  return message;
}

function normalizeHeaderText(text: string): string {
  return text.replace(/[.。…！!？?\s]/g, '');
}

function deriveStepStatusFromMaps(stepId: StepId, stepStates: Partial<Record<string, StepStatus>> | undefined, currentStep: string | undefined, phase: string): StepStatus {
  if (phase === 'ready') return 'done';
  const explicitState = stepStates?.[stepId];
  if (explicitState) return explicitState;
  if (!currentStep) return 'pending';

  const currentIdx = STEP_ORDER.indexOf(currentStep as StepId);
  const stepIdx = STEP_ORDER.indexOf(stepId);

  if (currentIdx < 0) return 'pending';
  if (phase === 'error' && stepIdx === currentIdx) return 'error';
  if (stepIdx < currentIdx) return 'done';
  if (stepIdx === currentIdx) return 'active';
  return 'pending';
}

function getStepProgress(_stepId: StepId, stepStatus: StepStatus, currentProgress?: number): number {
  if (stepStatus === 'done') return 100;
  if (stepStatus === 'error') return currentProgress ?? 100;
  if (stepStatus === 'active') return currentProgress ?? 12;
  return currentProgress ?? 0;
}

function formatRetryMessage(retry?: { attempt: number; maxAttempts: number; nextRetryAt: number }, nowMs?: number): string | null {
  if (!retry) return null;
  const remainingSeconds = Math.max(0, Math.ceil((retry.nextRetryAt - (nowMs ?? Date.now())) / 1000));
  return `${remainingSeconds} 秒后自动重试（第 ${retry.attempt}/${retry.maxAttempts} 次）`;
}

function getStatusText(status: StepStatus): string {
  if (status === 'done') return '已完成';
  if (status === 'error') return '异常';
  if (status === 'active') return '进行中';
  return '等待中';
}

// ── Sub-components ────────────────────────────────────────────────────────────

const StepIcon: React.FC<{ status: StepStatus; spinnerFrame: number }> = ({ status, spinnerFrame }) => {
  const baseStyle: React.CSSProperties = {
    fontSize: '13px',
    width: '18px',
    display: 'inline-block',
    textAlign: 'center',
    flexShrink: 0,
  };

  if (status === 'done') return <span style={{ ...baseStyle, color: '#4ade80' }}>✓</span>;
  if (status === 'error') return <span style={{ ...baseStyle, color: '#f87171' }}>✗</span>;
  if (status === 'active') return <span style={{ ...baseStyle, color: '#60a5fa' }}>{SPINNER[spinnerFrame]}</span>;
  return <span style={{ ...baseStyle, color: '#94a3b8' }}>○</span>;
};

// ── Main component ────────────────────────────────────────────────────────────

type InitLoadingProps = {
  variant?: 'full' | 'startup';
};

const InitLoading: React.FC<InitLoadingProps> = ({ variant = 'full' }) => {
  const { t } = useTranslation();
  const { status, skipInitScreen, refetch } = useInit();
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [retryingStartup, setRetryingStartup] = useState(false);
  const [reinstalling, setReinstalling] = useState<'sudoclaw' | 'nexus' | null>(null);

  // Animate spinner while installing
  useEffect(() => {
    if (status.phase !== 'installing') return;
    const id = setInterval(() => setSpinnerFrame((f) => (f + 1) % SPINNER.length), 80);
    return () => clearInterval(id);
  }, [status.phase]);

  // Auto-scroll logs to bottom on new entries
  useEffect(() => {
    const container = logsContainerRef.current;
    if (!container) return;
    // Only auto-scroll if already near the bottom
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 60;
    if (isNearBottom) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [status.logs]);

  useEffect(() => {
    if (!status.retry) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(id);
  }, [status.retry]);

  const isError = status.phase === 'error';
  const isReady = status.phase === 'ready';
  const logs = status.logs ?? [];
  const retryMessage = formatRetryMessage(status.retry, nowMs);
  const isStartupVariant = variant === 'startup';
  const headerTitle = '正在准备运行环境';
  const headerMessage = getHeaderMessage(status.message, isReady, isError);
  const shouldShowHeaderMessage = normalizeHeaderText(headerMessage) !== normalizeHeaderText(headerTitle);
  const showReinstallActions = isError;
  const actionInProgress = retryingStartup || reinstalling !== null;

  const handleManualRetry = async () => {
    setRetryingStartup(true);
    try {
      await init.retryStartup.invoke();
      await refetch();
    } finally {
      setRetryingStartup(false);
    }
  };

  const handleManualReinstall = async (component: 'sudoclaw' | 'nexus') => {
    setReinstalling(component);
    try {
      await init.reinstallComponent.invoke({ component });
      await refetch();
    } finally {
      setReinstalling(null);
    }
  };

  const renderReinstallButtons = () => (
    <div
      style={
        {
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          flexWrap: 'wrap',
          justifyContent: 'flex-end',
          WebkitAppRegion: 'no-drag',
        } as React.CSSProperties
      }
    >
      <button
        type='button'
        onClick={() => void handleManualRetry()}
        disabled={actionInProgress}
        style={{
          border: '1px solid rgba(96, 165, 250, 0.35)',
          borderRadius: '10px',
          background: retryingStartup ? 'rgba(30, 64, 175, 0.28)' : 'linear-gradient(180deg, rgba(37, 99, 235, 0.22), rgba(30, 64, 175, 0.18))',
          color: '#dbeafe',
          fontSize: '12px',
          fontWeight: 700,
          padding: '9px 14px',
          cursor: actionInProgress ? 'not-allowed' : 'pointer',
          opacity: reinstalling ? 0.7 : 1,
          flexShrink: 0,
        }}
      >
        {retryingStartup ? '处理中...' : t('common.retry')}
      </button>
      <button
        type='button'
        onClick={() => void handleManualReinstall('sudoclaw')}
        disabled={actionInProgress}
        style={{
          border: '1px solid rgba(248, 113, 113, 0.35)',
          borderRadius: '10px',
          background: reinstalling === 'sudoclaw' ? 'rgba(127, 29, 29, 0.28)' : 'linear-gradient(180deg, rgba(185, 28, 28, 0.22), rgba(127, 29, 29, 0.18))',
          color: '#fee2e2',
          fontSize: '12px',
          fontWeight: 700,
          padding: '9px 14px',
          cursor: actionInProgress ? 'not-allowed' : 'pointer',
          opacity: reinstalling && reinstalling !== 'sudoclaw' ? 0.7 : 1,
          flexShrink: 0,
        }}
      >
        {reinstalling === 'sudoclaw' ? '处理中...' : `${t('settings.runtimeSettings.button.reinstall')} Sudoclaw`}
      </button>
      <button
        type='button'
        onClick={() => void handleManualReinstall('nexus')}
        disabled={actionInProgress}
        style={{
          border: '1px solid rgba(248, 113, 113, 0.35)',
          borderRadius: '10px',
          background: reinstalling === 'nexus' ? 'rgba(127, 29, 29, 0.28)' : 'linear-gradient(180deg, rgba(185, 28, 28, 0.22), rgba(127, 29, 29, 0.18))',
          color: '#fee2e2',
          fontSize: '12px',
          fontWeight: 700,
          padding: '9px 14px',
          cursor: actionInProgress ? 'not-allowed' : 'pointer',
          opacity: reinstalling && reinstalling !== 'nexus' ? 0.7 : 1,
          flexShrink: 0,
        }}
      >
        {reinstalling === 'nexus' ? '处理中...' : `${t('settings.runtimeSettings.button.reinstall')} Nexus`}
      </button>
      <button
        type='button'
        onClick={() => void init.quitApp.invoke()}
        style={{
          border: '1px solid rgba(248, 113, 113, 0.5)',
          borderRadius: '10px',
          background: 'rgba(185, 28, 28, 0.5)',
          color: '#fee2e2',
          fontSize: '12px',
          fontWeight: 700,
          padding: '9px 14px',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        退出
      </button>
    </div>
  );

  if (isStartupVariant) {
    return (
      <div
        style={
          {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            overflow: 'hidden',
            background: 'radial-gradient(circle at top, rgba(56, 189, 248, 0.12), transparent 32%), linear-gradient(180deg, #071019 0%, #0a1320 52%, #0a121b 100%)',
            color: '#e5e7eb',
            fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
            padding: '32px',
            boxSizing: 'border-box',
            userSelect: 'none',
            WebkitAppRegion: 'drag',
          } as React.CSSProperties
        }
      >
        {/* 桌面端窗口控制按钮 / Window controls for desktop */}
        {isDesktopRuntime && (
          <div style={WINDOW_CONTROLS_WRAPPER_STYLE}>
            <WindowControls />
          </div>
        )}
        <div
          style={{
            width: '100%',
            maxWidth: '520px',
            padding: '24px 28px',
            borderRadius: '22px',
            border: '1px solid rgba(71, 85, 105, 0.22)',
            background: 'linear-gradient(180deg, rgba(15, 27, 44, 0.96), rgba(10, 18, 30, 0.92))',
            boxShadow: '0 22px 54px rgba(3, 8, 18, 0.32)',
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: '34px', color: '#60a5fa', marginBottom: '10px', lineHeight: 1 }}>{SPINNER[spinnerFrame]}</div>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#f8fafc', marginBottom: '10px' }}>正在启动核心服务</div>
          <div style={{ fontSize: '14px', color: '#cbd5e1', lineHeight: '1.6', marginBottom: '18px' }}>{getHeaderMessage(status.message, isReady, isError)}</div>
          <div
            style={
              {
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: '8px',
                marginBottom: '16px',
                WebkitAppRegion: 'no-drag',
              } as React.CSSProperties
            }
          >
            {PRIMARY_STEPS.map((step) => {
              const stepStatus = deriveStepStatusFromMaps(step.id, status.stepStates as Partial<Record<string, StepStatus>> | undefined, status.step, status.phase);
              const progress = getStepProgress(step.id, stepStatus, status.stepProgress?.[step.id]);
              const detail = status.stepDetails?.[step.id] ?? step.description;

              return (
                <div
                  key={step.id}
                  style={{
                    padding: '10px 11px 9px',
                    borderRadius: '14px',
                    border: '1px solid rgba(71, 85, 105, 0.2)',
                    background: 'rgba(9, 17, 28, 0.68)',
                    textAlign: 'left',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                      <StepIcon status={stepStatus} spinnerFrame={spinnerFrame} />
                      <span style={{ fontSize: '11px', fontWeight: 700, color: '#f8fafc' }}>{step.label}</span>
                    </div>
                    <span style={{ fontSize: '10px', fontWeight: 700, color: '#60a5fa', fontVariantNumeric: 'tabular-nums' }}>{progress}%</span>
                  </div>
                  <div
                    style={{
                      fontSize: '9px',
                      lineHeight: '1.3',
                      color: '#9fb0c7',
                      minHeight: '22px',
                      overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                    }}
                  >
                    {detail}
                  </div>
                </div>
              );
            })}
          </div>
          <div
            style={
              {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                marginTop: '6px',
                WebkitAppRegion: 'no-drag',
              } as React.CSSProperties
            }
          >
            <div style={{ fontSize: '12px', color: '#8ca0bb', textAlign: 'left', flex: 1 }}>{t('common.setupContinuesInBackground')}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {showReinstallActions && renderReinstallButtons()}
              {status.phase !== 'ready' && (
                <button
                  type='button'
                  onClick={skipInitScreen}
                  style={{
                    border: '1px solid rgba(96, 165, 250, 0.35)',
                    borderRadius: '10px',
                    background: 'linear-gradient(180deg, rgba(37, 99, 235, 0.22), rgba(30, 64, 175, 0.18))',
                    color: '#dbeafe',
                    fontSize: '12px',
                    fontWeight: 700,
                    padding: '8px 14px',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  {t('common.skip')}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const renderStepCard = (step: Step, variant: 'primary' | 'secondary') => {
    const stepStatus = deriveStepStatusFromMaps(step.id, status.stepStates as Partial<Record<string, StepStatus>> | undefined, status.step, status.phase);
    const progress = getStepProgress(step.id, stepStatus, status.stepProgress?.[step.id]);
    const detail = status.stepDetails?.[step.id] ?? (status.step === step.id ? status.detail : step.description);
    const progressColor = stepStatus === 'error' ? '#f87171' : stepStatus === 'done' ? '#3b82f6' : '#60a5fa';
    const isPrimary = variant === 'primary';
    const surfaceBorder = stepStatus === 'active' ? '1px solid rgba(59, 130, 246, 0.42)' : stepStatus === 'done' ? '1px solid rgba(96, 165, 250, 0.22)' : stepStatus === 'error' ? '1px solid rgba(248, 113, 113, 0.3)' : '1px solid rgba(71, 85, 105, 0.22)';

    return (
      <div
        key={step.id}
        style={
          {
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            minHeight: isPrimary ? '118px' : '80px',
            padding: isPrimary ? '11px 14px 10px' : '9px 11px 8px',
            borderRadius: isPrimary ? '20px' : '16px',
            border: surfaceBorder,
            background: isPrimary ? 'linear-gradient(135deg, rgba(17, 36, 64, 0.96), rgba(16, 29, 50, 0.88))' : 'linear-gradient(180deg, rgba(17, 30, 48, 0.86), rgba(12, 22, 36, 0.86))',
            boxShadow: isPrimary ? '0 12px 28px rgba(3, 8, 18, 0.22)' : '0 7px 16px rgba(3, 8, 18, 0.14)',
            gap: isPrimary ? '7px' : '5px',
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties
        }
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <StepIcon status={stepStatus} spinnerFrame={spinnerFrame} />
              <span
                style={{
                  fontSize: isPrimary ? '13px' : '11px',
                  fontWeight: 700,
                  letterSpacing: '0.01em',
                  color: '#f8fafc',
                }}
              >
                {step.label}
              </span>
            </div>
            <div
              style={{
                fontSize: isPrimary ? '10px' : '9px',
                lineHeight: '1.25',
                color: isPrimary ? '#cbd5e1' : '#b7c4d8',
                minHeight: isPrimary ? '20px' : '18px',
                overflow: 'hidden',
                display: '-webkit-box',
                WebkitLineClamp: isPrimary ? 2 : 1,
                WebkitBoxOrient: 'vertical',
                wordBreak: 'break-word',
              }}
            >
              {detail}
            </div>
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div
              style={{
                fontSize: '10px',
                color: stepStatus === 'error' ? '#fecaca' : '#9fb8d9',
                marginBottom: '2px',
              }}
            >
              {getStatusText(stepStatus)}
            </div>
            <div
              style={{
                fontSize: isPrimary ? '15px' : '12px',
                fontWeight: 800,
                color: stepStatus === 'error' ? '#fca5a5' : '#60a5fa',
                fontVariantNumeric: 'tabular-nums',
                lineHeight: 1,
              }}
            >
              {progress}%
            </div>
          </div>
        </div>

        <div>
          <div
            style={{
              width: '100%',
              height: isPrimary ? '5px' : '4px',
              borderRadius: '999px',
              overflow: 'hidden',
              backgroundColor: 'rgba(24, 40, 63, 0.95)',
            }}
          >
            <div
              style={{
                width: `${progress}%`,
                height: '100%',
                borderRadius: '999px',
                background: `linear-gradient(90deg, ${progressColor}, ${stepStatus === 'done' ? '#2563eb' : stepStatus === 'error' ? '#ef4444' : '#3b82f6'})`,
                transition: 'width 0.25s ease, background 0.25s ease',
              }}
            />
          </div>
          <div
            style={{
              marginTop: '5px',
              fontSize: '9px',
              color: '#93a5bd',
              lineHeight: '1.2',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
            }}
          >
            {step.description}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      style={
        {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          overflow: 'hidden',
          background: 'radial-gradient(circle at top, rgba(56, 189, 248, 0.14), transparent 30%), linear-gradient(180deg, #071019 0%, #0a1320 52%, #0a121b 100%)',
          color: '#e5e7eb',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          padding: '24px 24px 20px',
          boxSizing: 'border-box',
          userSelect: 'none',
          WebkitAppRegion: 'drag',
        } as React.CSSProperties
      }
    >
      {/* 桌面端窗口控制按钮 / Window controls for desktop */}
      {isDesktopRuntime && (
        <div style={WINDOW_CONTROLS_WRAPPER_STYLE}>
          <WindowControls />
        </div>
      )}
      <div
        style={{
          width: '100%',
          maxWidth: '1120px',
          minWidth: '0',
          margin: '0 auto',
          maxHeight: 'calc(100vh - 28px)',
          display: 'flex',
          flexDirection: 'column',
          padding: '8px 6px 10px',
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        <div
          style={{
            flexShrink: 0,
            marginBottom: '16px',
            padding: '2px 4px 0',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              fontSize: '24px',
              fontWeight: 800,
              color: '#f8fafc',
              letterSpacing: '0.02em',
              lineHeight: '1.2',
              marginBottom: shouldShowHeaderMessage ? '8px' : '0',
            }}
          >
            {headerTitle}
          </div>
          {shouldShowHeaderMessage && (
            <div
              style={{
                fontSize: '12px',
                color: '#cbd5e1',
                lineHeight: '1.45',
                maxWidth: '520px',
                margin: '0 auto',
              }}
            >
              {headerMessage}
            </div>
          )}
          {retryMessage && (
            <div
              style={
                {
                  marginTop: '10px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '5px 10px',
                  borderRadius: '999px',
                  border: '1px solid rgba(251, 191, 36, 0.26)',
                  backgroundColor: 'rgba(245, 158, 11, 0.12)',
                  color: '#fde68a',
                  fontSize: '12px',
                  fontWeight: '600',
                  WebkitAppRegion: 'no-drag',
                } as React.CSSProperties
              }
            >
              <span>自动重试</span>
              <span style={{ color: '#fef3c7', fontVariantNumeric: 'tabular-nums' }}>{retryMessage}</span>
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: '8px',
              flexShrink: 0,
            }}
          >
            {PRIMARY_STEPS.map((step) => renderStepCard(step, 'primary'))}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: '8px',
              flexShrink: 0,
            }}
          >
            {SECONDARY_STEPS.map((step) => renderStepCard(step, 'secondary'))}
          </div>

          <div
            ref={logsContainerRef}
            style={
              {
                height: '60px',
                minHeight: '60px',
                maxHeight: '84px',
                overflowY: 'auto',
                backgroundColor: 'rgba(8, 15, 24, 0.72)',
                border: '1px solid rgba(71, 85, 105, 0.18)',
                borderRadius: '14px',
                padding: '8px 10px',
                fontSize: '10px',
                lineHeight: '1.5',
                color: '#e2e8f0',
                fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", "Consolas", monospace',
                scrollbarWidth: 'thin',
                scrollbarColor: '#334155 transparent',
                flexShrink: 0,
                marginBottom: '0',
                WebkitAppRegion: 'no-drag',
                userSelect: 'text',
                WebkitUserSelect: 'text',
                cursor: 'text',
              } as React.CSSProperties
            }
          >
            {logs.length > 0 ? (
              logs.map((log, i) => {
                const isWarn = log.includes('⚠') || log.toLowerCase().includes('warning') || log.toLowerCase().includes('warn');
                const isSuccess = log.includes('✓');
                const isErrorLog = log.includes('✗') || log.toLowerCase().includes('error') || log.toLowerCase().includes('失败');
                const color = isErrorLog ? '#ef4444' : isWarn ? '#f59e0b' : isSuccess ? '#4ade80' : '#cbd5e1';
                return (
                  <div key={i} style={{ color, marginBottom: '1px', wordBreak: 'break-all', userSelect: 'text', WebkitUserSelect: 'text' }}>
                    {log}
                  </div>
                );
              })
            ) : (
              <div style={{ color: '#8ca0bb' }}>等待关键日志输出...</div>
            )}
            <div ref={logsEndRef} />
          </div>
        </div>

        {/* ── Error message ── */}
        {status.error && (
          <div
            style={
              {
                marginTop: '14px',
                fontSize: '12px',
                color: '#fecaca',
                textAlign: 'left',
                lineHeight: '1.6',
                padding: '12px 14px',
                backgroundColor: 'rgba(127, 29, 29, 0.18)',
                border: '1px solid rgba(248, 113, 113, 0.16)',
                borderRadius: '10px',
                flexShrink: 0,
                WebkitAppRegion: 'no-drag',
              } as React.CSSProperties
            }
          >
            {status.error}
          </div>
        )}

        {status.phase !== 'ready' && (
          <div
            style={
              {
                marginTop: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '16px',
                padding: '12px 14px',
                borderRadius: '14px',
                border: '1px solid rgba(71, 85, 105, 0.18)',
                background: 'rgba(8, 15, 24, 0.64)',
                flexShrink: 0,
                WebkitAppRegion: 'no-drag',
              } as React.CSSProperties
            }
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              {showReinstallActions ? (
                <>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#f8fafc', marginBottom: '4px' }}>手动重装</div>
                  <div style={{ fontSize: '11px', lineHeight: '1.5', color: '#94a3b8' }}>启动失败后不会再自动重装，可按需手动重装核心组件，或先跳过进入应用。</div>
                </>
              ) : (
                <div style={{ fontSize: '12px', color: '#8ca0bb', textAlign: 'left' }}>{t('common.setupContinuesInBackground')}</div>
              )}
            </div>
            <div
              style={
                {
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  flexWrap: 'wrap',
                  justifyContent: 'flex-end',
                  marginLeft: 'auto',
                  WebkitAppRegion: 'no-drag',
                } as React.CSSProperties
              }
            >
              {showReinstallActions && renderReinstallButtons()}
              <button
                type='button'
                onClick={skipInitScreen}
                style={{
                  border: '1px solid rgba(96, 165, 250, 0.35)',
                  borderRadius: '10px',
                  background: 'linear-gradient(180deg, rgba(37, 99, 235, 0.22), rgba(30, 64, 175, 0.18))',
                  color: '#dbeafe',
                  fontSize: '12px',
                  fontWeight: 700,
                  padding: '9px 16px',
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                {t('common.skip')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default InitLoading;
