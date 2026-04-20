/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * InitGateModal — Blocks entry to the main app until all runtimes are ready.
 *
 * Shown as a modal overlay when the user has authenticated but the background
 * runtime download/installation has not yet finished.  Once all components
 * report "ready", the modal auto-dismisses and the main app renders.
 *
 * There is intentionally NO skip button — the app cannot function without
 * the core runtimes.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useInit } from '../context/InitContext';
import { init } from '@/common/ipcBridge';

type StepId = 'git' | 'node' | 'claude' | 'sudoclaw' | 'nexus' | 'bdpan';
type StepStatus = 'pending' | 'active' | 'done' | 'error';

interface Step {
  id: StepId;
  label: string;
}

const STEPS: Step[] = [
  { id: 'sudoclaw', label: 'Sudoclaw' },
  { id: 'nexus', label: 'Nexus' },
  { id: 'node', label: 'Node.js' },
  { id: 'claude', label: 'Claude Code' },
  { id: 'bdpan', label: 'bdpan' },
  { id: 'git', label: 'Git' },
];

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const InitGateModal: React.FC = () => {
  const { status } = useInit();
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setSpinnerFrame((f) => (f + 1) % SPINNER.length), 80);
    return () => clearInterval(timer);
  }, []);

  const deriveStepStatus = (stepId: StepId): StepStatus => {
    const stateMap = status.stepStates as Partial<Record<StepId, StepStatus>> | undefined;
    if (stateMap?.[stepId]) return stateMap[stepId]!;
    if (status.step === stepId) return 'active';
    if (status.phase === 'ready') return 'done';
    return 'pending';
  };

  const getProgress = (stepId: StepId): number => {
    const stepStatus = deriveStepStatus(stepId);
    if (stepStatus === 'done') return 100;
    return status.stepProgress?.[stepId] ?? 0;
  };

  const overallProgress = status.progress ?? 0;
  const isError = status.phase === 'error';

  const handleRetry = () => {
    void init.retryStartup.invoke();
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div
        style={{
          width: '420px',
          maxWidth: '90vw',
          borderRadius: '16px',
          background: 'linear-gradient(135deg, #0f1923 0%, #131e2e 100%)',
          border: '1px solid rgba(59, 130, 246, 0.2)',
          boxShadow: '0 24px 48px rgba(0, 0, 0, 0.4)',
          padding: '28px 24px 24px',
          color: '#f8fafc',
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#f1f5f9' }}>
            {isError ? '环境准备失败' : '正在准备运行环境'}
          </h2>
          <p style={{ margin: '6px 0 0', fontSize: '12px', color: '#94a3b8' }}>
            {isError
              ? '部分组件安装失败，请重试'
              : '首次使用需要下载必要组件，请稍候...'}
          </p>
        </div>

        {/* Overall progress bar */}
        <div style={{ marginBottom: '18px' }}>
          <div
            style={{
              width: '100%',
              height: '6px',
              borderRadius: '999px',
              backgroundColor: 'rgba(24, 40, 63, 0.95)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${overallProgress}%`,
                height: '100%',
                borderRadius: '999px',
                background: isError
                  ? 'linear-gradient(90deg, #ef4444, #f87171)'
                  : 'linear-gradient(90deg, #3b82f6, #60a5fa)',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
          <div style={{ textAlign: 'right', marginTop: '4px', fontSize: '11px', color: '#64748b' }}>
            {overallProgress}%
          </div>
        </div>

        {/* Step list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
          {STEPS.map((step) => {
            const stepStatus = deriveStepStatus(step.id);
            const progress = getProgress(step.id);
            const detail = status.stepDetails?.[step.id] ?? '';

            return (
              <div
                key={step.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '8px 12px',
                  borderRadius: '10px',
                  background: stepStatus === 'active'
                    ? 'rgba(59, 130, 246, 0.08)'
                    : 'rgba(15, 23, 42, 0.5)',
                  border: stepStatus === 'active'
                    ? '1px solid rgba(59, 130, 246, 0.2)'
                    : '1px solid rgba(51, 65, 85, 0.15)',
                }}
              >
                {/* Icon */}
                <span style={{ fontSize: '13px', width: '16px', textAlign: 'center', flexShrink: 0 }}>
                  {stepStatus === 'done' && <span style={{ color: '#34d399' }}>✓</span>}
                  {stepStatus === 'error' && <span style={{ color: '#f87171' }}>✗</span>}
                  {stepStatus === 'active' && (
                    <span style={{ color: '#60a5fa' }}>{SPINNER[spinnerFrame]}</span>
                  )}
                  {stepStatus === 'pending' && <span style={{ color: '#475569' }}>○</span>}
                </span>

                {/* Label + detail */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#e2e8f0' }}>
                    {step.label}
                  </div>
                  {detail && (
                    <div
                      style={{
                        fontSize: '10px',
                        color: '#64748b',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {detail}
                    </div>
                  )}
                </div>

                {/* Progress */}
                <span
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    color: stepStatus === 'error' ? '#fca5a5' : stepStatus === 'done' ? '#34d399' : '#60a5fa',
                    fontVariantNumeric: 'tabular-nums',
                    flexShrink: 0,
                  }}
                >
                  {progress}%
                </span>
              </div>
            );
          })}
        </div>

        {/* Error state: retry button */}
        {isError && (
          <div style={{ textAlign: 'center' }}>
            <button
              onClick={handleRetry}
              style={{
                padding: '8px 28px',
                borderRadius: '8px',
                border: 'none',
                background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                color: '#fff',
                fontSize: '13px',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              重试
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default InitGateModal;
