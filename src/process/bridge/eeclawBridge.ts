/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { ProcessConfig } from '@process/initStorage';
import { mainWarn, mainLog, mainError } from '@process/utils/mainLogger';
import { setCachedAuthToken, setCachedServerUrl, setCachedAppMode, setCachedLocalModeAvailable, setCachedSessionMode } from '@/common/enterpriseDebugConfig';
import { resetConversationProvider } from '../providers';
import { switchAppMode } from '@process/services/modeSwitch/ModeSwitchOrchestrator';

let refreshPromise: Promise<string> | null = null;

export async function getValidToken(forceRefresh = false): Promise<string> {
  const authStorage = ProcessConfig.getSync('eeclaw.authStorage');
  const serverUrl = ProcessConfig.getSync('eeclaw.serverUrl');

  if (!authStorage || !serverUrl) {
    throw new Error('No auth storage or server URL found');
  }

  const { access_token, refresh_token, expires_at, device_id } = authStorage;
  // OAuth2 sessions refresh via a distinct grant so MOSS routes them through the
  // credential script; password/api_key sessions use the standard refresh grant.
  const refreshGrantType = authStorage.session_type === 'oauth2' ? 'oauth2_refresh_token' : 'refresh_token';

  const now = Date.now();
  const remainingMs = expires_at - now;

  if (!forceRefresh && expires_at > now + 5 * 60 * 1000) {
    mainLog('eeclawBridge', `[getValidToken] Token still valid (remaining=${Math.round(remainingMs / 1000)}s), returning cached access_token`);
    return access_token;
  }

  if (refreshPromise) {
    mainLog('eeclawBridge', '[getValidToken] Refresh already in progress, waiting...');
    return refreshPromise;
  }

  mainLog('eeclawBridge', `[getValidToken] ${forceRefresh ? 'Force refresh requested' : `Token expired (remaining=${Math.round(remainingMs / 1000)}s)`}, starting refresh (refresh_token=${refresh_token ? refresh_token.slice(0, 20) + '...' : 'NONE'})`);

  refreshPromise = (async () => {
    try {
      if (!refresh_token) {
        throw new Error('No refresh token available');
      }

      // OAuth2 sessions send the provider refresh_token inside a generic `params`
      // dict (moss forwards it to the credential script); other sessions send the
      // moss refresh_token at the top level as before.
      const refreshBody = refreshGrantType === 'oauth2_refresh_token' ? { grant_type: refreshGrantType, params: { refresh_token } } : { grant_type: refreshGrantType, refresh_token };

      mainLog('eeclawBridge', `[getValidToken] Sending refresh request to ${serverUrl}/api/v1/auth/token`);
      const response = await fetch(`${serverUrl}/api/v1/auth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': device_id,
        },
        body: JSON.stringify(refreshBody),
        signal: AbortSignal.timeout(15000),
      });

      const data = await response.json();

      if (!response.ok) {
        // If "Invalid refresh token", the renderer may have already rotated it.
        // Invalidate cache and retry once with the latest token from file.
        if (data?.error === 'Invalid refresh token' || response.status === 401) {
          mainLog('eeclawBridge', '[getValidToken] Got Invalid refresh token, invalidating cache and retrying with latest from file');
          ProcessConfig.invalidateCache();
          const latestAuth = ProcessConfig.getSync('eeclaw.authStorage');
          if (latestAuth?.refresh_token && latestAuth.refresh_token !== refresh_token) {
            mainLog('eeclawBridge', `[getValidToken] Found different refresh_token in file, retrying with ${latestAuth.refresh_token.slice(0, 20)}...`);
            const retryBody = latestAuth.session_type === 'oauth2' ? { grant_type: 'oauth2_refresh_token', params: { refresh_token: latestAuth.refresh_token } } : { grant_type: 'refresh_token', refresh_token: latestAuth.refresh_token };
            const retryResponse = await fetch(`${serverUrl}/api/v1/auth/token`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Device-Id': latestAuth.device_id,
              },
              body: JSON.stringify(retryBody),
              signal: AbortSignal.timeout(15000),
            });
            const retryData = await retryResponse.json();
            if (retryResponse.ok && retryData.access_token) {
              const newAuthStorage = {
                access_token: retryData.access_token,
                refresh_token: retryData.refresh_token || latestAuth.refresh_token,
                expires_at: Date.now() + (retryData.expires_in || 3600) * 1000,
                device_id: latestAuth.device_id,
                session_type: latestAuth.session_type,
              };
              mainLog('eeclawBridge', `[getValidToken] Retry refresh successful! new_expires_at=${newAuthStorage.expires_at}`);
              await ProcessConfig.set('eeclaw.authStorage', newAuthStorage);
              setCachedAuthToken(retryData.access_token);
              try {
                ipcBridge.eeclaw.tokenRefreshed.emit({
                  access_token: retryData.access_token,
                  refresh_token: retryData.refresh_token || latestAuth.refresh_token,
                  expires_at: newAuthStorage.expires_at,
                });
              } catch (e) {
                mainLog('eeclawBridge', 'Failed to emit token refresh event:', e);
              }
              return retryData.access_token;
            }
            mainWarn('eeclawBridge', `[getValidToken] Retry also failed: status=${retryResponse.status}, error=${retryData?.error || 'unknown'}`);
          } else {
            mainWarn('eeclawBridge', '[getValidToken] No different refresh_token found in file after cache invalidation');
          }
        }
        mainWarn('eeclawBridge', `[getValidToken] Refresh failed: status=${response.status}, error=${data?.error || 'unknown'}`);
        throw new Error(data?.error || 'token_refresh_failed');
      }

      const newAuthStorage = {
        access_token: data.access_token,
        refresh_token: data.refresh_token || refresh_token,
        expires_at: Date.now() + (data.expires_in || 3600) * 1000,
        device_id,
        session_type: authStorage.session_type,
      };

      mainLog('eeclawBridge', `[getValidToken] Refresh successful! new_expires_at=${newAuthStorage.expires_at}, new_refresh_token=${newAuthStorage.refresh_token ? newAuthStorage.refresh_token.slice(0, 20) + '...' : 'NONE'}`);

      await ProcessConfig.set('eeclaw.authStorage', newAuthStorage);
      setCachedAuthToken(data.access_token);

      // Notify renderer process about the refreshed token
      try {
        ipcBridge.eeclaw.tokenRefreshed.emit({
          access_token: data.access_token,
          refresh_token: data.refresh_token || refresh_token,
          expires_at: newAuthStorage.expires_at,
        });
      } catch (e) {
        mainLog('eeclawBridge', 'Failed to emit token refresh event:', e);
      }

      return data.access_token;
    } catch (error) {
      mainWarn('eeclawBridge', 'Token refresh failed:', error);
      setCachedAuthToken('');
      throw error;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export function initEeclawBridge(): void {
  // Set app mode and update main process cache
  // 设置应用模式并更新主进程缓存
  ipcBridge.eeclaw.setAppMode.provider(async ({ mode }) => {
    await switchAppMode(mode);
    mainLog('eeclawBridge', `App mode switched to: ${mode}`);
  });

  // Set session mode (remote/local) for enterprise mode
  // 设置 session 模式（remote/local），用于企业模式
  ipcBridge.eeclaw.setSessionMode.provider(async ({ mode }) => {
    const localModeAvailable = ProcessConfig.getSync('eeclaw.localModeAvailable');
    const resolvedMode = mode === 'local' && localModeAvailable === false ? 'remote' : mode;
    setCachedSessionMode(resolvedMode);
    resetConversationProvider();
    mainLog('eeclawBridge', `Session mode set to: ${resolvedMode}`);
  });

  ipcBridge.eeclaw.verifyServer.provider(async ({ serverUrl }) => {
    try {
      const response = await fetch(`${serverUrl}/api/v1/tenant/config`, {
        method: 'GET',
        signal: AbortSignal.timeout(10000),
      });
      if (response.ok) {
        const json = await response.json();
        if (json.success && json.data) {
          return { success: true, data: json.data };
        }
        return { success: false, error: 'server_error' as const, data: undefined };
      }
      return { success: false, error: 'server_error' as const, data: undefined };
    } catch (error) {
      mainWarn('eeclawBridge', 'verifyServer error:', error);
      return { success: false, error: 'network_error' as const, data: undefined };
    }
  });

  ipcBridge.eeclaw.oauth2Config.provider(async ({ serverUrl }) => {
    try {
      const response = await fetch(`${serverUrl}/api/v1/auth/oauth2/config`, {
        method: 'GET',
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        return { success: false, error: 'server_error' as const, data: undefined };
      }
      const data = await response.json();
      return {
        success: true,
        data: {
          enabled: data?.enabled === true,
          authorize_url: typeof data?.authorize_url === 'string' ? data.authorize_url : undefined,
          // Default true when absent — older moss builds didn't send this field
          // and we should preserve the CSRF check in that case.
          require_state: data?.require_state !== false,
        },
      };
    } catch (error) {
      mainWarn('eeclawBridge', 'oauth2Config error:', error);
      return { success: false, error: 'network_error' as const, data: undefined };
    }
  });

  ipcBridge.eeclaw.login.provider(async ({ serverUrl, body, deviceId }) => {
    try {
      const response = await fetch(`${serverUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': deviceId,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: (data?.error || 'login_failed') as string, data: undefined };
      }

      const localModeAvailable = !!(data.user.localAuth && data.sudorouter_key && data.model_service_url && Array.isArray(data.models) && data.models.length > 0);

      // Save server URL and auth storage to ProcessConfig
      // 将服务器 URL 和认证存储保存到 ProcessConfig
      const sessionType: 'password' | 'api_key' | 'oauth2' = body.grant_type === 'oauth2' ? 'oauth2' : body.grant_type === 'api_key' ? 'api_key' : 'password';
      await ProcessConfig.set('eeclaw.serverUrl', serverUrl);
      await ProcessConfig.set('eeclaw.authStorage', {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Date.now() + (data.expires_in || 3600) * 1000,
        device_id: deviceId,
        session_type: sessionType,
      });
      await ProcessConfig.set('eeclaw.localModeAvailable', localModeAvailable);

      // Update enterprise cache for synchronous access
      // 更新企业配置缓存以供同步访问
      setCachedServerUrl(serverUrl);
      setCachedAuthToken(data.access_token);
      setCachedAppMode('e');
      setCachedLocalModeAvailable(localModeAvailable);

      // Reset provider singleton so next call creates RemoteConversationProvider
      // 重置 Provider 单例，下次调用时会创建 RemoteConversationProvider
      resetConversationProvider();

      mainLog('eeclawBridge', 'Login successful, cache updated, provider reset');

      // 【新增】后台静默同步，不阻塞登录流程
      // Background silent sync after enterprise login, non-blocking
      import('@process/sync/remoteToLocalSync')
        .then(({ syncAllFromRemote }) => syncAllFromRemote())
        .then((result) => {
          mainLog('eeclawBridge', 'Background sync completed', {
            hubSkills: result.skills.hub.installed.length,
            tenantSkills: result.skills.tenant.installed.length,
            hubAssistants: result.assistants.hub.installed.length,
            tenantAssistants: result.assistants.tenant.installed.length,
          });
          // Emit sync completed event to notify renderer
          ipcBridge.eeclaw.syncCompleted.emit(result);
        })
        .catch((err) => {
          mainError('eeclawBridge', 'Background sync failed:', err);
        });

      return {
        success: true,
        data: {
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_in: data.expires_in,
          user: {
            id: data.user.id,
            name: data.user.name,
            role: data.user.role,
            orgId: data.user.orgId,
            localAuth: data.user.localAuth === true,
          },
          sudorouter_key: data.sudorouter_key,
          model_service_url: data.model_service_url,
          models: Array.isArray(data.models) ? data.models : undefined,
        },
      };
    } catch (error) {
      mainWarn('eeclawBridge', 'login error:', error);
      return { success: false, error: 'network_error' as string, data: undefined };
    }
  });

  ipcBridge.eeclaw.getUserProfile.provider(async () => {
    try {
      const serverUrl = ProcessConfig.getSync('eeclaw.serverUrl');
      if (!serverUrl) {
        return { success: false, error: 'no_server_url' as const, data: undefined };
      }

      const accessToken = await getValidToken();

      const response = await fetch(`${serverUrl}/api/v1/user/profile`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (response.status === 401) {
        return { success: false, error: 'unauthorized' as const, data: undefined };
      }

      if (!response.ok) {
        mainWarn('eeclawBridge', `getUserProfile failed: ${response.status}`);
        return { success: false, error: 'server_error' as const, data: undefined };
      }

      const data = await response.json();
      if (data.success && data.data) {
        return { success: true, data: data.data };
      }
      return { success: false, error: 'server_error' as const, data: undefined };
    } catch (error) {
      mainWarn('eeclawBridge', 'getUserProfile error:', error);
      return { success: false, error: 'network_error' as const, data: undefined };
    }
  });

  ipcBridge.eeclaw.getCloudAssistants.provider(async () => {
    try {
      const serverUrl = ProcessConfig.getSync('eeclaw.serverUrl');
      if (!serverUrl) {
        return { success: false, error: 'no_server_url' as const, data: undefined };
      }

      const accessToken = await getValidToken();

      const response = await fetch(`${serverUrl}/api/v1/agents/installed`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });

      if (response.status === 401) {
        return { success: false, error: 'unauthorized' as const, data: undefined };
      }

      if (!response.ok) {
        mainWarn('eeclawBridge', `getCloudAssistants failed: ${response.status}`);
        return { success: false, error: 'server_error' as const, data: undefined };
      }

      const data = await response.json();
      // Server returns InstalledAssistantInfo[], map to { key, name, avatar, emoji, description }
      const assistants: Array<{ key: string; name: string; avatar?: string; emoji?: string; description?: string }> = (Array.isArray(data) ? data : (data?.data ?? [])).map((a: any) => ({
        key: a.id || a.name,
        name: a.displayName || a.name,
        avatar: a.avatar || undefined,
        emoji: a.emoji || undefined,
        description: a.description || undefined,
      }));
      return { success: true, data: assistants };
    } catch (error) {
      mainWarn('eeclawBridge', 'getCloudAssistants error:', error);
      return { success: false, error: 'network_error' as const, data: undefined };
    }
  });

  ipcBridge.eeclaw.refreshToken.provider(async () => {
    try {
      const token = await getValidToken(true);
      const authStorage = ProcessConfig.getSync('eeclaw.authStorage');
      return {
        success: true,
        data: {
          access_token: token,
          refresh_token: authStorage?.refresh_token,
          expires_at: authStorage?.expires_at,
        },
      };
    } catch (error) {
      mainWarn('eeclawBridge', 'refreshToken error:', error);
      return { success: false, error: String((error as Error)?.message || error), data: undefined };
    }
  });

  ipcBridge.eeclaw.logout.provider(async () => {
    try {
      const serverUrl = ProcessConfig.getSync('eeclaw.serverUrl');
      const authStorage = ProcessConfig.getSync('eeclaw.authStorage');

      if (serverUrl && authStorage?.access_token) {
        await fetch(`${serverUrl}/api/v1/auth/logout`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authStorage.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            refresh_token: authStorage.refresh_token || undefined,
          }),
          signal: AbortSignal.timeout(5000),
        }).catch((err) => mainWarn('eeclawBridge', 'Logout request failed:', err));
      }
    } finally {
      // Always clear local state even if server request fails
      await ProcessConfig.set('eeclaw.authStorage', null);
      await ProcessConfig.set('eeclaw.localModeAvailable', null);
      setCachedAuthToken('');
      setCachedLocalModeAvailable(null);
      resetConversationProvider();
      mainLog('eeclawBridge', 'Logged out, local storage cleared');
    }
    return { success: true, data: {} };
  });

  // Manual sync trigger (for Local mode or retry)
  ipcBridge.eeclaw.syncFromRemote.provider(async () => {
    try {
      const { syncIncrementalFromRemote } = await import('@process/sync/remoteToLocalSync');
      const result = await syncIncrementalFromRemote();
      // Emit sync completed event to notify renderer
      ipcBridge.eeclaw.syncCompleted.emit(result);
      return {
        success: true,
        data: result,
      };
    } catch (error) {
      mainError('eeclawBridge', 'syncFromRemote error:', error);
      return {
        success: false,
        data: {
          skills: { hub: { installed: [], skipped: [], deleted: [], failed: [] }, tenant: { installed: [], skipped: [], deleted: [], failed: [] } },
          assistants: { hub: { installed: [], skipped: [], deleted: [], failed: [] }, tenant: { installed: [], skipped: [], deleted: [], failed: [] } },
        },
        msg: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // === Custom Skill/Assistant Upload ===
  ipcBridge.eeclaw.uploadCustomSkill.provider(async (params) => {
    mainLog('eeclawBridge', 'uploadCustomSkill called with params:', params);
    try {
      const { uploadCustomSkill } = await import('@process/sync/customUpload');
      const result = await uploadCustomSkill(params);
      mainLog('eeclawBridge', 'uploadCustomSkill result:', result);
      if (result.success) {
        return { success: true, data: { id: result.id || '', name: result.name, status: result.status || 'active' } };
      }
      return { success: false, msg: result.error };
    } catch (error) {
      mainError('eeclawBridge', 'uploadCustomSkill error:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.eeclaw.uploadCustomAssistant.provider(async (params) => {
    mainLog('eeclawBridge', 'uploadCustomAssistant called with params:', params);
    try {
      const { uploadCustomAssistant } = await import('@process/sync/customUpload');
      const result = await uploadCustomAssistant(params);
      mainLog('eeclawBridge', 'uploadCustomAssistant result:', result);
      if (result.success) {
        return { success: true, data: { id: result.id || '', name: result.name, status: result.status || 'active' } };
      }
      return { success: false, msg: result.error };
    } catch (error) {
      mainError('eeclawBridge', 'uploadCustomAssistant error:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  // === Tenant Skill/Assistant ===
  ipcBridge.eeclaw.getTenantSkills.provider(async () => {
    try {
      const { fetchTenantSkills } = await import('@process/sync/tenantSync');
      const skills = await fetchTenantSkills();
      return { success: true, data: skills };
    } catch (error) {
      mainError('eeclawBridge', 'getTenantSkills error:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.eeclaw.getTenantAssistants.provider(async () => {
    try {
      const { fetchTenantAssistants } = await import('@process/sync/tenantSync');
      const assistants = await fetchTenantAssistants();
      return { success: true, data: assistants };
    } catch (error) {
      mainError('eeclawBridge', 'getTenantAssistants error:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.eeclaw.installTenantSkill.provider(async ({ skillId }) => {
    try {
      const { installTenantSkill } = await import('@process/sync/tenantSync');
      const result = await installTenantSkill(skillId);
      if (result.success) {
        return { success: true, data: { name: result.name || '' } };
      }
      return { success: false, msg: result.error };
    } catch (error) {
      mainError('eeclawBridge', 'installTenantSkill error:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.eeclaw.installTenantAssistant.provider(async ({ assistantId }) => {
    try {
      const { installTenantAssistant } = await import('@process/sync/tenantSync');
      const result = await installTenantAssistant(assistantId);
      if (result.success) {
        return { success: true, data: { name: result.name || '' } };
      }
      return { success: false, msg: result.error };
    } catch (error) {
      mainError('eeclawBridge', 'installTenantAssistant error:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.eeclaw.publishTenantSkill.provider(async ({ skillId, publishNote }) => {
    try {
      const { publishTenantSkill } = await import('@process/sync/tenantSync');
      const result = await publishTenantSkill(skillId, publishNote);
      if (result.success) {
        return {
          success: true,
          data: {
            id: result.id || '',
            skillId: result.skillId || skillId,
            skillName: result.skillName || '',
            status: result.status || 'pending',
            message: result.message,
          },
        };
      }
      return { success: false, msg: result.error };
    } catch (error) {
      mainError('eeclawBridge', 'publishTenantSkill error:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcBridge.eeclaw.publishTenantAssistant.provider(async ({ assistantId, publishNote }) => {
    try {
      const { publishTenantAssistant } = await import('@process/sync/tenantSync');
      const result = await publishTenantAssistant(assistantId, publishNote);
      if (result.success) {
        return {
          success: true,
          data: {
            id: result.id || '',
            assistantId: result.assistantId || assistantId,
            assistantName: result.assistantName || '',
            status: result.status || 'pending',
            message: result.message,
          },
        };
      }
      return { success: false, msg: result.error };
    } catch (error) {
      mainError('eeclawBridge', 'publishTenantAssistant error:', error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });
}
