/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * BreadcrumbTracker - 面包屑追踪模块
 *
 * 功能:
 * - 记录关键操作节点
 * - 为 Crash 事件提供操作链路上下文
 * - 支持多种分类 (conversation, api, mcp, file, window, etc.)
 */

import { addCrashBreadcrumb } from './CrashReporter';

// ============================================================
// 类型定义
// ============================================================

/** 面包屑分类 */
type BreadcrumbCategory = 'conversation' | 'api' | 'mcp' | 'file' | 'window' | 'navigation' | 'user' | 'system';

// ============================================================
// 面包屑追踪方法
// ============================================================

/**
 * 对话相关面包屑
 */
export const conversationBreadcrumbs = {
  /** 对话开始 */
  start(sessionId: string, modelId: string, backend?: string): void {
    addCrashBreadcrumb('conversation', 'Conversation started', {
      session_id: sessionId,
      model_id: modelId,
      backend,
    });
  },

  /** 对话结束 */
  end(sessionId: string, status: string, durationMs?: number): void {
    addCrashBreadcrumb('conversation', 'Conversation ended', {
      session_id: sessionId,
      status,
      duration_ms: durationMs,
    });
  },

  /** 发送消息 */
  sendMessage(sessionId: string, messageLength: number): void {
    addCrashBreadcrumb('conversation', 'Message sent', {
      session_id: sessionId,
      message_length: messageLength,
    });
  },

  /** 收到响应 */
  receiveResponse(sessionId: string, tokenCount?: number): void {
    addCrashBreadcrumb('conversation', 'Response received', {
      session_id: sessionId,
      token_count: tokenCount,
    });
  },

  /** 用户取消 */
  userCancel(sessionId: string): void {
    addCrashBreadcrumb(
      'conversation',
      'User cancelled',
      {
        session_id: sessionId,
      },
      'warning'
    );
  },

  /** 错误发生 */
  error(sessionId: string, errorCode: string, errorMessage?: string): void {
    addCrashBreadcrumb(
      'conversation',
      'Conversation error',
      {
        session_id: sessionId,
        error_code: errorCode,
        error_message: errorMessage,
      },
      'error'
    );
  },
};

/**
 * API 相关面包屑
 */
export const apiBreadcrumbs = {
  /** API 请求开始 */
  request(url: string, method: string, sessionId?: string): void {
    addCrashBreadcrumb('api', `API ${method} request`, {
      url: url.slice(-100), // 只保留最后 100 字符
      method,
      session_id: sessionId,
    });
  },

  /** API 请求成功 */
  responseSuccess(url: string, statusCode: number, durationMs?: number): void {
    addCrashBreadcrumb('api', 'API response success', {
      url: url.slice(-100),
      status_code: statusCode,
      duration_ms: durationMs,
    });
  },

  /** API 请求失败 */
  responseError(url: string, statusCode: number, errorMessage?: string): void {
    addCrashBreadcrumb(
      'api',
      'API response error',
      {
        url: url.slice(-100),
        status_code: statusCode,
        error_message: errorMessage,
      },
      'error'
    );
  },

  /** 网络错误 */
  networkError(url: string, errorMessage: string): void {
    addCrashBreadcrumb(
      'api',
      'Network error',
      {
        url: url.slice(-100),
        error_message: errorMessage,
      },
      'error'
    );
  },

  /** 流式响应中断 */
  streamInterrupted(url: string, sessionId?: string): void {
    addCrashBreadcrumb(
      'api',
      'Stream interrupted',
      {
        url: url.slice(-100),
        session_id: sessionId,
      },
      'error'
    );
  },
};

/**
 * MCP 相关面包屑
 */
export const mcpBreadcrumbs = {
  /** MCP 服务连接 */
  serverConnect(serverName: string, status: 'success' | 'error'): void {
    addCrashBreadcrumb(
      'mcp',
      'MCP server connect',
      {
        server_name: serverName,
        status,
      },
      status === 'error' ? 'error' : 'info'
    );
  },

  /** MCP 工具调用 */
  toolCall(toolName: string, serverName: string, sessionId?: string): void {
    addCrashBreadcrumb('mcp', 'MCP tool called', {
      tool_name: toolName,
      server_name: serverName,
      session_id: sessionId,
    });
  },

  /** MCP 工具调用结果 */
  toolResult(toolName: string, success: boolean, durationMs?: number): void {
    addCrashBreadcrumb(
      'mcp',
      'MCP tool result',
      {
        tool_name: toolName,
        success,
        duration_ms: durationMs,
      },
      success ? 'info' : 'error'
    );
  },

  /** MCP 资源访问 */
  resourceAccess(uri: string, serverName: string): void {
    addCrashBreadcrumb('mcp', 'MCP resource access', {
      uri: uri.slice(-100),
      server_name: serverName,
    });
  },
};

/**
 * 文件操作相关面包屑
 */
export const fileBreadcrumbs = {
  /** 文件读取 */
  read(filePath: string, size?: number): void {
    addCrashBreadcrumb('file', 'File read', {
      operation: 'read',
      path: filePath.slice(-50),
      size,
    });
  },

  /** 文件写入 */
  write(filePath: string, size?: number): void {
    addCrashBreadcrumb('file', 'File write', {
      operation: 'write',
      path: filePath.slice(-50),
      size,
    });
  },

  /** 文件删除 */
  delete(filePath: string): void {
    addCrashBreadcrumb('file', 'File delete', {
      operation: 'delete',
      path: filePath.slice(-50),
    });
  },

  /** 目录创建 */
  createDir(dirPath: string): void {
    addCrashBreadcrumb('file', 'Directory created', {
      operation: 'create_dir',
      path: dirPath.slice(-50),
    });
  },

  /** 文件操作错误 */
  error(operation: string, filePath: string, errorMessage?: string): void {
    addCrashBreadcrumb(
      'file',
      'File operation error',
      {
        operation,
        path: filePath.slice(-50),
        error_message: errorMessage,
      },
      'error'
    );
  },
};

/**
 * 窗口相关面包屑
 */
export const windowBreadcrumbs = {
  /** 窗口创建 */
  create(windowId: string, windowType?: string): void {
    addCrashBreadcrumb('window', 'Window created', {
      window_id: windowId,
      window_type: windowType,
    });
  },

  /** 窗口关闭 */
  close(windowId: string): void {
    addCrashBreadcrumb('window', 'Window closed', {
      window_id: windowId,
    });
  },

  /** 窗口聚焦 */
  focus(windowId: string): void {
    addCrashBreadcrumb('window', 'Window focused', {
      window_id: windowId,
    });
  },

  /** DevTools 打开 */
  devToolsOpen(windowId: string): void {
    addCrashBreadcrumb('window', 'DevTools opened', {
      window_id: windowId,
    });
  },

  /** 页面导航 */
  navigate(url: string): void {
    addCrashBreadcrumb('navigation', 'Page navigate', {
      url: url.slice(-100),
    });
  },

  /** 页面加载完成 */
  loadComplete(url: string, durationMs?: number): void {
    addCrashBreadcrumb('navigation', 'Page loaded', {
      url: url.slice(-100),
      duration_ms: durationMs,
    });
  },

  /** 页面加载错误 */
  loadError(url: string, errorMessage?: string): void {
    addCrashBreadcrumb(
      'navigation',
      'Page load error',
      {
        url: url.slice(-100),
        error_message: errorMessage,
      },
      'error'
    );
  },
};

/**
 * 用户操作相关面包屑
 */
export const userBreadcrumbs = {
  /** 用户登录 */
  login(method?: string): void {
    addCrashBreadcrumb('user', 'User login', {
      method,
    });
  },

  /** 用户退出 */
  logout(): void {
    addCrashBreadcrumb('user', 'User logout');
  },

  /** 设置变更 */
  settingsChange(key: string, value?: unknown): void {
    addCrashBreadcrumb('user', 'Settings changed', {
      key,
      value: typeof value === 'string' ? value.slice(-50) : value,
    });
  },

  /** 快捷键触发 */
  shortcut(shortcutId: string): void {
    addCrashBreadcrumb('user', 'Shortcut triggered', {
      shortcut_id: shortcutId,
    });
  },

  /** 拖拽文件 */
  dragFile(filePath: string): void {
    addCrashBreadcrumb('user', 'File dragged', {
      path: filePath.slice(-50),
    });
  },

  /** 选择模型 */
  selectModel(modelId: string, provider?: string): void {
    addCrashBreadcrumb('user', 'Model selected', {
      model_id: modelId,
      provider,
    });
  },
};

/**
 * 系统相关面包屑
 */
export const systemBreadcrumbs = {
  /** 应用启动 */
  appStart(): void {
    addCrashBreadcrumb('system', 'App started');
  },

  /** 应用退出 */
  appQuit(reason?: string): void {
    addCrashBreadcrumb('system', 'App quitting', {
      reason,
    });
  },

  /** 系统错误 */
  systemError(errorType: string, errorMessage?: string): void {
    addCrashBreadcrumb(
      'system',
      'System error',
      {
        error_type: errorType,
        error_message: errorMessage,
      },
      'error'
    );
  },

  /** 内存警告 */
  memoryWarning(usedMB?: number): void {
    addCrashBreadcrumb(
      'system',
      'Memory warning',
      {
        used_mb: usedMB,
      },
      'warning'
    );
  },

  /** GPU 进程崩溃 */
  gpuCrash(): void {
    addCrashBreadcrumb('system', 'GPU process crash', {}, 'error');
  },

  /** 扩展加载 */
  extensionLoad(extensionName: string, success: boolean): void {
    addCrashBreadcrumb(
      'system',
      'Extension loaded',
      {
        extension_name: extensionName,
        success,
      },
      success ? 'info' : 'error'
    );
  },
};

// ============================================================
// 综合导出
// ============================================================

/** 面包屑追踪器 - 综合导出 */
export const breadcrumbTracker = {
  conversation: conversationBreadcrumbs,
  api: apiBreadcrumbs,
  mcp: mcpBreadcrumbs,
  file: fileBreadcrumbs,
  window: windowBreadcrumbs,
  user: userBreadcrumbs,
  system: systemBreadcrumbs,
};

/**
 * 通用面包屑添加方法
 *
 * @param category - 分类
 * @param message - 消息
 * @param data - 额外数据
 * @param level - 日志级别
 */
export const trackBreadcrumb = (category: BreadcrumbCategory | string, message: string, data?: Record<string, unknown>, level?: 'debug' | 'info' | 'warning' | 'error'): void => {
  addCrashBreadcrumb(category, message, data, level);
};
