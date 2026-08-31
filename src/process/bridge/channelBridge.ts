/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'path';
import { channel } from '@/common/ipcBridge';
import { getChannelManager } from '@/channels/core/ChannelManager';
import { isEnterpriseMode } from '@/common/enterpriseDebugConfig';
import { ExtensionRegistry } from '@/extensions';
import { toAssetUrl } from '@/extensions/assetProtocol';
import type { IChannelPluginStatus, PluginType } from '@/channels/types';
import { hasPluginCredentials } from '@/channels/types';
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
        dbPlugins = await getChannelManager().getProvider().getPlugins();
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
      const plugin = await getChannelManager().getProvider().getPlugin(pluginId);

      if (!plugin) {
        return { success: false, msg: 'Plugin not found' };
      }

      if (!plugin.credentials) {
        return { success: true, data: null };
      }

      // Credentials are already decrypted by provider (Local: getChannelPlugin via decryptCredentials, Remote: Moss server)
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
   * Allocate an additional connection of a channel type
   */
  channel.createPlugin.provider(async ({ type, name }) => {
    try {
      const manager = getChannelManager();
      const result = await manager.createPlugin(type as PluginType, name);
      if (!result.success || !result.pluginId) {
        return { success: false, msg: result.error };
      }
      return { success: true, data: { pluginId: result.pluginId } };
    } catch (error: any) {
      mainError('ChannelBridge', 'createPlugin error:', error);
      return { success: false, msg: error.message };
    }
  });

  /**
   * Delete one connection entirely
   */
  channel.removePlugin.provider(async ({ pluginId }) => {
    try {
      const manager = getChannelManager();
      const result = await manager.removePlugin(pluginId);
      if (!result.success) {
        return { success: false, msg: result.error };
      }
      return { success: true };
    } catch (error: any) {
      mainError('ChannelBridge', 'removePlugin error:', error);
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
      const pairings = await getChannelManager().getProvider().getPendingPairingRequests();

      mainLog('ChannelBridge', `getPendingPairings: count=${pairings.length}`);
      if (pairings.length > 0) {
        mainLog('ChannelBridge', `getPendingPairings: codes=${pairings.map((p) => `${p.code}(${p.platformType})`).join(', ')}`);
      }

      return { success: true, data: pairings };
    } catch (error: any) {
      mainError('ChannelBridge', 'getPendingPairings error:', error);
      return { success: false, msg: error.message };
    }
  });

  /**
   * Approve a pairing request
   */
  channel.approvePairing.provider(async ({ code }) => {
    try {
      const success = await getChannelManager().getProvider().approvePairing(code);

      if (!success) {
        return { success: false, msg: 'Failed to approve pairing' };
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
   */
  channel.rejectPairing.provider(async ({ code }) => {
    try {
      const success = await getChannelManager().getProvider().rejectPairing(code);

      if (!success) {
        return { success: false, msg: 'Failed to reject pairing' };
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
      const users = await getChannelManager().getProvider().getUsers();
      return { success: true, data: users };
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
      const success = await getChannelManager().getProvider().deleteUser(userId);

      if (!success) {
        return { success: false, msg: 'Failed to revoke user authorization' };
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
      const sessions = await getChannelManager().getProvider().getSessions();
      return { success: true, data: sessions };
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
    // Enterprise mode: no local WeChat process to cancel
    if (isEnterpriseMode()) {
      return { success: true };
    }

    if (wechatQrLoginAbort) {
      wechatQrLoginAbort.abort();
      wechatQrLoginAbort = null;
    }
    return { success: true };
  });

  // ==================== Lark QR Login (direct device flow) ====================

  let larkAuthAbort: AbortController | null = null;

  /** Read the persisted lark_default credentials, or {} if none. */
  const readLarkCredentials = async (): Promise<import('@/channels/types').IPluginCredentials> => {
    try {
      const plugin = await getChannelManager().getProvider().getPlugin('lark_default');
      return plugin?.credentials ?? {};
    } catch {
      return {};
    }
  };

  channel.larkAuthStart.provider(async ({ brand = 'feishu' }: { brand?: 'feishu' | 'lark' } = {}) => {
    try {
      if (larkAuthAbort) {
        larkAuthAbort.abort();
      }
      larkAuthAbort = new AbortController();
      const signal = larkAuthAbort.signal;

      const { getLarkAuthService } = await import('@/process/services/lark/LarkAuthService');
      const { RECOMMENDED_SCOPE } = await import('@/process/services/lark/larkEndpoints');
      const { fetchLarkUserInfo } = await import('@/process/services/lark/larkApiCall');
      const svc = getLarkAuthService();

      channel.larkAuthLogin.emit({ phase: 'initializing' });

      // Stage A: app registration — user scans to create/select a Feishu app; we get app_id/app_secret.
      const reg = await svc.requestAppRegistration(brand);
      if (signal.aborted) {
        larkAuthAbort = null;
        return { success: true };
      }
      channel.larkAuthLogin.emit({ phase: 'app-setup', verificationUrl: reg.verificationUrl });

      let app;
      try {
        app = await svc.pollAppRegistration(brand, reg.deviceCode, reg.interval, reg.expiresIn, signal);
      } catch (regErr: any) {
        if (signal.aborted) {
          larkAuthAbort = null;
          return { success: true };
        }
        const msg = regErr?.message ?? 'app registration failed';
        channel.larkAuthLogin.emit({ phase: 'error', message: msg });
        larkAuthAbort = null;
        return { success: false, msg };
      }
      if (signal.aborted) {
        larkAuthAbort = null;
        return { success: true };
      }
      if (!app.appId || !app.appSecret) {
        const msg = 'app registration returned no app credentials';
        channel.larkAuthLogin.emit({ phase: 'error', message: msg });
        larkAuthAbort = null;
        return { success: false, msg };
      }

      // The app may have been created under a different tenant brand than requested.
      const effectiveBrand = app.tenantBrand === 'lark' ? 'lark' : brand;

      // Stage B: device authorization — user scans to grant the app access to their account.
      let da;
      try {
        da = await svc.requestDeviceAuthorization(effectiveBrand, app.appId, app.appSecret, RECOMMENDED_SCOPE);
      } catch (daErr: any) {
        if (signal.aborted) {
          larkAuthAbort = null;
          return { success: true };
        }
        const msg = daErr?.message ?? 'device authorization failed';
        channel.larkAuthLogin.emit({ phase: 'error', message: msg });
        larkAuthAbort = null;
        return { success: false, msg };
      }
      if (signal.aborted) {
        larkAuthAbort = null;
        return { success: true };
      }

      channel.larkAuthLogin.emit({
        phase: 'qrcode',
        verificationUrl: da.verificationUriComplete,
        userCode: da.userCode,
        expiresAt: Date.now() + da.expiresIn * 1000,
      });

      const result = await svc.pollDeviceToken(effectiveBrand, app.appId, app.appSecret, da.deviceCode, da.interval, da.expiresIn, signal);
      if (signal.aborted) {
        larkAuthAbort = null;
        return { success: true };
      }
      if (result.status === 'success' && result.token) {
        // Resolve the human-readable identity for display.
        const info = await fetchLarkUserInfo({ brand: effectiveBrand, accessToken: result.token.accessToken });
        channel.larkAuthLogin.emit({
          phase: 'success',
          user: { id: info?.openId ?? app.openId, name: info?.name },
          appId: app.appId,
          appSecret: app.appSecret,
          brand: effectiveBrand,
          token: result.token,
        });
        larkAuthAbort = null;
        return { success: true };
      }
      if (result.status === 'expired') {
        channel.larkAuthLogin.emit({ phase: 'expired', message: result.error ?? 'Authorization code expired' });
        larkAuthAbort = null;
        return { success: true };
      }
      channel.larkAuthLogin.emit({ phase: 'error', message: result.error ?? 'Login failed' });
      larkAuthAbort = null;
      return { success: true };
    } catch (error: any) {
      mainError('ChannelBridge', 'larkAuthStart error:', error);
      channel.larkAuthLogin.emit({ phase: 'error', message: error?.message ?? 'Failed to start Feishu login' });
      larkAuthAbort = null;
      return { success: false, msg: error?.message };
    }
  });

  channel.larkAuthCancel.provider(async () => {
    if (larkAuthAbort) {
      larkAuthAbort.abort();
      larkAuthAbort = null;
    }
    return { success: true };
  });

  channel.larkAuthStatus.provider(async () => {
    try {
      const creds = await readLarkCredentials();
      const expiresAt = typeof creds.larkUserTokenExpiresAt === 'number' ? creds.larkUserTokenExpiresAt : Number(creds.larkUserTokenExpiresAt) || 0;
      const refreshExpiresAt = typeof creds.larkUserRefreshTokenExpiresAt === 'number' ? creds.larkUserRefreshTokenExpiresAt : Number(creds.larkUserRefreshTokenExpiresAt) || 0;
      // Logged in if we hold a user token whose refresh token (if known) hasn't expired.
      const loggedIn = !!creds.larkUserAccessToken && (refreshExpiresAt === 0 || refreshExpiresAt > Date.now());
      void expiresAt; // expiry is handled lazily on use via ensureValidUserToken
      return {
        success: true,
        data: {
          loggedIn,
          user: loggedIn ? { id: creds.larkUserOpenId, name: creds.larkUserName } : undefined,
        },
      };
    } catch (error: any) {
      mainError('ChannelBridge', 'larkAuthStatus error:', error);
      return { success: false, msg: error?.message };
    }
  });

  channel.larkAuthLogout.provider(async () => {
    try {
      // Sudowork owns the tokens — clearing the stored credential fields is the logout.
      const creds = await readLarkCredentials();
      const cleared: Record<string, unknown> = { ...creds };
      delete cleared.larkUserAccessToken;
      delete cleared.larkUserRefreshToken;
      delete cleared.larkUserTokenExpiresAt;
      delete cleared.larkUserRefreshTokenExpiresAt;
      delete cleared.larkUserOpenId;
      delete cleared.larkUserName;
      delete cleared.larkBrand;
      delete cleared.larkLoggedInAt;
      if (creds.appId && creds.appSecret) {
        await getChannelManager().enablePlugin('lark_default', cleared);
      }
      return { success: true };
    } catch (error: any) {
      mainError('ChannelBridge', 'larkAuthLogout error:', error);
      return { success: false, msg: error?.message };
    }
  });

  channel.larkAuthWhoAmI.provider(async () => {
    try {
      const creds = await readLarkCredentials();
      const { ensureValidUserToken, fetchLarkUserInfoOrThrow } = await import('@/process/services/lark/larkApiCall');
      const ensured = await ensureValidUserToken(creds);
      // Persist a refreshed token so subsequent calls don't refresh again.
      if (ensured.refreshed && creds.appId && creds.appSecret) {
        await getChannelManager().enablePlugin('lark_default', {
          ...creds,
          larkUserAccessToken: ensured.refreshed.accessToken,
          larkUserRefreshToken: ensured.refreshed.refreshToken ?? creds.larkUserRefreshToken,
          larkUserTokenExpiresAt: ensured.refreshed.expiresAt,
          larkUserRefreshTokenExpiresAt: ensured.refreshed.refreshExpiresAt ?? creds.larkUserRefreshTokenExpiresAt,
        } as Record<string, unknown>);
      }
      const info = await fetchLarkUserInfoOrThrow({ brand: ensured.brand, accessToken: ensured.accessToken });
      return { success: true, data: info };
    } catch (error: any) {
      mainError('ChannelBridge', 'larkAuthWhoAmI error:', error);
      return { success: false, msg: error?.message ?? 'Failed to call user_info' };
    }
  });

  mainLog('ChannelBridge', 'Initialized');
}
