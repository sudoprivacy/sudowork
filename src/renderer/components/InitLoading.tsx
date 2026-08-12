/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import type { TFunction } from 'i18next';
import { Check, Circle, X } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { init } from '@/common/ipcBridge';
import { useTenantLogo } from '@/renderer/hooks/useTenantLogo';
import { isElectronDesktop, isMacOS } from '@/renderer/utils/platform';
import { useInit } from '../context/InitContext';
import WindowControls from './WindowControls';

const isWindowControlsVisible = isElectronDesktop() && !isMacOS();

type StepId = 'git' | 'node' | 'scode' | 'nexus';
type StepStatus = 'pending' | 'active' | 'done' | 'error';

interface Step {
  id: StepId;
  label: string;
  description: string;
}

const STEPS: Step[] = [
  { id: 'scode', label: 'Sudocode', description: '默认 ACP 代理运行时' },
  { id: 'nexus', label: 'Nexus OS 核心引擎', description: '本地核心服务引擎' },
  { id: 'git', label: 'Git 环境', description: '版本控制基础组件' },
  { id: 'node', label: 'Node.js 运行时', description: 'JavaScript 执行环境' },
];

const STEP_ORDER: StepId[] = STEPS.map((step) => step.id);
const PRIMARY_STEP_IDS: StepId[] = ['scode', 'nexus'];
const PRIMARY_STEPS = STEPS.filter((step) => PRIMARY_STEP_IDS.includes(step.id));
const SECONDARY_STEPS = STEPS.filter((step) => !PRIMARY_STEP_IDS.includes(step.id));
const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function getHeaderMessage(message: string | undefined, isReady: boolean, isError: boolean, t: TFunction): string {
  if (isReady) return t('setup.init.allReady', '所有组件就绪');
  if (isError) return t('setup.init.failed', '初始化失败');
  if (message === '正在启动核心服务...') return t('setup.init.startingCoreServices', '核心服务启动中，请等待 Sudocode 与 Nexus 完成就绪');
  if (message === '正在校验组件状态...') return t('setup.init.validatingComponents', '正在确认核心服务状态，请稍候');
  if (!message || message === '组件安装中' || message === '正在并行准备运行环境...') return t('setup.init.preparingEnvironment', '正在准备运行环境...');
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

  const currentIndex = STEP_ORDER.indexOf(currentStep as StepId);
  const stepIndex = STEP_ORDER.indexOf(stepId);
  if (currentIndex < 0) return 'pending';
  if (phase === 'error' && stepIndex === currentIndex) return 'error';
  if (stepIndex < currentIndex) return 'done';
  if (stepIndex === currentIndex) return 'active';
  return 'pending';
}

function getStepProgress(_stepId: StepId, stepStatus: StepStatus, currentProgress?: number): number {
  if (stepStatus === 'done') return 100;
  if (stepStatus === 'error') return currentProgress ?? 100;
  if (stepStatus === 'active') return currentProgress ?? 12;
  return currentProgress ?? 0;
}

function formatRetryMessage(retry: { attempt: number; maxAttempts: number; nextRetryAt: number } | undefined, nowMs: number | undefined, t: TFunction): string | null {
  if (!retry) return null;
  const remainingSeconds = Math.max(0, Math.ceil((retry.nextRetryAt - (nowMs ?? Date.now())) / 1000));
  return t('setup.init.retryCountdown', {
    seconds: remainingSeconds,
    attempt: retry.attempt,
    maxAttempts: retry.maxAttempts,
    defaultValue: `${remainingSeconds} 秒后自动重试（第 ${retry.attempt}/${retry.maxAttempts} 次）`,
  });
}

function getStatusText(status: StepStatus, t: TFunction): string {
  if (status === 'done') return t('setup.init.statusDone', '已完成');
  if (status === 'error') return t('setup.init.statusError', '异常');
  if (status === 'active') return t('setup.init.statusActive', '进行中');
  return t('setup.init.statusPending', '等待中');
}

function StepIcon({ status, spinnerFrame }: IStepIconProps) {
  const className = 'flex h-20px w-20px shrink-0 items-center justify-center';
  if (status === 'done') return <Check size={16} strokeWidth={2.5} className={`${className} text-success`} />;
  if (status === 'error') return <X size={16} strokeWidth={2.5} className={`${className} text-destructive`} />;
  if (status === 'active') return <span className={`${className} text-blue text-16px leading-none`}>{SPINNER[spinnerFrame]}</span>;
  return <Circle size={12} strokeWidth={1.8} className={`${className} text-foreground-quaternary`} />;
}

export default function InitLoading({ variant = 'full' }: IInitLoadingProps) {
  const { t } = useTranslation();
  const { status, skipInitScreen, refetch } = useInit();
  const logo = useTenantLogo();
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [isRetryingStartup, setIsRetryingStartup] = useState(false);
  const [reinstallingComponent, setReinstallingComponent] = useState<'scode' | 'nexus' | null>(null);

  useEffect(() => {
    if (status.phase !== 'installing') return;
    const id = window.setInterval(() => setSpinnerFrame((frame) => (frame + 1) % SPINNER.length), 80);
    return () => window.clearInterval(id);
  }, [status.phase]);

  useEffect(() => {
    const container = logsContainerRef.current;
    if (!container) return;
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 60;
    if (isNearBottom) container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  }, [status.logs]);

  useEffect(() => {
    if (!status.retry) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [status.retry]);

  const isError = status.phase === 'error';
  const isReady = status.phase === 'ready';
  const logs = status.logs ?? [];
  const retryMessage = formatRetryMessage(status.retry, nowMs, t);
  const headerTitle = t('setup.init.headerTitle', '正在准备运行环境');
  const headerMessage = getHeaderMessage(status.message, isReady, isError, t);
  const isHeaderMessageVisible = normalizeHeaderText(headerMessage) !== normalizeHeaderText(headerTitle);
  const isActionInProgress = isRetryingStartup || reinstallingComponent !== null;

  const onManualRetry = async () => {
    setIsRetryingStartup(true);
    try {
      await init.retryStartup.invoke();
      await refetch();
    } finally {
      setIsRetryingStartup(false);
    }
  };

  const onManualReinstall = async (component: 'scode' | 'nexus') => {
    setReinstallingComponent(component);
    try {
      await init.reinstallComponent.invoke({ component });
      await refetch();
    } finally {
      setReinstallingComponent(null);
    }
  };

  const renderActions = (isSkipVisible: boolean) => (
    <div className='flex flex-wrap items-center justify-end gap-2 [-webkit-app-region:no-drag]'>
      {isError && (
        <>
          <Button type='primary' loading={isRetryingStartup} disabled={isActionInProgress} onClick={() => void onManualRetry()}>
            {t('common.retry')}
          </Button>
          <Button status='danger' loading={reinstallingComponent === 'scode'} disabled={isActionInProgress} onClick={() => void onManualReinstall('scode')}>
            {`${t('settings.runtimeSettings.button.reinstall')} Sudocode`}
          </Button>
          <Button status='danger' loading={reinstallingComponent === 'nexus'} disabled={isActionInProgress} onClick={() => void onManualReinstall('nexus')}>
            {`${t('settings.runtimeSettings.button.reinstall')} Nexus`}
          </Button>
          <Button type='primary' status='danger' onClick={() => void init.quitApp.invoke()}>
            {t('setup.init.quit', '退出')}
          </Button>
        </>
      )}
      {isSkipVisible && (
        <Button type={isError ? 'secondary' : 'primary'} onClick={skipInitScreen}>
          {t('common.skip')}
        </Button>
      )}
    </div>
  );

  const renderStepCard = (step: Step, isPrimary: boolean) => {
    const stepStatus = deriveStepStatusFromMaps(step.id, status.stepStates as Partial<Record<string, StepStatus>> | undefined, status.step, status.phase);
    const progress = getStepProgress(step.id, stepStatus, status.stepProgress?.[step.id]);
    const detail = status.stepDetails?.[step.id] ?? (status.step === step.id ? status.detail : t(`setup.init.step.${step.id}.description`, step.description));
    const progressClassName = stepStatus === 'error' ? 'bg-destructive' : stepStatus === 'done' ? 'bg-success' : 'bg-blue';
    const borderClassName = stepStatus === 'active' ? 'border-input' : stepStatus === 'error' ? 'border-destructive' : 'border-border';

    return (
      <div key={step.id} className={`flex min-w-0 flex-col gap-3 rounded-16px border p-4 ${borderClassName} ${isPrimary ? 'bg-secondary' : 'bg-muted'} [-webkit-app-region:no-drag]`}>
        <div className='flex items-start justify-between gap-4'>
          <div className='min-w-0 flex-1'>
            <div className='flex items-center gap-2'>
              <StepIcon status={stepStatus} spinnerFrame={spinnerFrame} />
              <span className={`${isPrimary ? 'text-14px' : 'text-13px'} truncate font-650 text-foreground`}>{t(`setup.init.step.${step.id}.label`, step.label)}</span>
            </div>
            <div className='mt-2 line-clamp-2 text-11px leading-18px text-foreground-secondary'>{detail}</div>
          </div>
          <div className='shrink-0 text-right'>
            <div className={`text-11px ${stepStatus === 'error' ? 'text-destructive' : 'text-foreground-tertiary'}`}>{getStatusText(stepStatus, t)}</div>
            <div className={`mt-1 text-14px font-700 tabular-nums ${stepStatus === 'error' ? 'text-destructive' : stepStatus === 'done' ? 'text-success' : 'text-blue'}`}>{progress}%</div>
          </div>
        </div>
        <div>
          <div className='h-4px overflow-hidden rounded-full bg-fill-deep'>
            <div className={`h-full rounded-full transition-[width] duration-250 ${progressClassName}`} style={{ width: `${progress}%` }} />
          </div>
          <div className='mt-2 truncate text-10px text-foreground-tertiary'>{t(`setup.init.step.${step.id}.description`, step.description)}</div>
        </div>
      </div>
    );
  };

  const background = (
    <div className='pointer-events-none fixed inset-0 overflow-hidden' aria-hidden='true'>
      <div className='absolute -right-80px -top-120px h-320px w-320px rounded-full bg-accent opacity-70 blur-64px' />
      <div className='absolute -bottom-120px -left-80px h-320px w-320px rounded-full bg-accent opacity-70 blur-64px' />
    </div>
  );

  const windowControls = isWindowControlsVisible && (
    <div className='fixed right-0 top-0 z-50 h-36px [-webkit-app-region:no-drag]'>
      <WindowControls />
    </div>
  );

  if (variant === 'startup') {
    return (
      <div className='relative min-h-screen w-full overflow-hidden bg-background text-foreground [-webkit-app-region:drag]'>
        {background}
        {windowControls}
        <main className='relative z-1 mx-auto flex min-h-screen w-full max-w-640px items-center px-5 py-12 sm:px-8'>
          <section className='w-full rounded-24px border border-border bg-card p-6 text-center shadow-xl [-webkit-app-region:no-drag] sm:p-9'>
            <div className='mx-auto mb-5 flex h-64px w-64px items-center justify-center rounded-18px border border-border bg-muted shadow-sm'>
              <img src={logo} alt='' className='h-44px w-44px' />
            </div>
            <h1 className='m-0 text-24px font-700 leading-32px text-foreground'>{t('setup.init.startupTitle', '正在启动核心服务')}</h1>
            <p className='mb-0 mt-2 text-14px leading-22px text-foreground-secondary'>{headerMessage}</p>
            <div className='mt-6 grid grid-cols-1 gap-3 text-left sm:grid-cols-2'>{PRIMARY_STEPS.map((step) => renderStepCard(step, true))}</div>
            <div className='mt-6 flex flex-col items-center justify-between gap-4 border-t border-border pt-5 sm:flex-row'>
              <span className='text-12px text-foreground-tertiary'>{t('common.setupContinuesInBackground')}</span>
              {renderActions(!isReady)}
            </div>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className='relative min-h-screen w-full overflow-x-hidden overflow-y-auto bg-background text-foreground [-webkit-app-region:drag]'>
      {background}
      {windowControls}
      <main className='relative z-1 mx-auto flex min-h-screen w-full max-w-1120px items-center px-5 py-8 sm:px-8'>
        <section className='w-full rounded-24px border border-border bg-card p-5 shadow-xl [-webkit-app-region:no-drag] sm:p-8'>
          <header className='mb-6 flex flex-col items-center text-center'>
            <div className='mb-4 flex h-56px w-56px items-center justify-center rounded-16px border border-border bg-muted shadow-sm'>
              <img src={logo} alt='' className='h-38px w-38px' />
            </div>
            <h1 className='m-0 text-24px font-700 leading-32px text-foreground'>{headerTitle}</h1>
            {isHeaderMessageVisible && <p className='mb-0 mt-2 max-w-520px text-13px leading-20px text-foreground-secondary'>{headerMessage}</p>}
            {retryMessage && (
              <div className='mt-4 inline-flex items-center gap-2 rounded-full border border-warning bg-warning-surface px-3 py-1.5 text-12px font-600 text-warning'>
                <span>{t('setup.init.autoRetry', '自动重试')}</span>
                <span className='tabular-nums'>{retryMessage}</span>
              </div>
            )}
          </header>

          <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>{PRIMARY_STEPS.map((step) => renderStepCard(step, true))}</div>
          <div className='mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4'>{SECONDARY_STEPS.map((step) => renderStepCard(step, false))}</div>

          <div
            ref={logsContainerRef}
            className='mt-3 h-84px overflow-y-auto rounded-12px border border-border bg-muted px-3 py-2 font-mono text-10px leading-18px text-foreground-secondary [scrollbar-color:var(--border-deep)_transparent] [scrollbar-width:thin] [-webkit-app-region:no-drag] select-text'
          >
            {logs.length > 0 ? (
              logs.map((log, index) => {
                const isWarningLog = log.includes('⚠') || log.toLowerCase().includes('warning') || log.toLowerCase().includes('warn');
                const isSuccessLog = log.includes('✓');
                const isErrorLog = log.includes('✗') || log.toLowerCase().includes('error') || log.toLowerCase().includes('失败');
                const colorClassName = isErrorLog ? 'text-destructive' : isWarningLog ? 'text-warning' : isSuccessLog ? 'text-success' : 'text-foreground-secondary';
                return (
                  <div key={index} className={`break-all ${colorClassName}`}>
                    {log}
                  </div>
                );
              })
            ) : (
              <div className='text-foreground-tertiary'>{t('setup.init.waitingForLogs', '等待关键日志输出...')}</div>
            )}
          </div>

          {status.error && <div className='mt-3 rounded-12px border border-destructive bg-[color-mix(in_srgb,var(--destructive)_8%,transparent)] px-4 py-3 text-12px leading-20px text-destructive'>{status.error}</div>}

          {!isReady && (
            <div className='mt-4 flex flex-col items-start justify-between gap-4 rounded-16px border border-border bg-muted p-4 sm:flex-row sm:items-center'>
              <div className='min-w-0 flex-1'>
                {isError ? (
                  <>
                    <div className='text-13px font-650 text-foreground'>{t('setup.init.manualReinstall', '手动重装')}</div>
                    <div className='mt-1 text-11px leading-18px text-foreground-secondary'>{t('setup.init.manualReinstallHint', '启动失败后不会再自动重装，可按需手动重装核心组件，或先跳过进入应用。')}</div>
                  </>
                ) : (
                  <div className='text-12px text-foreground-secondary'>{t('common.setupContinuesInBackground')}</div>
                )}
              </div>
              {renderActions(true)}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

interface IStepIconProps {
  status: StepStatus;
  spinnerFrame: number;
}

interface IInitLoadingProps {
  variant?: 'full' | 'startup';
}
