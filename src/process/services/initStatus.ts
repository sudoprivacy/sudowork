/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Initialization status for runtime dependencies (Node.js, Sudoclaw, Git, etc.)
 */

export type InitPhase = 'pending' | 'installing' | 'ready' | 'error';

export interface InitStatus {
  phase: InitPhase;
  message: string;
  progress: number; // 0-100
  error?: string;
  /** Current installation step id: 'git' | 'node' | 'sudoclaw' | 'nexus' | 'bdpan' */
  step?: string;
  /** Detail message for current step (e.g. "Extracting files... 45%") */
  detail?: string;
  /** Recent log entries (capped at 100). Each entry is pre-formatted with a timestamp. */
  logs?: string[];
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
    this.status = { ...this.status, step, detail };
    this.notifyListeners();
  }

  /** Update only the detail line for the current step (e.g. extraction progress). */
  setDetail(detail: string): void {
    this.status = { ...this.status, detail };
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
