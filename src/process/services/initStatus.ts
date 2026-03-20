/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Initialization status for runtime dependencies (Node.js, Sudoclaw)
 */

export type InitPhase = 'pending' | 'installing' | 'ready' | 'error';

export interface InitStatus {
  phase: InitPhase;
  message: string;
  progress: number; // 0-100
  error?: string;
}

class InitStatusManager {
  private status: InitStatus = { phase: 'pending', message: '准备初始化...', progress: 0 };
  private listeners: Set<(status: InitStatus) => void> = new Set();

  getStatus(): InitStatus {
    return { ...this.status };
  }

  setStatus(phase: InitPhase, message: string, progress: number = 0, error?: string): void {
    this.status = { phase, message, progress, error };
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
