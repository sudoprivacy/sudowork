/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Main Process Logger
 *
 * 统一日志管理，所有日志写入 ~/.nexus/logs/sudoclaw.log
 * Unified logger writing to ~/.nexus/logs/sudoclaw.log
 *
 * 格式: [级别] YYYY-MM-DD HH:mm:ss [类型] 内容
 * Format: [LEVEL] YYYY-MM-DD HH:mm:ss [TYPE] message
 */

import { appendFileSync, existsSync, mkdirSync, statSync, renameSync, readFileSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import { ipcBridge } from '@/common';

// 日志级别
type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'PERF';

// 日志配置
const LOG_FILE = 'sudoclaw.log';
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB 后轮转

let logsDir: string | null = null;

/**
 * 获取日志目录 ~/.nexus/logs/
 */
function getLogsDir(): string {
  if (!logsDir) {
    // 使用 getDataPath 获取 ~/.nexus
    const homePath = app.getPath('home');
    const nexusPath = join(homePath, '.nexus');
    logsDir = join(nexusPath, 'logs');

    // 确保目录存在
    if (!existsSync(logsDir)) {
      mkdirSync(logsDir, { recursive: true });
    }
  }
  return logsDir;
}

function getLogPath(): string {
  return join(getLogsDir(), LOG_FILE);
}

function serializeLogData(data: unknown): string {
  if (data instanceof Error) {
    const payload = {
      name: data.name,
      message: data.message,
      stack: data.stack,
    };
    return ` ${JSON.stringify(payload)}`;
  }

  if (typeof data === 'object') {
    try {
      return ` ${JSON.stringify(data)}`;
    } catch {
      return ` ${String(data)}`;
    }
  }

  return ` ${String(data)}`;
}

/**
 * 日志轮转：超过 5MB 后备份
 */
function rotateLogIfNeeded(): void {
  try {
    const logPath = getLogPath();
    if (existsSync(logPath)) {
      const stats = statSync(logPath);
      if (stats.size > MAX_LOG_SIZE) {
        const backupPath = `${logPath}.old`;
        try {
          renameSync(logPath, backupPath);
        } catch {
          // 忽略轮转错误
        }
      }
    }
  } catch {
    // 忽略错误
  }
}

/**
 * 格式化时间戳
 */
function formatTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

/**
 * 写入日志
 */
function writeLog(level: LogLevel, tag: string, message: string, data?: unknown): void {
  const timestamp = formatTimestamp();
  const dataStr = data !== undefined ? serializeLogData(data) : '';
  const logLine = `[${level}] ${timestamp} [${tag}] ${message}${dataStr}\n`;

  // 打印到控制台
  if (level === 'ERROR') {
    console.error(logLine.trim());
  } else if (level === 'WARN') {
    console.warn(logLine.trim());
  } else {
    console.log(logLine.trim());
  }

  // 发送到渲染进程 DevTools
  try {
    ipcBridge.application.logStream.emit({
      level: level === 'PERF' ? 'log' : (level.toLowerCase() as 'log' | 'warn' | 'error'),
      tag,
      message,
      data,
    });
  } catch {
    // 渲染进程可能未准备好
  }

  // 写入文件
  try {
    rotateLogIfNeeded();
    appendFileSync(getLogPath(), logLine, 'utf-8');
  } catch (error) {
    console.warn('[Logger] Failed to write log file:', error);
  }
}

/**
 * 调试日志
 */
export function mainDebug(tag: string, message: string, data?: unknown): void {
  writeLog('DEBUG', tag, message, data);
}

/**
 * 信息日志
 */
export function mainLog(tag: string, message: string, data?: unknown): void {
  writeLog('INFO', tag, message, data);
}

/**
 * 警告日志
 */
export function mainWarn(tag: string, message: string, data?: unknown): void {
  writeLog('WARN', tag, message, data);
}

/**
 * 错误日志
 */
export function mainError(tag: string, message: string, data?: unknown): void {
  writeLog('ERROR', tag, message, data);
}

/**
 * 性能日志
 * 格式: [PERF] 时间 [Perf] 事件名称 耗时ms
 */
export function perfLog(event: string, durationMs: number, details?: Record<string, unknown>): void {
  const detailsStr = details
    ? ` | ${Object.entries(details)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')}`
    : '';
  writeLog('PERF', 'Perf', `${event}: ${durationMs}ms${detailsStr}`);
}

/**
 * 读取最近的日志
 */
export function readRecentLogs(maxLines = 100): string[] {
  try {
    const logPath = getLogPath();
    if (!existsSync(logPath)) return [];

    const content = readFileSync(logPath, 'utf-8');
    return content.trim().split('\n').slice(-maxLines);
  } catch {
    return [];
  }
}

// 导出兼容旧代码的别名
export { mainLog as mainInfo };
