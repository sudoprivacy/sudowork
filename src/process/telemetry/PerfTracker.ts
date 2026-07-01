/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * PerfTracker - 性能指标追踪
 *
 * 追踪指标：
 * - cold_start: 应用启动时间 (app.whenReady() → firstWindowShow)
 * - first_screen: 首屏渲染时间 (firstWindowShow → rendererReady)
 * - first_token: 首 token 时间 (streamStart → firstTokenReceived)
 *
 * 注意：由于遥测模块在 app.whenReady() 后才初始化，
 * 性能数据会先缓存，在遥测初始化后再上报。
 */

import { app } from 'electron';
import { getTelemetryReporter } from './TelemetryBatchReporter';
import type { PerfMetricType, PerfData } from '../../shared/types/telemetry';

// ============================================================
// 类型定义
// ============================================================

/** 性能计时点 */
interface PerfTimingPoint {
  metric: PerfMetricType;
  startTime: number;
  endTime?: number;
  sessionId?: string;
}

/** 缓存性能数据 */
interface CachedPerfMetric {
  metric: PerfMetricType;
  value_ms: number;
  sessionId?: string;
}

// ============================================================
// 常量定义
// ============================================================

/** 性能指标名称 */
export const PERF_METRICS = {
  COLD_START: 'cold_start',
  FIRST_SCREEN: 'first_screen',
  FIRST_TOKEN: 'first_token',
} as const;

// ============================================================
// PerfTracker 类
// ============================================================

/**
 * 性能追踪器
 *
 * 单例模式，追踪关键性能指标
 */
export class PerfTracker {
  private static instance: PerfTracker | null = null;

  /** 当前活跃的计时点 */
  private activeTimings: Map<PerfMetricType, PerfTimingPoint> = new Map();

  /** 应用启动时间 */
  private appStartTime: number = 0;

  /** 窗口首次显示时间 */
  private firstWindowShowTime: number = 0;

  /** 渲染进程就绪时间 */
  private rendererReadyTime: number = 0;

  /** 缓存的性能指标（等待遥测初始化后上报） */
  private cachedMetrics: CachedPerfMetric[] = [];

  /** 私有构造函数 */
  private constructor() {
    this.appStartTime = Date.now();
  }

  /** 获取单例实例 */
  public static getInstance(): PerfTracker {
    if (!PerfTracker.instance) {
      PerfTracker.instance = new PerfTracker();
    }
    return PerfTracker.instance;
  }

  /**
   * 标记应用启动开始
   *
   * 在 src/index.ts 的 app.whenReady() 之前调用
   */
  public markAppStart(): void {
    this.appStartTime = Date.now();
  }

  /**
   * 标记窗口首次显示
   *
   * 在 BrowserWindow 的 'ready-to-show' 事件中调用
   */
  public markFirstWindowShow(): void {
    this.firstWindowShowTime = Date.now();

    // 记录冷启动时间
    const coldStartDuration = this.firstWindowShowTime - this.appStartTime;

    // 缓存性能指标（遥测可能还未初始化）
    this.cacheMetric('cold_start', coldStartDuration);
  }

  /**
   * 标记渲染进程就绪
   *
   * 通过 IPC 从渲染进程调用
   */
  public markRendererReady(): void {
    this.rendererReadyTime = Date.now();

    // 记录首屏时间 (从窗口显示到渲染就绪)
    if (this.firstWindowShowTime > 0) {
      const firstScreenDuration = this.rendererReadyTime - this.firstWindowShowTime;

      // 缓存性能指标
      this.cacheMetric('first_screen', firstScreenDuration);
    }
  }

  /**
   * 缓存性能指标
   *
   * 遥测初始化前先缓存，初始化后再上报
   */
  private cacheMetric(metric: PerfMetricType, value_ms: number, sessionId?: string): void {
    this.cachedMetrics.push({ metric, value_ms, sessionId });

    // 尝试立即上报（如果遥测已初始化）
    this.flushCachedMetrics();
  }

  /**
   * 上报缓存的性能指标
   *
   * 在遥测初始化后调用，上报所有缓存的指标
   */
  public flushCachedMetrics(): void {
    if (this.cachedMetrics.length === 0) {
      return;
    }

    const reporter = getTelemetryReporter();
    if (!reporter.getStatus().initialized) {
      // 遥测未初始化，继续缓存
      return;
    }

    // 上报所有缓存的指标
    for (const cached of this.cachedMetrics) {
      reporter.record('perf', {
        metric: cached.metric,
        value_ms: cached.value_ms,
        session_id: cached.sessionId,
      });
    }

    this.cachedMetrics = [];
  }

  /**
   * 开始计时
   *
   * 用于首 token 等需要在会话中追踪的指标
   */
  public startTiming(metric: PerfMetricType, sessionId?: string): void {
    const timing: PerfTimingPoint = {
      metric,
      startTime: Date.now(),
      sessionId,
    };
    this.activeTimings.set(metric, timing);
  }

  /**
   * 结束计时并上报
   */
  public endTiming(metric: PerfMetricType): number | null {
    const timing = this.activeTimings.get(metric);
    if (!timing || !timing.startTime) {
      return null;
    }

    const endTime = Date.now();
    const duration = endTime - timing.startTime;

    timing.endTime = endTime;
    this.activeTimings.delete(metric);

    // 缓存性能指标（遥测可能还未初始化）
    this.cacheMetric(metric, duration, timing.sessionId);

    return duration;
  }

  /**
   * 记录首 token 时间
   *
   * 在对话开始接收第一个 token 时调用
   *
   * @param sessionId - 会话ID
   * @param durationMs - 可选，已计算好的延迟时间（毫秒）。如果不提供，需要预先调用 startTiming('first_token')
   */
  public recordFirstToken(sessionId: string, durationMs?: number): number | null {
    // 查找是否有活跃的首 token 计时
    const timing = this.activeTimings.get('first_token');
    if (timing) {
      return this.endTiming('first_token');
    }

    // 如果提供了 duration，直接使用
    if (durationMs !== undefined && durationMs >= 0) {
      this.cacheMetric('first_token', durationMs, sessionId);
      return durationMs;
    }

    // 没有预先开始计时，也没有提供 duration，无法记录
    return null;
  }

  /**
   * 获取性能摘要
   */
  public getSummary(): {
    coldStart: number | null;
    firstScreen: number | null;
  } {
    return {
      coldStart: this.firstWindowShowTime > 0 ? this.firstWindowShowTime - this.appStartTime : null,
      firstScreen: this.rendererReadyTime > 0 && this.firstWindowShowTime > 0 ? this.rendererReadyTime - this.firstWindowShowTime : null,
    };
  }
}

// ============================================================
// 导出便捷方法
// ============================================================

/** 获取性能追踪器实例 */
export const getPerfTracker = (): PerfTracker => {
  return PerfTracker.getInstance();
};

/** 标记应用启动 */
export const markAppStart = (): void => {
  getPerfTracker().markAppStart();
};

/** 标记窗口首次显示 */
export const markFirstWindowShow = (): void => {
  getPerfTracker().markFirstWindowShow();
};

/** 标记渲染进程就绪 */
export const markRendererReady = (): void => {
  getPerfTracker().markRendererReady();
};

/** 开始计时 */
export const startPerfTiming = (metric: PerfMetricType, sessionId?: string): void => {
  getPerfTracker().startTiming(metric, sessionId);
};

/** 结束计时 */
export const endPerfTiming = (metric: PerfMetricType): number | null => {
  return getPerfTracker().endTiming(metric);
};

/** 记录首 token */
export const recordFirstToken = (sessionId: string, durationMs?: number): number | null => {
  return getPerfTracker().recordFirstToken(sessionId, durationMs);
};

/** 上报缓存的性能指标 */
export const flushPerfCachedMetrics = (): void => {
  getPerfTracker().flushCachedMetrics();
};
