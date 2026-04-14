/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 会话结束系统通知服务 / Session-end system notification service
 *
 * 当客户端一次完整的会话（提示词 → 模型完成）结束时，
 * 通过 Electron 原生 Notification 推送一条系统通知，
 * 让用户即便未停留在 Sudowork 窗口也能第一时间感知会话完成。
 *
 * When a client session (prompt → model finish) completes, push a
 * native OS-level notification via Electron Notification, so that the
 * user is aware even when Sudowork is not the active window.
 */

import { BrowserWindow, Notification } from 'electron';
import type { ISessionEndNotificationConfig } from '@/common/ipcBridge';
import { ProcessConfig } from '@process/initStorage';
import i18n from '@process/i18n';
import { mainLog, mainWarn } from '@process/utils/mainLogger';

/** 默认配置：开启、窗口聚焦时不通知、不静音 / Default: enabled, skip when focused, not silent */
export const DEFAULT_SESSION_END_NOTIFICATION_CONFIG: ISessionEndNotificationConfig = {
  enabled: true,
  notifyWhenFocused: false,
  silent: false,
};

/** 节流间隔：同一会话在该时间窗口内不重复通知 / Throttle window for per-conversation notifications */
const THROTTLE_INTERVAL_MS = 2000;

export type SessionFinishedPayload = {
  /** 会话 ID，用于节流去重 / Conversation id for throttling dedupe */
  conversationId: string;
  /** Agent 后端名称（claude / codex / qwen / openclaw 等），用于通知正文 / Agent backend name for notification body */
  backend?: string;
  /** 可选会话标题，作为 backend 兜底 / Optional conversation title as fallback */
  conversationTitle?: string;
};

/**
 * 抽象的 Notification 构造函数类型，便于在测试中注入 Mock
 * Abstract Notification constructor for test injection
 */
export type NotificationCtor = new (options: Electron.NotificationConstructorOptions) => Electron.Notification;

/** 抽象的 BrowserWindow 查询函数 / Abstract window query function */
export type GetAllWindowsFn = () => Electron.BrowserWindow[];

export type SessionNotificationServiceOptions = {
  notificationCtor?: NotificationCtor;
  isSupported?: () => boolean;
  getAllWindows?: GetAllWindowsFn;
  translate?: (key: string, params?: Record<string, string>) => string;
  now?: () => number;
  /** 设置 Windows AppUserModelID 的回调（可选注入以便测试）/ Callback to set Windows AppUserModelID (optional injection for tests) */
  setAppUserModelId?: (id: string) => void;
  /** Windows AppUserModelID / Windows AppUserModelID */
  appUserModelId?: string;
};

/**
 * 会话结束通知服务
 * Session-end notification service
 */
export class SessionNotificationService {
  private config: ISessionEndNotificationConfig = { ...DEFAULT_SESSION_END_NOTIFICATION_CONFIG };
  private lastNotifiedAt = new Map<string, number>();
  private initialized = false;
  private readonly notificationCtor: NotificationCtor;
  private readonly isSupported: () => boolean;
  private readonly getAllWindows: GetAllWindowsFn;
  private readonly translate: (key: string, params?: Record<string, string>) => string;
  private readonly now: () => number;
  private readonly setAppUserModelId?: (id: string) => void;
  private readonly appUserModelId: string;

  constructor(options: SessionNotificationServiceOptions = {}) {
    this.notificationCtor = options.notificationCtor ?? (Notification as unknown as NotificationCtor);
    this.isSupported = options.isSupported ?? (() => Notification.isSupported());
    this.getAllWindows = options.getAllWindows ?? (() => BrowserWindow.getAllWindows());
    this.translate = options.translate ?? ((key, params) => i18n.t(key, params ?? {}));
    this.now = options.now ?? (() => Date.now());
    this.setAppUserModelId = options.setAppUserModelId;
    this.appUserModelId = options.appUserModelId ?? 'com.sudowork.app';
  }

  /**
   * 从持久化配置初始化，并做必要的平台级设置
   * Load persisted config and perform any platform-level wiring
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    try {
      const stored = await ProcessConfig.get('system.sessionEndNotification');
      if (stored) {
        this.config = { ...DEFAULT_SESSION_END_NOTIFICATION_CONFIG, ...stored };
      }
    } catch (error) {
      mainWarn('SessionNotification', 'Failed to load config, using defaults:', error);
    }

    // Windows: 设置 AppUserModelID 以便通知显示正确的应用名
    // Windows: set AppUserModelID so toast notifications show the correct app name
    if (process.platform === 'win32' && this.setAppUserModelId) {
      try {
        this.setAppUserModelId(this.appUserModelId);
      } catch (error) {
        mainWarn('SessionNotification', 'Failed to set AppUserModelID:', error);
      }
    }
  }

  /** 更新缓存中的设置 / Update cached settings */
  updateSettings(cfg: ISessionEndNotificationConfig): void {
    this.config = { ...DEFAULT_SESSION_END_NOTIFICATION_CONFIG, ...cfg };
  }

  /** 返回当前配置副本 / Return a copy of the current config */
  getSettings(): ISessionEndNotificationConfig {
    return { ...this.config };
  }

  /** 清理节流缓存（主要用于测试）/ Clear throttle cache (mainly for tests) */
  clearThrottle(): void {
    this.lastNotifiedAt.clear();
  }

  /**
   * 请求通知权限（发送一个测试通知触发系统授权弹窗）
   * Request notification permission by sending a test notification to trigger system authorization dialog
   */
  requestPermission(): void {
    try {
      if (!this.isSupported()) {
        mainWarn('SessionNotification', 'Notification is not supported on this platform');
        return;
      }

      // macOS: 发送一个测试通知来触发系统授权请求
      // macOS: send a test notification to trigger system authorization request
      const testNotification = new this.notificationCtor({
        title: 'Sudowork',
        body: '通知权限已启用',
        silent: true,
      });

      testNotification.show();
      mainLog('SessionNotification', 'Sent test notification to request permission');

      // 立即关闭测试通知（通知会自动消失，这里只是清理引用）
      testNotification.close();
    } catch (error) {
      mainWarn('SessionNotification', 'Failed to request notification permission:', error);
    }
  }

  /**
   * 通知一个会话已结束。失败时只记日志，不抛出。
   * Notify that a session has finished. Errors are logged, not thrown.
   */
  notifySessionFinished(payload: SessionFinishedPayload): void {
    try {
      if (!this.config.enabled) return;
      if (!this.isSupported()) return;

      if (!this.config.notifyWhenFocused) {
        const windows = this.getAllWindows();
        const anyFocused = windows.some((w) => !w.isDestroyed() && w.isFocused());
        if (anyFocused) return;
      }

      const currentTime = this.now();
      const last = this.lastNotifiedAt.get(payload.conversationId);
      if (last !== undefined && currentTime - last < THROTTLE_INTERVAL_MS) {
        return;
      }
      this.lastNotifiedAt.set(payload.conversationId, currentTime);

      const title = this.translate('notification.sessionEnd.title');
      const body = this.translate('notification.sessionEnd.body');

      const notification = new this.notificationCtor({
        title,
        body,
        silent: this.config.silent,
      });

      notification.on('click', () => {
        try {
          const windows = this.getAllWindows();
          const target = windows.find((w) => !w.isDestroyed());
          if (target) {
            if (target.isMinimized()) target.restore();
            target.show();
            target.focus();
          }
        } catch (error) {
          mainWarn('SessionNotification', 'Failed to handle notification click:', error);
        }
      });

      notification.show();
      mainLog('SessionNotification', `Notified session finish: ${payload.conversationId}`);
    } catch (error) {
      mainWarn('SessionNotification', 'Failed to show notification:', error);
    }
  }
}

// 单例实例 / Singleton
export const sessionNotificationService = new SessionNotificationService();
