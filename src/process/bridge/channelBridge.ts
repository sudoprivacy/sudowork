/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { channel } from '@/common/ipcBridge';
import { getDatabase } from '@/process/database';
import { getChannelManager } from '@/channels/core/ChannelManager';
import { getPairingService } from '@/channels/pairing/PairingService';
import { ExtensionRegistry } from '@/extensions';
import { toAssetUrl } from '@/extensions/assetProtocol';
import * as path from 'path';
import type { IChannelPluginStatus, IChannelUser, IChannelPairingRequest, IChannelSession } from '@/channels/types';
import { hasPluginCredentials, rowToChannelUser, rowToChannelSession, rowToPairingRequest } from '@/channels/types';
import { mainLog, mainWarn, mainError } from '@process/utils/mainLogger';

/**
 * Initialize Channel IPC Bridge
 * Handles communication between renderer (Settings UI) and main process (Channel system)
 */
export function initChannelBridge(): void {
  mainLog('ChannelBridge', 'Initializing...');

  // ==================== Plugin Management ====================

  /**
   * Get status of all plugins (including extension plugin metadata)
   */
  channel.getPluginStatus.provider(async () => {
    try {
      const BUILTIN_TYPES = new Set(['telegram', 'lark', 'dingtalk', 'wechat', 'wecom', 'zentao']);

      let dbPlugins: import('@/channels/types').IChannelPluginConfig[] = [];
      try {
        const db = getDatabase();
        const result = db.getChannelPlugins();
        if (result.success && Array.isArray(result.data)) {
          dbPlugins = result.data;
        }
      } catch (dbError) {
        mainWarn('ChannelBridge', 'getChannelPlugins failed, proceeding with builtin-only list:', dbError);
      }

      // Pre-fetch extension plugin metadata (lazy, cached by registry)
      const registry = ExtensionRegistry.getInstance();

      const extensions = registry.getLoadedExtensions();
      const resolveExtensionMeta = (pluginType: string): IChannelPluginStatus['extensionMeta'] | undefined => {
        try {
          const meta = registry.getChannelPluginMeta(pluginType);
          if (!meta || typeof meta !== 'object') return undefined;
          const m = meta as Record<string, unknown>;
          const extensionMeta: NonNullable<IChannelPluginStatus['extensionMeta']> = {
            credentialFields: Array.isArray(m.credentialFields) ? m.credentialFields : undefined,
            configFields: Array.isArray(m.configFields) ? m.configFields : undefined,
            description: typeof m.description === 'string' ? m.description : undefined,
          };

          const ext = extensions.find((e) => e.manifest.contributes.channelPlugins?.some((cp) => cp.type === pluginType));
          if (ext) {
            extensionMeta.extensionName = ext.manifest.displayName || ext.manifest.name;
            const iconField = typeof m.icon === 'string' ? m.icon : undefined;
            if (iconField) {
              if (iconField.startsWith('http://') || iconField.startsWith('https://') || iconField.startsWith('data:') || iconField.startsWith('file://') || iconField.startsWith('aion-asset://')) {
                extensionMeta.icon = iconField;
              } else {
                const absPath = path.isAbsolute(iconField) ? iconField : path.resolve(ext.directory, iconField);
                extensionMeta.icon = toAssetUrl(absPath);
              }
            }
          }

          return extensionMeta;
        } catch {
          return undefined;
        }
      };

      // Build a set of channel types whose parent extension is currently enabled
      const enabledExtChannelTypes = new Set<string>();
      for (const [pluginType] of registry.getChannelPlugins()) {
        enabledExtChannelTypes.add(pluginType);
      }

      const statusMap = new Map<string, IChannelPluginStatus>();

      for (const plugin of dbPlugins) {
        const isExtension = !BUILTIN_TYPES.has(plugin.type);

        // Skip extension channels whose parent extension is not loaded/enabled
        if (isExtension && !enabledExtChannelTypes.has(plugin.type)) {
          continue;
        }

        statusMap.set(plugin.type, {
          id: plugin.id,
          type: plugin.type,
          name: plugin.name,
          enabled: plugin.enabled,
          connected: plugin.status === 'running',
          status: plugin.status,
          lastConnected: plugin.lastConnected,
          activeUsers: 0,
          hasToken: hasPluginCredentials(plugin.type, plugin.credentials),
          isExtension,
          extensionMeta: isExtension ? resolveExtensionMeta(plugin.type) : undefined,
        });
      }

      // Ensure extension-contributed channel plugins are always visible in settings
      // even before first enable (i.e. not yet persisted in DB).
      for (const [pluginType, entry] of registry.getChannelPlugins()) {
        if (statusMap.has(pluginType)) continue;
        const extensionMeta = resolveExtensionMeta(pluginType);
        const meta = entry.meta as { name?: string } | undefined;
        statusMap.set(pluginType, {
          id: pluginType,
          type: pluginType,
          name: meta?.name || pluginType,
          enabled: false,
          connected: false,
          status: 'stopped',
          activeUsers: 0,
          hasToken: false,
          isExtension: true,
          extensionMeta,
        });
      }

      // Ensure builtin channel types are always visible in settings
      // even before user configures them (i.e. not yet persisted in DB).
      const BUILTIN_NAMES: Record<string, string> = {
        telegram: 'Telegram',
        lark: 'Lark',
        dingtalk: 'DingTalk',
        wechat: 'WeChat',
        wecom: 'WeCom',
        zentao: 'Zentao',
      };
      for (const builtinType of BUILTIN_TYPES) {
        if (statusMap.has(builtinType)) continue;
        statusMap.set(builtinType, {
          id: builtinType,
          type: builtinType,
          name: BUILTIN_NAMES[builtinType] || builtinType,
          enabled: false,
          connected: false,
          status: 'stopped',
          activeUsers: 0,
          hasToken: false,
          isExtension: false,
        });
      }

      return { success: true, data: Array.from(statusMap.values()) };
    } catch (error: any) {
      mainError('ChannelBridge', 'getPluginStatus error:', error);
      return { success: false, msg: error.message };
    }
  });

  /**
   * Get decrypted credentials for a plugin (for backfill in settings UI)
   */
  channel.getPluginCredentials.provider(async ({ pluginId }) => {
    try {
      const db = getDatabase();
      // getChannelPlugin already decrypts credentials via decryptCredentials
      const result = db.getChannelPlugin(pluginId);

      if (!result.success || !result.data) {
        return { success: false, msg: result.error || 'Plugin not found' };
      }

      const plugin = result.data;
      if (!plugin.credentials) {
        return { success: true, data: null };
      }

      // Credentials are already decrypted by getChannelPlugin (via decryptCredentials)
      // Just return them directly
      return { success: true, data: plugin.credentials };
    } catch (error: any) {
      mainError('ChannelBridge', 'getPluginCredentials error:', error);
      return { success: false, msg: error.message };
    }
  });

  /**
   * Enable a plugin
   */
  channel.enablePlugin.provider(async ({ pluginId, config }) => {
    try {
      const manager = getChannelManager();
      const result = await manager.enablePlugin(pluginId, config);

      if (!result.success) {
        return { success: false, msg: result.error };
      }

      return { success: true };
    } catch (error: any) {
      mainError('ChannelBridge', 'enablePlugin error:', error);
      return { success: false, msg: error.message };
    }
  });

  /**
   * Disable a plugin
   */
  channel.disablePlugin.provider(async ({ pluginId }) => {
    try {
      const manager = getChannelManager();
      const result = await manager.disablePlugin(pluginId);

      if (!result.success) {
        return { success: false, msg: result.error };
      }

      return { success: true };
    } catch (error: any) {
      mainError('ChannelBridge', 'disablePlugin error:', error);
      return { success: false, msg: error.message };
    }
  });

  /**
   * Test plugin connection (validate token)
   */
  channel.testPlugin.provider(async ({ pluginId, token, extraConfig }) => {
    try {
      const manager = getChannelManager();
      const result = await manager.testPlugin(pluginId, token, extraConfig);
      return { success: true, data: result };
    } catch (error: any) {
      mainError('ChannelBridge', 'testPlugin error:', error);
      return { success: false, data: { success: false, error: error.message } };
    }
  });

  // ==================== Pairing Management ====================

  /**
   * Get pending pairing requests
   */
  channel.getPendingPairings.provider(async () => {
    try {
      const db = getDatabase();
      const result = db.getPendingPairingRequests();

      mainLog('ChannelBridge', `getPendingPairings: success=${result.success}, count=${result.data?.length || 0}`);
      if (result.data && result.data.length > 0) {
        mainLog('ChannelBridge', `getPendingPairings: codes=${result.data.map((p) => `${p.code}(${p.platformType})`).join(', ')}`);
      }

      if (!result.success || !result.data) {
        return { success: false, msg: result.error };
      }

      return { success: true, data: result.data };
    } catch (error: any) {
      mainError('ChannelBridge', 'getPendingPairings error:', error);
      return { success: false, msg: error.message };
    }
  });

  /**
   * Approve a pairing request
   * Delegates to PairingService to avoid duplicate logic
   */
  channel.approvePairing.provider(async ({ code }) => {
    try {
      const pairingService = getPairingService();
      const result = await pairingService.approvePairing(code);

      if (!result.success) {
        return { success: false, msg: result.error };
      }

      mainLog('ChannelBridge', `Approved pairing for code ${code}`);
      return { success: true };
    } catch (error: any) {
      mainError('ChannelBridge', 'approvePairing error:', error);
      return { success: false, msg: error.message };
    }
  });

  /**
   * Reject a pairing request
   * Delegates to PairingService to avoid duplicate logic
   */
  channel.rejectPairing.provider(async ({ code }) => {
    try {
      const pairingService = getPairingService();
      const result = await pairingService.rejectPairing(code);

      if (!result.success) {
        return { success: false, msg: result.error };
      }

      mainLog('ChannelBridge', `Rejected pairing code ${code}`);
      return { success: true };
    } catch (error: any) {
      mainError('ChannelBridge', 'rejectPairing error:', error);
      return { success: false, msg: error.message };
    }
  });

  // ==================== User Management ====================

  /**
   * Get all authorized users
   */
  channel.getAuthorizedUsers.provider(async () => {
    try {
      const db = getDatabase();
      const result = db.getChannelUsers();

      if (!result.success || !result.data) {
        return { success: false, msg: result.error };
      }

      return { success: true, data: result.data };
    } catch (error: any) {
      mainError('ChannelBridge', 'getAuthorizedUsers error:', error);
      return { success: false, msg: error.message };
    }
  });

  /**
   * Revoke user authorization
   */
  channel.revokeUser.provider(async ({ userId }) => {
    try {
      const db = getDatabase();

      // Delete user (cascades to sessions)
      const result = db.deleteChannelUser(userId);

      if (!result.success) {
        return { success: false, msg: result.error };
      }

      mainLog('ChannelBridge', `Revoked user ${userId}`);
      return { success: true };
    } catch (error: any) {
      mainError('ChannelBridge', 'revokeUser error:', error);
      return { success: false, msg: error.message };
    }
  });

  // ==================== Session Management ====================

  /**
   * Get active sessions
   */
  channel.getActiveSessions.provider(async () => {
    try {
      const db = getDatabase();
      const result = db.getChannelSessions();

      if (!result.success || !result.data) {
        return { success: false, msg: result.error };
      }

      return { success: true, data: result.data };
    } catch (error: any) {
      mainError('ChannelBridge', 'getActiveSessions error:', error);
      return { success: false, msg: error.message };
    }
  });

  // ==================== Settings Sync ====================

  /**
   * Sync channel settings after agent or model change
   */
  channel.syncChannelSettings.provider(async ({ platform, agent, model }) => {
    try {
      const manager = getChannelManager();
      const result = await manager.syncChannelSettings(platform, agent, model);
      if (!result.success) {
        return { success: false, msg: result.error };
      }
      return { success: true };
    } catch (error: any) {
      mainError('ChannelBridge', 'syncChannelSettings error:', error);
      return { success: false, msg: error.message };
    }
  });

  // ==================== WeChat QR Login ====================

  let wechatQrLoginAbort: AbortController | null = null;

  /**
   * Start WeChat QR login flow
   * Creates a temporary API client, requests QR code, polls for status
   */
  channel.wechatStartQrLogin.provider(async () => {
    try {
      // Cancel any previous login attempt
      if (wechatQrLoginAbort) {
        wechatQrLoginAbort.abort();
      }
      wechatQrLoginAbort = new AbortController();
      const signal = wechatQrLoginAbort.signal;

      // Use a temporary API client with empty token for QR login
      const { WeChatApiClient } = await import('@/channels/plugins/wechat/WeChatApiClient');
      const client = new WeChatApiClient('');

      // Request QR code
      const qrResponse = await client.startQrLogin();
      if (!qrResponse.qrcode || !qrResponse.qrcode_img_content) {
        channel.wechatQrLogin.emit({
          phase: 'error',
          message: qrResponse.errmsg || 'Failed to get QR code',
        });
        return { success: false, msg: qrResponse.errmsg || 'Failed to get QR code' };
      }

      const qrcodeToken = qrResponse.qrcode;
      const qrUrl = qrResponse.qrcode_img_content;

      // Emit QR code URL to renderer
      channel.wechatQrLogin.emit({
        phase: 'qrcode',
        qrUrl,
      });

      // Poll for scan status every 3 seconds
      const pollInterval = 3000;
      const maxPolls = 100; // ~5 min timeout

      for (let i = 0; i < maxPolls; i++) {
        if (signal.aborted) return { success: true };

        await new Promise((resolve) => setTimeout(resolve, pollInterval));

        if (signal.aborted) return { success: true };

        try {
          const statusResponse = await client.pollQrStatus(qrcodeToken);

          if (statusResponse.status === 'scaned') {
            channel.wechatQrLogin.emit({ phase: 'scanned' });
          } else if (statusResponse.status === 'confirmed') {
            const botToken = statusResponse.bot_token || '';
            const accountId = statusResponse.ilink_bot_id || '';

            channel.wechatQrLogin.emit({
              phase: 'confirmed',
              botToken,
              accountId,
            });

            wechatQrLoginAbort = null;
            return { success: true };
          } else if (statusResponse.status === 'expired') {
            channel.wechatQrLogin.emit({
              phase: 'timeout',
              message: 'QR code expired. Please try again.',
            });
            wechatQrLoginAbort = null;
            return { success: true };
          }
        } catch (pollError: any) {
          if (signal.aborted) return { success: true };
          mainWarn('ChannelBridge', 'WeChat QR poll error:', pollError);
          // Continue polling on transient errors
        }
      }

      // Timeout after max polls
      channel.wechatQrLogin.emit({
        phase: 'timeout',
        message: 'Login timed out. Please try again.',
      });
      wechatQrLoginAbort = null;
      return { success: true };
    } catch (error: any) {
      mainError('ChannelBridge', 'wechatStartQrLogin error:', error);
      channel.wechatQrLogin.emit({
        phase: 'error',
        message: error.message || 'Failed to start QR login',
      });
      wechatQrLoginAbort = null;
      return { success: false, msg: error.message };
    }
  });

  /**
   * Cancel WeChat QR login flow
   */
  channel.wechatCancelQrLogin.provider(async () => {
    if (wechatQrLoginAbort) {
      wechatQrLoginAbort.abort();
      wechatQrLoginAbort = null;
    }
    return { success: true };
  });

  // ==================== Lark CLI QR Login (device flow) ====================

  let larkCliLoginAbort: AbortController | null = null;

  channel.larkCliStart.provider(async ({ brand = 'feishu' } = {}) => {
    try {
      if (larkCliLoginAbort) {
        larkCliLoginAbort.abort();
      }
      larkCliLoginAbort = new AbortController();
      const signal = larkCliLoginAbort.signal;

      const { getLarkCliAuthService } = await import('@/process/services/larkCli/LarkCliAuthService');
      const service = getLarkCliAuthService();

      if (!service.isInstalled()) {
        const msg = `lark-cli not installed (expected at ${service.getBinPath()})`;
        channel.larkCliLogin.emit({ phase: 'error', message: msg });
        larkCliLoginAbort = null;
        return { success: false, msg };
      }

      channel.larkCliLogin.emit({ phase: 'initializing' });

      // Stage A: if lark-cli has no app configured yet, create one via `config init --new`.
      const alreadyConfigured = await service.isConfigured();
      if (!alreadyConfigured) {
        const initHandle = service.startConfigInitNew(
          brand === 'lark' ? 'lark' : 'feishu',
          (url) => {
            channel.larkCliLogin.emit({ phase: 'app-setup', verificationUrl: url });
          },
          signal
        );
        try {
          await initHandle.url;
        } catch (urlErr: any) {
          if (signal.aborted) {
            larkCliLoginAbort = null;
            return { success: true };
          }
          const msg = urlErr?.message ?? 'Failed to obtain Feishu app setup URL';
          channel.larkCliLogin.emit({ phase: 'error', message: msg });
          larkCliLoginAbort = null;
          return { success: false, msg };
        }
        const initResult = await initHandle.done;
        if (signal.aborted) {
          larkCliLoginAbort = null;
          return { success: true };
        }
        if (!initResult.ok) {
          channel.larkCliLogin.emit({ phase: 'error', message: initResult.error ?? 'config init failed' });
          larkCliLoginAbort = null;
          return { success: false, msg: initResult.error };
        }
      }

      // Stage B: device-flow OAuth login.
      const start = await service.startDeviceFlow();
      if (signal.aborted) {
        larkCliLoginAbort = null;
        return { success: true };
      }
      if (start.ok !== true) {
        const failure = start;
        const fullMsg = failure.hint ? `${failure.error} — ${failure.hint}` : failure.error;
        channel.larkCliLogin.emit({ phase: 'error', message: fullMsg });
        larkCliLoginAbort = null;
        return { success: false, msg: fullMsg };
      }

      channel.larkCliLogin.emit({
        phase: 'qrcode',
        verificationUrl: start.verificationUrl,
        userCode: start.userCode,
        expiresAt: start.expiresAt,
      });

      const deviceCode = start.deviceCode;
      const intervalMs = Math.max(start.intervalMs, 2000);
      const expiresAt = start.expiresAt;

      while (Date.now() < expiresAt) {
        if (signal.aborted) {
          larkCliLoginAbort = null;
          return { success: true };
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        if (signal.aborted) {
          larkCliLoginAbort = null;
          return { success: true };
        }

        try {
          const pollResult = await service.pollDeviceCode(deviceCode);
          if (pollResult.status === 'success') {
            const app = await service.getConfigApp();
            channel.larkCliLogin.emit({
              phase: 'success',
              user: pollResult.user,
              token: pollResult.token,
              appId: app.appId,
              appSecret: app.appSecret,
            });
            larkCliLoginAbort = null;
            return { success: true };
          }
          if (pollResult.status === 'expired') {
            channel.larkCliLogin.emit({ phase: 'expired', message: 'Authorization code expired' });
            larkCliLoginAbort = null;
            return { success: true };
          }
          if (pollResult.status === 'failed') {
            channel.larkCliLogin.emit({ phase: 'error', message: pollResult.error ?? 'Login failed' });
            larkCliLoginAbort = null;
            return { success: true };
          }
          // pending → continue polling
        } catch (pollError) {
          if (signal.aborted) {
            larkCliLoginAbort = null;
            return { success: true };
          }
          mainWarn('ChannelBridge', 'larkCli poll error:', pollError);
          // transient — continue
        }
      }

      channel.larkCliLogin.emit({ phase: 'expired', message: 'Authorization code expired' });
      larkCliLoginAbort = null;
      return { success: true };
    } catch (error: any) {
      mainError('ChannelBridge', 'larkCliStart error:', error);
      channel.larkCliLogin.emit({ phase: 'error', message: error?.message ?? 'Failed to start lark-cli login' });
      larkCliLoginAbort = null;
      return { success: false, msg: error?.message };
    }
  });

  channel.larkCliCancel.provider(async () => {
    if (larkCliLoginAbort) {
      larkCliLoginAbort.abort();
      larkCliLoginAbort = null;
    }
    return { success: true };
  });

  channel.larkCliStatus.provider(async () => {
    try {
      const { getLarkCliAuthService } = await import('@/process/services/larkCli/LarkCliAuthService');
      const data = await getLarkCliAuthService().getStatus();
      return { success: true, data };
    } catch (error: any) {
      mainError('ChannelBridge', 'larkCliStatus error:', error);
      return { success: false, msg: error?.message };
    }
  });

  channel.larkCliLogout.provider(async () => {
    try {
      const { getLarkCliAuthService } = await import('@/process/services/larkCli/LarkCliAuthService');
      const r = await getLarkCliAuthService().logout();
      if (!r.ok) return { success: false, msg: r.error };
      return { success: true };
    } catch (error: any) {
      mainError('ChannelBridge', 'larkCliLogout error:', error);
      return { success: false, msg: error?.message };
    }
  });

  mainLog('ChannelBridge', 'Initialized');
}
