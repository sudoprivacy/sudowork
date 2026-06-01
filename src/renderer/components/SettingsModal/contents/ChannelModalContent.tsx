/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IChannelPluginStatus } from '@/channels/types';
import type { IProvider, TProviderWithModel } from '@/common/storage';
import { channel, webui, type IWebUIStatus } from '@/common/ipcBridge';
import { ConfigStorage } from '@/common/storage';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { useModelProviderList } from '@/renderer/hooks/useModelProviderList';
import type { GeminiModelSelection } from '@/renderer/pages/conversation/gemini/useGeminiModelSelection';
import { useGeminiModelSelection } from '@/renderer/pages/conversation/gemini/useGeminiModelSelection';
import { Input, InputNumber, Message, Select, Switch } from '@arco-design/web-react';
import { CheckOne } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppMode } from '@/renderer/hooks/useAppMode';
import { useSettingsViewMode } from '../settingsViewContext';
import ChannelItem from './channels/ChannelItem';
import type { ChannelConfig } from './channels/types';
import DingTalkConfigForm from './DingTalkConfigForm';
import LarkConfigForm from './LarkConfigForm';
import TelegramConfigForm from './TelegramConfigForm';
import WeChatConfigForm from './WeChatConfigForm';
import WeComConfigForm from './WeComConfigForm';

type ChannelModelConfigKey = 'assistant.telegram.defaultModel' | 'assistant.lark.defaultModel' | 'assistant.dingtalk.defaultModel' | 'assistant.wechat.defaultModel' | 'assistant.wecom.defaultModel';

type ExtensionFieldType = 'text' | 'password' | 'select' | 'number' | 'boolean';

type ExtensionFieldSchema = {
  key: string;
  label: string;
  type: ExtensionFieldType;
  required?: boolean;
  options?: string[];
  default?: string | number | boolean;
};

type ExtensionFieldValues = Record<string, Record<string, string | number | boolean>>;

const BUILTIN_CHANNEL_TYPES = new Set(['telegram', 'lark', 'dingtalk', 'wechat', 'wecom']);

/**
 * Internal hook: wraps useGeminiModelSelection with ConfigStorage persistence
 * for a specific channel config key (e.g. 'assistant.telegram.defaultModel').
 *
 * Restoration is done by resolving the saved model reference into a full
 * TProviderWithModel and passing it as `initialModel` — this avoids triggering
 * the onSelectModel callback (and its toast) on mount.
 */
const useChannelModelSelection = (configKey: ChannelModelConfigKey): GeminiModelSelection => {
  const { t } = useTranslation();

  // Resolve persisted model into a full TProviderWithModel for initialModel.
  // useModelProviderList is SWR-backed so the duplicate call inside
  // useGeminiModelSelection is deduplicated automatically.
  const { providers } = useModelProviderList();
  const [resolvedInitialModel, setResolvedInitialModel] = useState<TProviderWithModel | undefined>(undefined);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    if (restored || providers.length === 0) return;

    const restore = async () => {
      try {
        const saved = (await ConfigStorage.get(configKey)) as { id: string; useModel: string } | undefined;
        if (!saved?.id || !saved?.useModel) {
          // Nothing saved — mark restored so we don't keep retrying
          setRestored(true);
          return;
        }

        const provider = providers.find((p) => p.id === saved.id);
        if (!provider) {
          // Provider not found in current list — don't mark as restored.
          // The Google Auth provider may load after API-key providers;
          // leaving restored=false lets this effect re-run when providers update.
          return;
        }

        // Google Auth provider's model array only contains top-level modes
        // ('auto', 'auto-gemini-2.5', 'manual'), but sub-model values like
        // 'gemini-2.5-flash' are also valid — skip strict membership check.
        const isGoogleAuth = provider.platform?.toLowerCase().includes('gemini-with-google-auth');
        if (isGoogleAuth || provider.model?.includes(saved.useModel)) {
          setResolvedInitialModel({
            ...provider,
            useModel: saved.useModel,
          } as TProviderWithModel);
        }
        setRestored(true);
      } catch (error) {
        console.error(`[ChannelSettings] Failed to restore model for ${configKey}:`, error);
        setRestored(true);
      }
    };

    void restore();
  }, [configKey, providers, restored]);

  // Only called on explicit user selection — not during restoration
  const onSelectModel = useCallback(
    async (provider: IProvider, modelName: string) => {
      try {
        const modelRef = { id: provider.id, useModel: modelName };
        await ConfigStorage.set(configKey, modelRef);

        // Derive platform from configKey and sync to channel system
        const platform = configKey.replace('assistant.', '').replace('.defaultModel', '') as 'telegram' | 'lark' | 'dingtalk' | 'wechat';
        const agentKey = `assistant.${platform}.agent` as const;
        const currentAgent = await ConfigStorage.get(agentKey);
        await channel.syncChannelSettings
          .invoke({
            platform,
            agent: (currentAgent as { backend: string; customAgentId?: string; name?: string }) || { backend: 'gemini' },
            model: modelRef,
          })
          .catch((err) => console.warn(`[ChannelSettings] syncChannelSettings failed for ${platform}:`, err));

        // Toast notification is handled by useGeminiModelSelection hook
        return true;
      } catch (error) {
        console.error(`[ChannelSettings] Failed to save model for ${configKey}:`, error);
        Message.error(t('settings.assistant.modelSaveFailed', 'Failed to save model'));
        return false;
      }
    },
    [configKey, t]
  );

  return useGeminiModelSelection({ initialModel: resolvedInitialModel, onSelectModel });
};

/**
 * Assistant Settings Content Component
 */
const ChannelModalContent: React.FC = () => {
  const { t } = useTranslation();
  const viewMode = useSettingsViewMode();
  const { isEnterprise } = useAppMode();
  const isPageMode = viewMode === 'page';

  // Plugin state
  const [pluginStatus, setPluginStatus] = useState<IChannelPluginStatus | null>(null);
  const [larkPluginStatus, setLarkPluginStatus] = useState<IChannelPluginStatus | null>(null);
  const [dingtalkPluginStatus, setDingtalkPluginStatus] = useState<IChannelPluginStatus | null>(null);
  const [enableLoading, setEnableLoading] = useState(false);
  const [larkEnableLoading, setLarkEnableLoading] = useState(false);
  const [dingtalkEnableLoading, setDingtalkEnableLoading] = useState(false);
  const [extensionStatuses, setExtensionStatuses] = useState<Record<string, IChannelPluginStatus>>({});
  const [extensionLoadingMap, setExtensionLoadingMap] = useState<Record<string, boolean>>({});
  const [extensionFieldValues, setExtensionFieldValues] = useState<ExtensionFieldValues>({});
  const [webuiStatus, setWebuiStatus] = useState<IWebUIStatus | null>(null);

  // WeChat plugin state
  const [wechatPluginStatus, setWechatPluginStatus] = useState<IChannelPluginStatus | null>(null);
  const [wechatEnableLoading, setWechatEnableLoading] = useState(false);

  // WeCom plugin state
  const [wecomPluginStatus, setWecomPluginStatus] = useState<IChannelPluginStatus | null>(null);
  const [wecomEnableLoading, setWecomEnableLoading] = useState(false);

  // Track the token entered in TelegramConfigForm so the toggle handler can use it
  const telegramTokenRef = React.useRef<string>('');

  // Track Lark credentials entered in LarkConfigForm (for enterprise mode switch toggle)
  const larkCredentialsRef = React.useRef<{ appId: string; appSecret: string; encryptKey?: string; verificationToken?: string }>({ appId: '', appSecret: '' });

  // Track DingTalk credentials entered in DingTalkConfigForm (for enterprise mode switch toggle)
  const dingtalkCredentialsRef = React.useRef<{ clientId: string; clientSecret: string }>({ clientId: '', clientSecret: '' });

  // Track WeCom credentials entered in WeComConfigForm
  const wecomCredentialsRef = React.useRef<{ botId: string; secret: string }>({ botId: '', secret: '' });

  // Collapse state - true means collapsed (closed), false means expanded (open)
  const [collapseKeys, setCollapseKeys] = useState<Record<string, boolean>>({
    telegram: true, // Default to collapsed
    lark: true,
    dingtalk: true,
    wechat: true,
    wecom: true,
  });

  // Model selection state — uses unified hook with ConfigStorage persistence
  const telegramModelSelection = useChannelModelSelection('assistant.telegram.defaultModel');
  const larkModelSelection = useChannelModelSelection('assistant.lark.defaultModel');
  const dingtalkModelSelection = useChannelModelSelection('assistant.dingtalk.defaultModel');
  const wechatModelSelection = useChannelModelSelection('assistant.wechat.defaultModel');
  const wecomModelSelection = useChannelModelSelection('assistant.wecom.defaultModel');

  // Load plugin status
  const loadPluginStatus = useCallback(async () => {
    try {
      const result = await channel.getPluginStatus.invoke();
      if (result.success && result.data) {
        const telegramPlugin = result.data.find((p) => p.type === 'telegram');
        const larkPlugin = result.data.find((p) => p.type === 'lark');
        const dingtalkPlugin = result.data.find((p) => p.type === 'dingtalk');
        const wechatPlugin = result.data.find((p) => p.type === 'wechat');
        const wecomPlugin = result.data.find((p) => p.type === 'wecom');
        const extensionPlugins = result.data.filter((p) => !BUILTIN_CHANNEL_TYPES.has(p.type) && p.type !== 'zentao');

        setPluginStatus(telegramPlugin || null);
        setLarkPluginStatus(larkPlugin || null);
        setDingtalkPluginStatus(dingtalkPlugin || null);
        setWechatPluginStatus(wechatPlugin || null);
        setWecomPluginStatus(wecomPlugin || null);
        setExtensionStatuses(() => {
          const next: Record<string, IChannelPluginStatus> = {};
          for (const plugin of extensionPlugins) {
            next[plugin.type] = plugin;
          }
          return next;
        });

        setExtensionFieldValues((prev) => {
          const next: ExtensionFieldValues = { ...prev };
          for (const plugin of extensionPlugins) {
            const fields = [...(plugin.extensionMeta?.credentialFields || []), ...(plugin.extensionMeta?.configFields || [])] as ExtensionFieldSchema[];
            if (!next[plugin.type]) {
              next[plugin.type] = {};
            }
            for (const field of fields) {
              if (next[plugin.type][field.key] === undefined && field.default !== undefined) {
                next[plugin.type][field.key] = field.default;
              }
            }
          }
          return next;
        });
      }
    } catch (error) {
      console.error('[ChannelSettings] Failed to load plugin status:', error);
    }
  }, []);

  // Initial load
  useEffect(() => {
    void loadPluginStatus();
  }, [loadPluginStatus]);

  useEffect(() => {
    const loadWebuiStatus = async () => {
      try {
        const result = await webui.getStatus.invoke();
        if (result?.success && result.data) {
          setWebuiStatus(result.data);
        }
      } catch {
        // Best-effort only: channel settings should not fail if webui status is unavailable.
      }
    };
    void loadWebuiStatus();
  }, []);

  // Listen for plugin status changes
  useEffect(() => {
    const unsubscribe = channel.pluginStatusChanged.on(({ status }) => {
      if (status.type === 'telegram') {
        setPluginStatus(status);
      } else if (status.type === 'lark') {
        setLarkPluginStatus(status);
      } else if (status.type === 'dingtalk') {
        setDingtalkPluginStatus(status);
      } else if (status.type === 'wechat') {
        setWechatPluginStatus(status);
      } else if (status.type === 'wecom') {
        setWecomPluginStatus(status);
      } else if (!BUILTIN_CHANNEL_TYPES.has(status.type)) {
        setExtensionStatuses((prev) => ({
          ...prev,
          [status.type]: {
            ...(prev[status.type] || {}),
            ...status,
            extensionMeta: status.extensionMeta || prev[status.type]?.extensionMeta,
          },
        }));
      }
    });
    return () => unsubscribe();
  }, []);

  // Toggle collapse
  const handleToggleCollapse = (channelId: string) => {
    setCollapseKeys((prev) => ({
      ...prev,
      [channelId]: !prev[channelId],
    }));
  };

  // Enable/Disable plugin
  const handleTogglePlugin = async (enabled: boolean) => {
    setEnableLoading(true);
    try {
      if (enabled) {
        // Check if we have a token - either saved in database or entered in the form
        const pendingToken = telegramTokenRef.current.trim();
        if (!pluginStatus?.hasToken && !pendingToken) {
          Message.warning(t('settings.assistant.tokenRequired', 'Please enter a bot token first'));
          setEnableLoading(false);
          return;
        }

        const result = await channel.enablePlugin.invoke({
          pluginId: 'telegram_default',
          config: pendingToken ? { token: pendingToken } : {},
        });

        if (result.success) {
          Message.success(t('settings.assistant.pluginEnabled', 'Telegram bot enabled'));
          await loadPluginStatus();
        } else {
          Message.error(result.msg || t('settings.assistant.enableFailed', 'Failed to enable plugin'));
        }
      } else {
        const result = await channel.disablePlugin.invoke({ pluginId: 'telegram_default' });

        if (result.success) {
          Message.success(t('settings.assistant.pluginDisabled', 'Telegram bot disabled'));
          await loadPluginStatus();
        } else {
          Message.error(result.msg || t('settings.assistant.disableFailed', 'Failed to disable plugin'));
        }
      }
    } catch (error: any) {
      Message.error(error.message);
    } finally {
      setEnableLoading(false);
    }
  };

  // Enable/Disable Lark plugin
  const handleToggleLarkPlugin = async (enabled: boolean) => {
    if (enabled) {
      const hasPendingCreds = !!(larkCredentialsRef.current.appId.trim() && larkCredentialsRef.current.appSecret.trim());

      // In enterprise mode, credentials may exist on Moss Server even if hasToken is false
      // (e.g. after page refresh before status refreshes). Try to enable with empty config
      // which will preserve server-side credentials.
      if (!isEnterprise && !larkPluginStatus?.hasToken && !hasPendingCreds) {
        setCollapseKeys((prev) => ({ ...prev, lark: false }));
        return;
      }

      setLarkEnableLoading(true);
      try {
        // Pass pending credentials from form if available
        const pendingCreds = larkCredentialsRef.current;
        const hasFormCreds = !!(pendingCreds.appId.trim() && pendingCreds.appSecret.trim());
        const config = hasFormCreds ? { appId: pendingCreds.appId.trim(), appSecret: pendingCreds.appSecret.trim(), encryptKey: pendingCreds.encryptKey, verificationToken: pendingCreds.verificationToken } : {};

        const result = await channel.enablePlugin.invoke({
          pluginId: 'lark_default',
          config,
        });

        if (result.success) {
          Message.success(t('settings.lark.pluginEnabled', 'Lark bot enabled'));
          await loadPluginStatus();
        } else {
          Message.error(result.msg || t('settings.lark.enableFailed', 'Failed to enable Lark plugin'));
        }
      } catch (error: any) {
        Message.error(error.message);
      } finally {
        setLarkEnableLoading(false);
      }
    } else {
      setLarkEnableLoading(true);
      try {
        const result = await channel.disablePlugin.invoke({ pluginId: 'lark_default' });

        if (result.success) {
          Message.success(t('settings.lark.pluginDisabled', 'Lark bot disabled'));
          await loadPluginStatus();
        } else {
          Message.error(result.msg || t('settings.assistant.disableFailed', 'Failed to disable plugin'));
        }
      } catch (error: any) {
        Message.error(error.message);
      } finally {
        setLarkEnableLoading(false);
      }
    }
  };

  // Enable/Disable DingTalk plugin
  const handleToggleDingtalkPlugin = async (enabled: boolean) => {
    if (enabled) {
      const hasPendingCreds = !!(dingtalkCredentialsRef.current.clientId.trim() && dingtalkCredentialsRef.current.clientSecret.trim());

      // In enterprise mode, credentials may exist on Moss Server even if hasToken is false.
      // Try to enable with empty config which will preserve server-side credentials.
      if (!isEnterprise && !dingtalkPluginStatus?.hasToken && !hasPendingCreds) {
        setCollapseKeys((prev) => ({ ...prev, dingtalk: false }));
        return;
      }

      setDingtalkEnableLoading(true);
      try {
        // Pass pending credentials from form if available
        const pendingCreds = dingtalkCredentialsRef.current;
        const hasFormCreds = !!(pendingCreds.clientId.trim() && pendingCreds.clientSecret.trim());
        const config = hasFormCreds ? { clientId: pendingCreds.clientId.trim(), clientSecret: pendingCreds.clientSecret.trim() } : {};

        const result = await channel.enablePlugin.invoke({
          pluginId: 'dingtalk_default',
          config,
        });

        if (result.success) {
          Message.success(t('settings.dingtalk.pluginEnabled', 'DingTalk bot enabled'));
          await loadPluginStatus();
        } else {
          Message.error(result.msg || t('settings.dingtalk.enableFailed', 'Failed to enable DingTalk plugin'));
        }
      } catch (error: any) {
        Message.error(error.message);
      } finally {
        setDingtalkEnableLoading(false);
      }
    } else {
      setDingtalkEnableLoading(true);
      try {
        const result = await channel.disablePlugin.invoke({ pluginId: 'dingtalk_default' });

        if (result.success) {
          Message.success(t('settings.dingtalk.pluginDisabled', 'DingTalk bot disabled'));
          await loadPluginStatus();
        } else {
          Message.error(result.msg || t('settings.dingtalk.disableFailed', 'Failed to disable DingTalk plugin'));
        }
      } catch (error: any) {
        Message.error(error.message);
      } finally {
        setDingtalkEnableLoading(false);
      }
    }
  };

  // WeChat toggle handler — uses standard channel enable/disable flow
  const handleToggleWechatPlugin = async (enabled: boolean) => {
    if (enabled) {
      // In enterprise mode, credentials may exist on Moss Server even if hasToken is false.
      // Try to enable with empty config which will preserve server-side credentials.
      if (!isEnterprise && !wechatPluginStatus?.hasToken) {
        setCollapseKeys((prev) => ({ ...prev, wechat: false }));
        return;
      }

      // Re-enable with existing credentials
      setWechatEnableLoading(true);
      try {
        const result = await channel.enablePlugin.invoke({
          pluginId: 'wechat_default',
          config: {},
        });
        if (result.success) {
          Message.success(t('settings.channels.wechat.installSuccess', 'WeChat enabled'));
          // Force immediate status re-fetch to ensure UI sync
          const statusResult = await channel.getPluginStatus.invoke();
          if (statusResult.success && statusResult.data) {
            const wechatStatus = statusResult.data.find((p) => p.type === 'wechat');
            setWechatPluginStatus(wechatStatus || null);
          }
        } else {
          Message.error(result.msg || 'Failed to enable WeChat');
        }
      } catch (error: any) {
        Message.error(error.message);
      } finally {
        setWechatEnableLoading(false);
      }
    } else {
      // Disable
      setWechatEnableLoading(true);
      try {
        const result = await channel.disablePlugin.invoke({ pluginId: 'wechat_default' });
        if (result.success) {
          Message.success(t('settings.channels.wechat.disabled', 'WeChat disabled'));
          // Force immediate status re-fetch to ensure UI sync
          const statusResult = await channel.getPluginStatus.invoke();
          if (statusResult.success && statusResult.data) {
            const wechatStatus = statusResult.data.find((p) => p.type === 'wechat');
            setWechatPluginStatus(wechatStatus || null);
          }
        } else {
          Message.error(result.msg || 'Failed to disable WeChat');
        }
      } catch (error: any) {
        Message.error(error.message);
      } finally {
        setWechatEnableLoading(false);
      }
    }
  };

  // Enable/Disable WeCom plugin
  const handleToggleWecomPlugin = async (enabled: boolean) => {
    setWecomEnableLoading(true);
    try {
      if (enabled) {
        // Check if we have credentials from form input
        const pendingBotId = wecomCredentialsRef.current.botId.trim();
        const pendingSecret = wecomCredentialsRef.current.secret.trim();

        // If no pending credentials, try to get saved credentials from database
        if (!pendingBotId || !pendingSecret) {
          const credResult = await channel.getPluginCredentials.invoke({ pluginId: 'wecom_default' });
          if (credResult.success && credResult.data?.botId && credResult.data?.secret) {
            // Found saved credentials, use them
            const result = await channel.enablePlugin.invoke({
              pluginId: 'wecom_default',
              config: {},
            });

            if (result.success) {
              Message.success(t('settings.wecom.pluginEnabled', 'WeCom bot enabled'));
              await loadPluginStatus();
            } else {
              Message.error(result.msg || t('settings.wecom.enableFailed', 'Failed to enable WeCom plugin'));
            }
            return;
          }

          // No saved credentials and no pending credentials - show warning
          Message.warning(t('settings.wecom.credentialsRequired', 'Please configure WeCom credentials first'));
          setWecomEnableLoading(false);
          return;
        }

        // Pass credentials from form input
        const result = await channel.enablePlugin.invoke({
          pluginId: 'wecom_default',
          config: { botId: pendingBotId, secret: pendingSecret },
        });

        if (result.success) {
          Message.success(t('settings.wecom.pluginEnabled', 'WeCom bot enabled'));
          await loadPluginStatus();
        } else {
          Message.error(result.msg || t('settings.wecom.enableFailed', 'Failed to enable WeCom plugin'));
        }
      } else {
        const result = await channel.disablePlugin.invoke({ pluginId: 'wecom_default' });

        if (result.success) {
          Message.success(t('settings.wecom.pluginDisabled', 'WeCom bot disabled'));
          await loadPluginStatus();
        } else {
          Message.error(result.msg || t('settings.wecom.disableFailed', 'Failed to disable WeCom plugin'));
        }
      }
    } catch (error: any) {
      Message.error(error.message);
    } finally {
      setWecomEnableLoading(false);
    }
  };

  const updateExtensionFieldValue = useCallback((pluginType: string, key: string, value: string | number | boolean) => {
    setExtensionFieldValues((prev) => ({
      ...prev,
      [pluginType]: {
        ...(prev[pluginType] || {}),
        [key]: value,
      },
    }));
  }, []);

  const handleToggleExtensionPlugin = useCallback(
    async (pluginType: string, enabled: boolean) => {
      const status = extensionStatuses[pluginType];
      if (!status) return;

      setExtensionLoadingMap((prev) => ({ ...prev, [pluginType]: true }));
      try {
        if (enabled) {
          const fieldValues = extensionFieldValues[pluginType] || {};
          const credentialFields = (status.extensionMeta?.credentialFields || []) as ExtensionFieldSchema[];
          const missingField = credentialFields.find((field) => {
            if (!field.required) return false;
            const value = fieldValues[field.key];
            if (field.type === 'boolean') return value === undefined;
            return value === undefined || value === '';
          });

          if (missingField) {
            Message.warning(
              t('settings.channels.extension.requiredField', {
                defaultValue: 'Please fill required field: {{field}}',
                field: missingField.label,
              })
            );
            return;
          }

          const result = await channel.enablePlugin.invoke({
            pluginId: status.id || pluginType,
            config: fieldValues,
          });

          if (result.success) {
            Message.success(t('settings.channels.extension.enabled', { defaultValue: 'Channel enabled' }));
            await loadPluginStatus();
          } else {
            Message.error(result.msg || t('settings.channels.extension.enableFailed', { defaultValue: 'Failed to enable channel' }));
          }
        } else {
          const result = await channel.disablePlugin.invoke({ pluginId: status.id || pluginType });
          if (result.success) {
            Message.success(t('settings.channels.extension.disabled', { defaultValue: 'Channel disabled' }));
            await loadPluginStatus();
          } else {
            Message.error(result.msg || t('settings.channels.extension.disableFailed', { defaultValue: 'Failed to disable channel' }));
          }
        }
      } catch (error: any) {
        Message.error(error.message || String(error));
      } finally {
        setExtensionLoadingMap((prev) => ({ ...prev, [pluginType]: false }));
      }
    },
    [extensionStatuses, extensionFieldValues, t, loadPluginStatus]
  );

  const renderExtensionConfigForm = useCallback(
    (status: IChannelPluginStatus) => {
      const pluginType = status.type;
      const fields = [...((status.extensionMeta?.credentialFields || []) as ExtensionFieldSchema[]), ...((status.extensionMeta?.configFields || []) as ExtensionFieldSchema[])];
      const values = extensionFieldValues[pluginType] || {};
      const callbackPath = '/ext-wecom-bot/webhook';
      const localCallbackUrl = webuiStatus?.localUrl ? `${webuiStatus.localUrl}${callbackPath}` : `http://localhost:25808${callbackPath}`;
      const lanCallbackUrl = webuiStatus?.networkUrl ? `${webuiStatus.networkUrl}${callbackPath}` : null;
      const publicBaseUrl = typeof values.publicBaseUrl === 'string' ? values.publicBaseUrl.trim().replace(/\/+$/, '') : '';
      const publicCallbackUrl = publicBaseUrl ? `${publicBaseUrl}${callbackPath}` : null;

      if (fields.length === 0) {
        return <div className='text-14px text-t-secondary py-12px'>{status.extensionMeta?.description || t('settings.channels.extension.noConfig', { defaultValue: 'No extra configuration required.' })}</div>;
      }

      return (
        <div className='space-y-10px py-4px'>
          {status.extensionMeta?.description && <div className='text-13px text-t-secondary leading-relaxed'>{status.extensionMeta.description}</div>}
          {pluginType === 'ext-wecom-bot' && (
            <div className='text-12px leading-relaxed p-10px rd-8px bg-[rgba(var(--orange-6),0.08)] border border-[rgba(var(--orange-6),0.3)] text-t-secondary'>
              <div className='font-500 text-t-primary mb-6px'>企微回调地址说明</div>
              <div>本机 Callback URL: {localCallbackUrl}</div>
              {lanCallbackUrl ? <div>局域网 Callback URL: {lanCallbackUrl}</div> : null}
              {publicCallbackUrl ? <div>公网 Callback URL(配置值): {publicCallbackUrl}</div> : null}
              <div className='mt-6px'>仅开启 WebUI 远程访问（LAN）通常不能直接通过企微回调。企微服务器需要可访问的公网 HTTPS 地址。</div>
              <div>建议：使用反向代理 + 证书，或 Cloudflare Tunnel / ngrok 映射到本机。</div>
            </div>
          )}
          {fields.map((field) => {
            const rawValue = values[field.key];
            const label = `${field.label}${field.required ? ' *' : ''}`;

            if (field.type === 'boolean') {
              return (
                <div key={`${pluginType}-${field.key}`} className='flex items-center justify-between'>
                  <span className='text-13px text-t-primary'>{label}</span>
                  <Switch checked={Boolean(rawValue)} onChange={(checked) => updateExtensionFieldValue(pluginType, field.key, checked)} />
                </div>
              );
            }

            if (field.type === 'number') {
              return (
                <div key={`${pluginType}-${field.key}`} className='space-y-6px'>
                  <div className='text-13px text-t-primary'>{label}</div>
                  <InputNumber value={typeof rawValue === 'number' ? rawValue : undefined} onChange={(value) => updateExtensionFieldValue(pluginType, field.key, Number(value || 0))} className='w-full' />
                </div>
              );
            }

            if (field.type === 'select') {
              return (
                <div key={`${pluginType}-${field.key}`} className='space-y-6px'>
                  <div className='text-13px text-t-primary'>{label}</div>
                  <Select value={typeof rawValue === 'string' ? rawValue : undefined} options={(field.options || []).map((option) => ({ label: option, value: option }))} onChange={(value) => updateExtensionFieldValue(pluginType, field.key, String(value))} placeholder={t('settings.channels.extension.selectPlaceholder', { defaultValue: 'Please select' })} allowClear />
                </div>
              );
            }

            return (
              <div key={`${pluginType}-${field.key}`} className='space-y-6px'>
                <div className='text-13px text-t-primary'>{label}</div>
                <Input value={typeof rawValue === 'string' ? rawValue : ''} onChange={(value) => updateExtensionFieldValue(pluginType, field.key, value)} placeholder={field.label} type={field.type === 'password' ? 'password' : 'text'} />
              </div>
            );
          })}
        </div>
      );
    },
    [extensionFieldValues, t, updateExtensionFieldValue, webuiStatus]
  );

  // Build channel configurations
  const channels: ChannelConfig[] = useMemo(() => {
    const telegramChannel: ChannelConfig = {
      id: 'telegram',
      title: t('settings.channels.telegramTitle', 'Telegram'),
      description: t('settings.channels.telegramDesc', 'Chat with Sudowork assistant via Telegram'),
      status: 'active',
      enabled: pluginStatus?.enabled || false,
      disabled: enableLoading,
      isConnected: pluginStatus?.connected || false,
      botUsername: pluginStatus?.botUsername,
      defaultModel: telegramModelSelection.currentModel?.useModel,
      content: (
        <TelegramConfigForm
          pluginStatus={pluginStatus}
          modelSelection={telegramModelSelection}
          onStatusChange={setPluginStatus}
          onTokenChange={(token) => {
            telegramTokenRef.current = token;
          }}
        />
      ),
    };

    const larkChannel: ChannelConfig = {
      id: 'lark',
      title: t('settings.channels.larkTitle', 'Lark / Feishu'),
      description: t('settings.channels.larkDesc', 'Chat with Sudowork assistant via Lark or Feishu'),
      status: 'active',
      enabled: larkPluginStatus?.enabled || false,
      disabled: larkEnableLoading,
      isConnected: larkPluginStatus?.connected || false,
      defaultModel: larkModelSelection.currentModel?.useModel,
      content: (
        <LarkConfigForm
          pluginStatus={larkPluginStatus}
          modelSelection={larkModelSelection}
          onStatusChange={setLarkPluginStatus}
          onCredentialsChange={(creds) => {
            larkCredentialsRef.current = creds;
          }}
        />
      ),
    };

    const dingtalkChannel: ChannelConfig = {
      id: 'dingtalk',
      title: t('settings.channels.dingtalkTitle', 'DingTalk'),
      description: t('settings.channels.dingtalkDesc', 'Chat with Sudowork assistant via DingTalk'),
      status: 'active',
      enabled: dingtalkPluginStatus?.enabled || false,
      disabled: dingtalkEnableLoading,
      isConnected: dingtalkPluginStatus?.connected || false,
      defaultModel: dingtalkModelSelection.currentModel?.useModel,
      content: (
        <DingTalkConfigForm
          pluginStatus={dingtalkPluginStatus}
          modelSelection={dingtalkModelSelection}
          onStatusChange={setDingtalkPluginStatus}
          onCredentialsChange={(creds) => {
            dingtalkCredentialsRef.current = creds;
          }}
        />
      ),
    };

    const wechatChannel: ChannelConfig = {
      id: 'wechat',
      title: t('settings.channels.wechatTitle', 'Personal WeChat'),
      status: 'active',
      enabled: wechatPluginStatus?.enabled || false,
      disabled: wechatEnableLoading,
      isConnected: wechatPluginStatus?.connected || false,
      defaultModel: wechatModelSelection.currentModel?.useModel,
      content: <WeChatConfigForm pluginStatus={wechatPluginStatus} modelSelection={wechatModelSelection} onStatusChange={setWechatPluginStatus} />,
    };

    const wecomChannel: ChannelConfig = {
      id: 'wecom',
      title: t('settings.channels.wecomTitle', 'WeCom'),
      description: t('settings.channels.wecomDesc', 'Chat with Sudowork assistant via WeCom (WeChat Work)'),
      status: 'active',
      enabled: wecomPluginStatus?.enabled || false,
      disabled: wecomEnableLoading,
      isConnected: wecomPluginStatus?.connected || false,
      defaultModel: wecomModelSelection.currentModel?.useModel,
      content: (
        <WeComConfigForm
          pluginStatus={wecomPluginStatus}
          modelSelection={wecomModelSelection}
          onStatusChange={setWecomPluginStatus}
          onCredentialsChange={(creds) => {
            wecomCredentialsRef.current = creds;
          }}
        />
      ),
    };

    const extensionChannels: ChannelConfig[] = Object.values(extensionStatuses)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((status) => ({
        id: status.type,
        title: status.name,
        description: status.extensionMeta?.description || t('settings.channels.extension.defaultDesc', { defaultValue: 'Extension channel plugin' }),
        status: 'active',
        enabled: status.enabled || false,
        disabled: extensionLoadingMap[status.type] || false,
        isConnected: status.connected || false,
        icon: status.extensionMeta?.icon,
        isExtension: true,
        content: renderExtensionConfigForm(status),
      }));

    const extensionTypeSet = new Set(extensionChannels.map((channel) => String(channel.id).toLowerCase()));

    return [telegramChannel, larkChannel, dingtalkChannel, wechatChannel, wecomChannel, ...extensionChannels];
  }, [pluginStatus, larkPluginStatus, dingtalkPluginStatus, wechatPluginStatus, wecomPluginStatus, extensionStatuses, extensionLoadingMap, telegramModelSelection, larkModelSelection, dingtalkModelSelection, wechatModelSelection, wecomModelSelection, wechatEnableLoading, wecomEnableLoading, enableLoading, larkEnableLoading, dingtalkEnableLoading, renderExtensionConfigForm, t]);

  // Get toggle handler for each channel
  const getToggleHandler = (channelId: string) => {
    if (channelId === 'telegram') return handleTogglePlugin;
    if (channelId === 'lark') return handleToggleLarkPlugin;
    if (channelId === 'dingtalk') return handleToggleDingtalkPlugin;
    if (channelId === 'wechat') return handleToggleWechatPlugin;
    if (channelId === 'wecom') return handleToggleWecomPlugin;
    if (extensionStatuses[channelId]) {
      return (enabled: boolean) => {
        void handleToggleExtensionPlugin(channelId, enabled);
      };
    }
    return undefined;
  };
  const channelGuideText = t('settings.webui.featureChannelsDesc', { defaultValue: 'Connect Telegram, Lark, DingTalk, and WeChat to interact with Sudowork from IM apps.' });
  const channelSetupSteps = [t('settings.channels.selectFirst', { defaultValue: 'Select a channel and configure credentials.' }), t('settings.channels.enableAfterConfig', { defaultValue: 'Enable it and start chatting with your AI agent.' })];

  return (
    <AionScrollArea className={isPageMode ? 'h-full' : ''}>
      <div className='px-[12px] md:px-[28px]'>
        <h2 className='text-20px font-500 text-t-primary m-0'>{t('settings.channels.title', 'Channels')}</h2>
        <div className='space-y-8px mt-10px'>
          <div className='text-13px text-t-secondary leading-relaxed'>{channelGuideText}</div>
          <div className='flex flex-wrap gap-x-12px gap-y-6px'>
            {channelSetupSteps.map((stepLabel, idx) => (
              <div key={stepLabel} className='inline-flex items-center gap-6px'>
                <span className='inline-flex items-center justify-center w-16px h-16px rd-50% text-10px font-600 bg-[rgba(var(--primary-6),0.12)] text-[rgb(var(--primary-6))]'>{idx + 1}</span>
                <CheckOne theme='outline' size='12' className='text-[rgb(var(--primary-6))]' />
                <span className='text-12px text-t-secondary'>{stepLabel}</span>
              </div>
            ))}
          </div>
        </div>

        <div className='space-y-12px mt-12px'>
          {channels.map((channelConfig) => (
            <ChannelItem key={channelConfig.id} channel={channelConfig} isCollapsed={collapseKeys[channelConfig.id] || false} onToggleCollapse={() => handleToggleCollapse(channelConfig.id)} onToggleEnabled={getToggleHandler(channelConfig.id)} />
          ))}
        </div>
      </div>
    </AionScrollArea>
  );
};

export default ChannelModalContent;
