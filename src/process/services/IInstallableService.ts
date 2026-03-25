/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared interface for installable services in Sudowork.
 *
 * Every installable service (Nexus, LibreOffice, Sudoclaw, Claude CLI, etc.)
 * follows the same lifecycle: check if installed, install, report progress,
 * and emit a result. This interface captures that common contract so new
 * services can be added with a consistent shape.
 *
 * @typeParam TStatus - The shape returned by checkInstalled().
 *   Must include at minimum `{ installed: boolean }`.
 *   Services extend this with version, path, source, etc.
 *
 * @typeParam TPhase - Union of string literals for install progress phases.
 *   Each service defines its own phases (e.g., 'downloading' | 'extracting').
 */

// ── Progress & Result types ─────────────────────────────────────────

/** Base install status — all services must report at least this. */
export interface InstallStatus {
  installed: boolean;
}

/** Progress event emitted during installation. */
export interface InstallProgress<TPhase extends string = string> {
  phase: TPhase;
  percent?: number;
  /** Optional human-readable message describing current progress. */
  message?: string;
}

/** Result emitted when installation completes. */
export interface InstallResult {
  success: boolean;
  msg?: string;
}

// ── Core interface ──────────────────────────────────────────────────

/**
 * Minimum contract for any installable service.
 *
 * Services implement this interface to participate in unified install
 * orchestration, status checking, and progress reporting.
 */
export interface IInstallableService<
  TStatus extends InstallStatus = InstallStatus,
  TPhase extends string = string,
> {
  /** Human-readable label for display in UI (e.g., "Nexus Server", "LibreOffice"). */
  readonly label: string;

  /**
   * Check whether the service is currently installed.
   * Returns a status object that includes at least `{ installed: boolean }`.
   */
  checkInstalled(): Promise<TStatus>;

  /**
   * Install the service. Throws on failure.
   * Implementations should report progress via onProgress listeners.
   */
  install(): Promise<void>;

  /**
   * Subscribe to installation progress events.
   * Returns an unsubscribe function.
   */
  onProgress(callback: (progress: InstallProgress<TPhase>) => void): () => void;
}

// ── Optional capability interfaces ──────────────────────────────────

/** Service supports installing from a user-selected local file. */
export interface ILocalFileInstallable {
  installFromLocalFile(filePath: string): Promise<void>;
}

/** Service supports uninstallation. */
export interface IUninstallable {
  uninstall(): Promise<void>;
}

/** Service has a runtime process that can be started/stopped. */
export interface IRunnableService {
  readonly isRunning: boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
}

// ── Type guard helpers ──────────────────────────────────────────────

export function isLocalFileInstallable(service: IInstallableService): service is IInstallableService & ILocalFileInstallable {
  return 'installFromLocalFile' in service && typeof (service as any).installFromLocalFile === 'function';
}

export function isUninstallable(service: IInstallableService): service is IInstallableService & IUninstallable {
  return 'uninstall' in service && typeof (service as any).uninstall === 'function';
}

export function isRunnableService(service: IInstallableService): service is IInstallableService & IRunnableService {
  return 'isRunning' in service && 'start' in service && 'stop' in service;
}
