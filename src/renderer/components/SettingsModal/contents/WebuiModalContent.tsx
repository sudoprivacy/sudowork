/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form, Input, Message, Tabs } from '@arco-design/web-react';
import { Communication } from '@icon-park/react';
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { webui, type IWebUIStatus } from '@/common/ipcBridge';
import AionModal from '@/renderer/components/base/AionModal';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import ChannelDingTalkLogo from '@/renderer/assets/channel-logos/dingtalk.svg';
import ChannelLarkLogo from '@/renderer/assets/channel-logos/lark.svg';
import ChannelTelegramLogo from '@/renderer/assets/channel-logos/telegram.svg';
import ChannelWeChatLogo from '@/renderer/assets/channel-logos/wechat.svg';
import { isElectronDesktop } from '@/renderer/utils/platform';
import { useAppMode } from '@/renderer/hooks/useAppMode';

const CHANNEL_LOGOS = [
  { src: ChannelWeChatLogo, alt: 'WeChat' },
  { src: ChannelTelegramLogo, alt: 'Telegram' },
  { src: ChannelLarkLogo, alt: 'Lark' },
  { src: ChannelDingTalkLogo, alt: 'DingTalk' },
] as const;

const ChannelModalContentLazy = React.lazy(() => import('./ChannelModalContent'));
const SecretModalContentLazy = React.lazy(() => import('./secrets/SecretModalContent'));

/**
 * WebUI 设置内容组件
 * WebUI settings content component
 */
const WebuiModalContent: React.FC = () => {
  const { t } = useTranslation();
  const { isEnterprise } = useAppMode();
  const [activeTab, setActiveTab] = useState<'channels' | 'secrets'>('channels');
  const handleTabChange = useCallback((key: string) => {
    setActiveTab(key === 'channels' ? 'channels' : 'secrets');
  }, []);

  // 检测是否在 Electron 桌面环境 / Check if running in Electron desktop environment
  const isDesktop = isElectronDesktop();

  const [status, setStatus] = useState<IWebUIStatus | null>(null);

  const [allowRemote, setAllowRemote] = useState(false);

  // 设置新密码弹窗 / Set new password modal
  const [setPasswordModalVisible, setSetPasswordModalVisible] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [form] = Form.useForm();

  // 二维码登录相关状态 / QR code login related state
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const qrRefreshTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 加载状态 / Load status
  const loadStatus = useCallback(async () => {
    try {
      let result: { success: boolean; data?: IWebUIStatus } | null = null;

      // 优先使用直接 IPC（Electron 环境）/ Prefer direct IPC (Electron environment)
      if (window.electronAPI?.webuiGetStatus) {
        result = await window.electronAPI.webuiGetStatus();
      } else {
        // 后备方案：使用 bridge（减少超时）/ Fallback: use bridge (reduced timeout)
        const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500));
        result = await Promise.race([webui.getStatus.invoke(), timeoutPromise]);
      }

      if (result && result.success && result.data) {
        setStatus(result.data);
        setAllowRemote(result.data.allowRemote);
        // 注意：如果 running 但没有密码，会在下面的 useEffect 中自动重置
        // Note: If running but no password, auto-reset will be triggered in the useEffect below
      } else {
        setStatus(
          (prev) =>
            prev || {
              running: false,
              port: 25808,
              allowRemote: false,
              localUrl: 'http://localhost:25808',
              adminUsername: 'admin',
            }
        );
      }
    } catch (error) {
      console.error('[WebuiModal] Failed to load WebUI status:', error);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  // 监听状态变更事件 / Listen to status change events
  useEffect(() => {
    const unsubscribe = webui.statusChanged.on((data) => {
      if (data.running) {
        setStatus((prev) => ({
          ...(prev || { adminUsername: 'admin' }),
          running: true,
          port: data.port ?? prev?.port ?? 25808,
          allowRemote: prev?.allowRemote ?? false,
          localUrl: data.localUrl ?? `http://localhost:${data.port ?? 25808}`,
          networkUrl: data.networkUrl,
          lanIP: prev?.lanIP,
          initialPassword: prev?.initialPassword,
        }));
      } else {
        setStatus((prev) => (prev ? { ...prev, running: false } : null));
      }
    });
    return () => unsubscribe();
  }, []);

  // 监听密码重置结果事件（Web 环境后备）/ Listen to password reset result events (Web environment fallback)
  useEffect(() => {
    const unsubscribe = webui.resetPasswordResult.on((data) => {
      if (data.success && data.newPassword) {
        setStatus((prev) => (prev ? { ...prev, initialPassword: data.newPassword } : null));
      }
    });
    return () => unsubscribe();
  }, []);

  // 提交新密码 / Submit new password
  const handleSetNewPassword = async () => {
    try {
      const values = await form.validate();
      setPasswordLoading(true);

      let result: { success: boolean; msg?: string };

      // 优先使用直接 IPC（Electron 环境）/ Prefer direct IPC (Electron environment)
      if (window.electronAPI?.webuiChangePassword) {
        result = await window.electronAPI.webuiChangePassword(values.newPassword);
      } else {
        // 后备方案：使用 bridge / Fallback: use bridge
        result = await webui.changePassword.invoke({
          newPassword: values.newPassword,
        });
      }

      if (result.success) {
        Message.success(t('settings.webui.passwordChanged'));
        setSetPasswordModalVisible(false);
        form.resetFields();
        setStatus((prev) => (prev ? { ...prev, initialPassword: undefined } : null));
      } else {
        Message.error(result.msg || t('settings.webui.passwordChangeFailed'));
      }
    } catch (error) {
      console.error('Set new password error:', error);
      Message.error(t('settings.webui.passwordChangeFailed'));
    } finally {
      setPasswordLoading(false);
    }
  };

  // 生成二维码 / Generate QR code
  const generateQRCode = useCallback(async () => {
    if (!status?.running) return;
    try {
      // 优先使用直接 IPC（Electron 环境）/ Prefer direct IPC (Electron environment)
      let result: { success: boolean; data?: { token: string; expiresAt: number; qrUrl: string }; msg?: string } | null = null;

      if (window.electronAPI?.webuiGenerateQRToken) {
        result = await window.electronAPI.webuiGenerateQRToken();
      } else {
        // 后备方案：使用 bridge / Fallback: use bridge
        result = await webui.generateQRToken.invoke();
      }

      if (result && result.success && result.data) {
        setQrUrl(result.data.qrUrl);

        // 设置自动刷新定时器（4分钟后自动刷新，因为 token 5分钟过期）
        // Set auto-refresh timer (refresh after 4 minutes, as token expires in 5 minutes)
        if (qrRefreshTimerRef.current) {
          clearTimeout(qrRefreshTimerRef.current);
        }
        qrRefreshTimerRef.current = setTimeout(
          () => {
            void generateQRCode();
          },
          4 * 60 * 1000
        );
      } else {
        console.error('Generate QR code failed:', result?.msg);
        Message.error(t('settings.webui.qrGenerateFailed'));
      }
    } catch (error) {
      console.error('Generate QR code error:', error);
      Message.error(t('settings.webui.qrGenerateFailed'));
    }
  }, [status?.running, t]);

  // 当服务器启动且允许远程访问时自动生成二维码 / Auto-generate QR code when server starts and remote access is allowed
  useEffect(() => {
    if (status?.running && allowRemote && !qrUrl) {
      void generateQRCode();
    }
    // 清理定时器 / Cleanup timer
    return () => {
      if (qrRefreshTimerRef.current) {
        clearTimeout(qrRefreshTimerRef.current);
      }
    };
  }, [status?.running, allowRemote, generateQRCode, qrUrl]);

  // 服务器停止或关闭远程访问时清除二维码 / Clear QR code when server stops or remote access is disabled
  useEffect(() => {
    if (!status?.running || !allowRemote) {
      setQrUrl(null);
      if (qrRefreshTimerRef.current) {
        clearTimeout(qrRefreshTimerRef.current);
        qrRefreshTimerRef.current = null;
      }
    }
  }, [status?.running, allowRemote]);

  // 浏览器端只显示 Channels 配置，不显示 WebUI 服务配置 / In browser mode, only show Channels config, not WebUI service config
  if (!isDesktop) {
    return (
      <div className='flex flex-col h-full w-full'>
        <AionScrollArea className='flex-1 min-h-0 pb-16px' disableOverflow>
          <div className='space-y-16px'>
            <h2 className='text-20px font-500 text-foreground m-0'>Channels</h2>
            <Suspense fallback={<div className='text-13px text-secondary'>{t('common.loading')}</div>}>
              <ChannelModalContentLazy />
            </Suspense>
          </div>
        </AionScrollArea>
      </div>
    );
  }

  return (
    <div className='flex flex-col h-full w-full'>
      <div className='px-[12px] md:px-[28px]'>
        <div className='max-w-820px mx-auto w-full'>
          <div className='settings-remote-tabs mb-12px'>
            <Tabs activeTab={activeTab} onChange={handleTabChange} type='line'>
              {/* <Tabs.TabPane
          key='webui'
          title={
            <span data-webui-tab='webui' className={`inline-flex items-center gap-6px transition-colors ${activeTab === 'webui' ? 'text-foreground font-600' : 'text-secondary'}`}>
              <Earth theme='outline' size='15' />
              <span>WebUI</span>
            </span>
          }
        /> */}
              <Tabs.TabPane
                key='channels'
                title={
                  <span data-webui-tab='channels' className={`inline-flex items-center gap-6px leading-none transition-colors ${activeTab === 'channels' ? 'text-foreground font-600' : 'text-secondary'}`}>
                    <Communication theme='outline' size='15' />
                    <span>Channels</span>
                    <span className='inline-flex items-center gap-4px ml-2px'>
                      {CHANNEL_LOGOS.map((item) => (
                        <span key={item.alt} className='inline-flex items-center justify-center w-16px h-16px rd-50% border bg-fill-1' title={item.alt} aria-label={item.alt}>
                          <img src={item.src} alt={item.alt} className='w-14px h-14px object-contain' />
                        </span>
                      ))}
                    </span>
                  </span>
                }
              />
              <Tabs.TabPane
                key='secrets'
                title={
                  <span data-webui-tab='secrets' className={`inline-flex items-center gap-6px leading-none transition-colors ${activeTab === 'secrets' ? 'text-foreground font-600' : 'text-secondary'}`}>
                    <span className='text-14px'>{isEnterprise ? t('settings.secrets.enterprise', '我的凭据') : t('settings.secrets', '秘钥管理')}</span>
                  </span>
                }
              />
            </Tabs>
          </div>
        </div>
      </div>

      {/* {activeTab === 'webui' ? (
        webuiPanel
      ) : ( */}
      <div className='flex-1 min-h-0 px-[12px] md:px-[28px] pb-18px'>
        <div className='max-w-820px mx-auto w-full'>
          {activeTab === 'secrets' ? (
            <Suspense fallback={<div className='max-w-820px mx-auto w-full text-13px text-secondary'>{t('common.loading')}</div>}>
              <SecretModalContentLazy />
            </Suspense>
          ) : (
            <Suspense fallback={<div className='max-w-820px mx-auto w-full text-13px text-secondary'>{t('common.loading')}</div>}>
              <ChannelModalContentLazy />
            </Suspense>
          )}
        </div>
      </div>
      {/* )} */}

      {/* 设置新密码弹窗 / Set New Password Modal */}
      <AionModal visible={setPasswordModalVisible} onCancel={() => setSetPasswordModalVisible(false)} onOk={handleSetNewPassword} confirmLoading={passwordLoading} title={t('settings.webui.setNewPassword')} size='small'>
        <Form form={form} layout='vertical' className='pt-16px'>
          <Form.Item
            label={t('settings.webui.newPassword')}
            field='newPassword'
            rules={[
              { required: true, message: t('settings.webui.newPasswordRequired') },
              { minLength: 8, message: t('settings.webui.passwordMinLength') },
            ]}
          >
            <Input.Password placeholder={t('settings.webui.newPasswordPlaceholder')} />
          </Form.Item>
          <Form.Item
            label={t('settings.webui.confirmPassword')}
            field='confirmPassword'
            rules={[
              { required: true, message: t('settings.webui.confirmPasswordRequired') },
              {
                validator: (value, callback) => {
                  if (value !== form.getFieldValue('newPassword')) {
                    callback(t('settings.webui.passwordMismatch'));
                  } else {
                    callback();
                  }
                },
              },
            ]}
          >
            <Input.Password placeholder={t('settings.webui.confirmPasswordPlaceholder')} />
          </Form.Item>
        </Form>
      </AionModal>
    </div>
  );
};

export default WebuiModalContent;
