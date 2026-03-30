/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useState } from 'react';
import { useInit } from '../context/InitContext';

// ── Step definitions ─────────────────────────────────────────────────────────
type StepId = 'git' | 'node' | 'sudoclaw' | 'nexus' | 'bdpan';
type StepStatus = 'pending' | 'active' | 'done' | 'error';

interface Step {
  id: StepId;
  label: string;
  description: string;
}

const STEPS: Step[] = [
  { id: 'git', label: 'Git 环境', description: '版本控制基础组件' },
  { id: 'node', label: 'Node.js 运行时', description: 'JavaScript 执行环境' },
  { id: 'sudoclaw', label: 'Sudoclaw / OpenClaw', description: 'AI 代理核心引擎' },
  { id: 'nexus', label: 'Nexus 推理引擎', description: '本地模型推理服务' },
  { id: 'bdpan', label: 'bdpan CLI', description: '文件同步工具' },
];

const STEP_ORDER: StepId[] = STEPS.map((s) => s.id);

// Braille spinner frames
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function deriveStepStatus(stepId: StepId, currentStep: string | undefined, phase: string): StepStatus {
  if (phase === 'ready') return 'done';
  if (!currentStep) return 'pending';

  const currentIdx = STEP_ORDER.indexOf(currentStep as StepId);
  const stepIdx = STEP_ORDER.indexOf(stepId);

  if (currentIdx < 0) return 'pending';
  if (phase === 'error' && stepIdx === currentIdx) return 'error';
  if (stepIdx < currentIdx) return 'done';
  if (stepIdx === currentIdx) return 'active';
  return 'pending';
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
  return <span style={{ ...baseStyle, color: '#374151' }}>○</span>;
};

// ── Main component ────────────────────────────────────────────────────────────

const InitLoading: React.FC = () => {
  const { status } = useInit();
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const [spinnerFrame, setSpinnerFrame] = useState(0);

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
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [status.logs]);

  const progress = status.progress ?? 0;
  const isInstalling = status.phase === 'installing';
  const isError = status.phase === 'error';
  const isReady = status.phase === 'ready';
  const logs = status.logs ?? [];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        backgroundColor: '#0c0c0c',
        color: '#e5e7eb',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        padding: '40px 24px',
        boxSizing: 'border-box',
        userSelect: 'none',
      }}
    >
      {/* ── Header ── */}
      <div style={{ marginBottom: '32px', textAlign: 'center' }}>
        <div
          style={{
            fontSize: '22px',
            fontWeight: '700',
            color: '#f9fafb',
            letterSpacing: '-0.3px',
            marginBottom: '6px',
          }}
        >
          Sudowork
        </div>
        <div style={{ fontSize: '13px', color: '#6b7280' }}>
          {isReady ? '所有组件就绪' : isError ? '初始化失败' : status.message || '正在初始化运行时组件...'}
        </div>
      </div>

      {/* ── Steps list ── */}
      <div
        style={{
          width: '100%',
          maxWidth: '480px',
          marginBottom: '20px',
        }}
      >
        {STEPS.map((step) => {
          const stepStatus = deriveStepStatus(step.id, status.step, status.phase);
          const isActive = stepStatus === 'active';
          const isDone = stepStatus === 'done';
          const isPending = stepStatus === 'pending';

          return (
            <div
              key={step.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                padding: '9px 12px',
                marginBottom: '3px',
                borderRadius: '8px',
                backgroundColor: isActive ? 'rgba(59, 130, 246, 0.07)' : 'transparent',
                border: `1px solid ${isActive ? 'rgba(59, 130, 246, 0.18)' : 'transparent'}`,
                transition: 'background-color 0.2s ease, border-color 0.2s ease',
              }}
            >
              <span style={{ marginRight: '10px', marginTop: '1px' }}>
                <StepIcon status={stepStatus} spinnerFrame={spinnerFrame} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: '13px',
                    fontWeight: isActive ? '500' : '400',
                    color: isDone ? '#6b7280' : isPending ? '#374151' : '#e5e7eb',
                    marginBottom: isActive && status.detail ? '3px' : 0,
                    transition: 'color 0.2s ease',
                  }}
                >
                  {step.label}
                  {!isActive && (
                    <span
                      style={{
                        marginLeft: '8px',
                        fontSize: '11px',
                        color: '#374151',
                        fontWeight: '400',
                      }}
                    >
                      {step.description}
                    </span>
                  )}
                </div>
                {isActive && status.detail && (
                  <div
                    style={{
                      fontSize: '11px',
                      color: '#6b7280',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {status.detail}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Log output panel ── */}
      {logs.length > 0 && (
        <div
          style={{
            width: '100%',
            maxWidth: '480px',
            marginBottom: '20px',
          }}
        >
          <div
            style={{
              fontSize: '10px',
              color: '#374151',
              marginBottom: '4px',
              textTransform: 'uppercase',
              letterSpacing: '0.6px',
            }}
          >
            安装日志
          </div>
          <div
            ref={logsContainerRef}
            style={{
              height: '140px',
              overflowY: 'auto',
              backgroundColor: '#111111',
              border: '1px solid #1f1f1f',
              borderRadius: '6px',
              padding: '10px 12px',
              fontSize: '11px',
              lineHeight: '1.65',
              color: '#4b5563',
              fontFamily: '"SF Mono", "Fira Code", "Cascadia Code", "Consolas", monospace',
              scrollbarWidth: 'thin',
              scrollbarColor: '#1f2937 transparent',
            }}
          >
            {logs.map((log, i) => {
              const isWarn = log.includes('⚠') || log.toLowerCase().includes('warning') || log.toLowerCase().includes('warn');
              const isSuccess = log.includes('✓');
              const isError = log.includes('✗') || log.toLowerCase().includes('error') || log.toLowerCase().includes('失败');
              const color = isError ? '#ef4444' : isWarn ? '#f59e0b' : isSuccess ? '#4ade80' : '#4b5563';
              return (
                <div key={i} style={{ color, marginBottom: '1px', wordBreak: 'break-all' }}>
                  {log}
                </div>
              );
            })}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}

      {/* ── Progress bar ── */}
      <div style={{ width: '100%', maxWidth: '480px' }}>
        <div
          style={{
            width: '100%',
            height: '2px',
            backgroundColor: '#1a1a1a',
            borderRadius: '1px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${progress}%`,
              height: '100%',
              backgroundColor: isError ? '#ef4444' : isReady ? '#4ade80' : '#3b82f6',
              borderRadius: '1px',
              transition: 'width 0.4s ease, background-color 0.3s ease',
            }}
          />
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: '8px',
            fontSize: '11px',
            color: '#374151',
          }}
        >
          <span>
            {isError ? '安装失败' : isReady ? '初始化完成' : isInstalling ? '安装中...' : '准备中...'}
          </span>
          <span>{progress}%</span>
        </div>
      </div>

      {/* ── Error message ── */}
      {status.error && (
        <div
          style={{
            marginTop: '16px',
            fontSize: '12px',
            color: '#f87171',
            maxWidth: '480px',
            textAlign: 'center',
            lineHeight: '1.6',
            padding: '10px 14px',
            backgroundColor: 'rgba(239, 68, 68, 0.06)',
            border: '1px solid rgba(239, 68, 68, 0.15)',
            borderRadius: '6px',
          }}
        >
          {status.error}
        </div>
      )}
    </div>
  );
};

export default InitLoading;
