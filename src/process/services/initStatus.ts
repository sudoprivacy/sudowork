/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Initialization status for runtime dependencies (Node.js, Sudoclaw)
 */

export type InitPhase = 'pending' | 'installing-node' | 'installing-sudoclaw' | 'ready' | 'error';

export interface InitStatus {
  phase: InitPhase;
  message: string;
  error?: string;
}

class InitStatusManager {
  private status: InitStatus = { phase: 'pending', message: '准备初始化...' };
  private listeners: Set<(status: InitStatus) => void> = new Set();

  getStatus(): InitStatus {
    return { ...this.status };
  }

  setStatus(phase: InitPhase, message: string, error?: string): void {
    this.status = { phase, message, error };
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
