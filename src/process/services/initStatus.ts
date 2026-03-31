/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Initialization status for runtime dependencies (Node.js, Sudoclaw, Git, etc.)
 */

export type InitPhase = 'pending' | 'installing' | 'ready' | 'error';
export type InitStepStatus = 'pending' | 'active' | 'done' | 'error';

export interface InitRetryStatus {
  attempt: number;
  maxAttempts: number;
  nextRetryAt: number;
}

export interface InitStatus {
  phase: InitPhase;
  message: string;
  progress: number; // 0-100
  error?: string;
  /** Current installation step id: 'git' | 'node' | 'claude' | 'sudoclaw' | 'nexus' | 'bdpan' */
  step?: string;
  /** Detail message for current step (e.g. "Extracting files... 45%") */
  detail?: string;
  /** Per-step progress values (0-100) */
  stepProgress?: Partial<Record<string, number>>;
  /** Per-step detail messages for concurrent install/start flows. */
  stepDetails?: Partial<Record<string, string>>;
  /** Per-step state values for concurrent install/start flows. */
  stepStates?: Partial<Record<string, InitStepStatus>>;
  /** Recent log entries (capped at 100). Each entry is pre-formatted with a timestamp. */
  logs?: string[];
  /** Automatic retry countdown for startup/install failures. */
  retry?: InitRetryStatus;
}

class InitStatusManager {
  private status: InitStatus = { phase: 'pending', message: '准备初始化...', progress: 0 };
  private listeners: Set<(status: InitStatus) => void> = new Set();

  getStatus(): InitStatus {
    return { ...this.status };
  }

  setStatus(phase: InitPhase, message: string, progress: number = 0, error?: string): void {
    this.status = { ...this.status, phase, message, progress, error };
    this.notifyListeners();
  }

  /** Set the current active step and an optional detail line. */
  setStep(step: string, detail?: string): void {
    this.status = {
      ...this.status,
      step,
      detail,
      stepDetails: detail
        ? {
            ...(this.status.stepDetails ?? {}),
            [step]: detail,
          }
        : this.status.stepDetails,
      stepStates: {
        ...(this.status.stepStates ?? {}),
        [step]: 'active',
      },
    };
    this.notifyListeners();
  }

  /** Update only the detail line for the current step (e.g. extraction progress). */
  setDetail(detail: string): void {
    const currentStep = this.status.step;
    this.status = {
      ...this.status,
      detail,
      stepDetails: currentStep
        ? {
            ...(this.status.stepDetails ?? {}),
            [currentStep]: detail,
          }
        : this.status.stepDetails,
    };
    this.notifyListeners();
  }

  /** Update a single step progress value and optionally its visible detail. */
  setStepProgress(step: string, progress: number, detail?: string): void {
    const normalizedProgress = Math.max(0, Math.min(100, progress));
    const previousState = this.status.stepStates?.[step];
    const nextState = previousState === 'error' ? 'error' : normalizedProgress >= 100 ? 'done' : 'active';
    this.status = {
      ...this.status,
      step,
      stepProgress: {
        ...(this.status.stepProgress ?? {}),
        [step]: normalizedProgress,
      },
      stepDetails: detail
        ? {
            ...(this.status.stepDetails ?? {}),
            [step]: detail,
          }
        : this.status.stepDetails,
      stepStates: {
        ...(this.status.stepStates ?? {}),
        [step]: nextState,
      },
      detail: detail ?? this.status.detail,
    };
    this.notifyListeners();
  }

  setStepState(step: string, state: InitStepStatus, detail?: string): void {
    this.status = {
      ...this.status,
      step,
      detail: detail ?? this.status.detail,
      stepDetails: detail
        ? {
            ...(this.status.stepDetails ?? {}),
            [step]: detail,
          }
        : this.status.stepDetails,
      stepStates: {
        ...(this.status.stepStates ?? {}),
        [step]: state,
      },
    };
    this.notifyListeners();
  }

  setRetry(retry: InitRetryStatus): void {
    this.status = { ...this.status, retry };
    this.notifyListeners();
  }

  clearRetry(): void {
    if (!this.status.retry) {
      return;
    }
    this.status = { ...this.status, retry: undefined };
    this.notifyListeners();
  }

  /** Append a timestamped log entry (kept to last 100). */
  addLog(entry: string): void {
    const currentLogs = this.status.logs ?? [];
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const newLogs = [...currentLogs, `[${timestamp}] ${entry}`].slice(-100);
    this.status = { ...this.status, logs: newLogs };
    this.notifyListeners();
  }

  subscribe(listener: (status: InitStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    const status = this.getStatus();
    for (const listener of this.listeners) {
      listener(status);
    }
  }
}

export const initStatusManager = new InitStatusManager();
