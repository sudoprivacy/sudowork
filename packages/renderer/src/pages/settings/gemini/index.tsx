/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Divider, Form, Input, Message } from '@arco-design/web-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import { ConfigStorage } from '@sudowork/common/storage';
import AionScrollArea from '@renderer/components/base/AionScrollArea';
import PageWrapper from '@renderer/components/base/PageWrapper';

type GeminiConfig = Parameters<typeof ConfigStorage.set<'gemini.config'>>[1];

const toGeminiConfig = (config: Record<string, unknown>, accountProjects?: Record<string, string>): GeminiConfig => ({
  authType: typeof config.authType === 'string' ? config.authType : '',
  proxy: typeof config.proxy === 'string' ? config.proxy : '',
  GOOGLE_GEMINI_BASE_URL: typeof config.GOOGLE_GEMINI_BASE_URL === 'string' ? config.GOOGLE_GEMINI_BASE_URL : undefined,
  accountProjects: accountProjects && Object.keys(accountProjects).length > 0 ? accountProjects : undefined,
  yoloMode: typeof config.yoloMode === 'boolean' ? config.yoloMode : undefined,
  preferredMode: typeof config.preferredMode === 'string' ? config.preferredMode : undefined,
});

const GeminiSettings: React.FC = () => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [googleAccountLoading, setGoogleAccountLoading] = useState(false);
  const [userLoggedOut, setUserLoggedOut] = useState(false);
  const [currentAccountEmail, setCurrentAccountEmail] = useState<string | null>(null);
  const readyRef = useRef(false);
  const saveTimerRef = useRef<number | undefined>(undefined);

  /**
   * 加载当前账号对应的 GOOGLE_CLOUD_PROJECT
   * Load GOOGLE_CLOUD_PROJECT for current account
   */
  const loadAccountProject = useCallback(
    async (email: string, geminiConfig: Record<string, unknown>) => {
      const accountProjects = (geminiConfig?.accountProjects as Record<string, string>) || {};
      const projectId = accountProjects[email];

      // 清理旧的全局配置（不自动迁移，因为可能属于其他账号）
      // Clean up old global config (don't auto-migrate, it might belong to another account)
      if (geminiConfig?.GOOGLE_CLOUD_PROJECT) {
        const { GOOGLE_CLOUD_PROJECT: _, ...restConfig } = geminiConfig;
        await ConfigStorage.set('gemini.config', toGeminiConfig(restConfig, accountProjects));
      }

      form.setFieldValue('GOOGLE_CLOUD_PROJECT', projectId || '');
    },
    [form]
  );

  const loadGoogleAuthStatus = useCallback(
    (proxy?: string, geminiConfig?: Record<string, unknown>) => {
      setGoogleAccountLoading(true);
      ipcBridge.googleAuth.status
        .invoke({ proxy: proxy })
        .then((data) => {
          if (data.success && data.data?.account) {
            const email = data.data.account;
            form.setFieldValue('googleAccount', email);
            setCurrentAccountEmail(email);
            setUserLoggedOut(false);
            // 加载该账号的项目配置 / Load project config for this account
            if (geminiConfig) {
              void loadAccountProject(email, geminiConfig);
            }
          } else if (data.success === false && (!data.msg || userLoggedOut)) {
            form.setFieldValue('googleAccount', '');
            setCurrentAccountEmail(null);
          }
        })
        .catch((error) => {
          console.warn('Failed to check Google auth status:', error);
        })
        .finally(() => {
          setGoogleAccountLoading(false);
        });
    },
    [form, loadAccountProject, userLoggedOut]
  );

  const saveConfig = useCallback(async () => {
    try {
      const values = form.getFieldsValue();
      const { googleAccount: _googleAccount, GOOGLE_CLOUD_PROJECT, ...restConfig } = values;

      const existingConfig = ((await ConfigStorage.get('gemini.config')) || {}) as Record<string, unknown>;
      const accountProjects = (existingConfig.accountProjects as Record<string, string>) || {};

      if (currentAccountEmail && GOOGLE_CLOUD_PROJECT) {
        accountProjects[currentAccountEmail] = GOOGLE_CLOUD_PROJECT;
      } else if (currentAccountEmail && !GOOGLE_CLOUD_PROJECT) {
        delete accountProjects[currentAccountEmail];
      }

      const geminiConfig = toGeminiConfig(restConfig, accountProjects);

      await ConfigStorage.set('gemini.config', geminiConfig);
    } catch (error: unknown) {
      console.error('[GeminiSettings] Auto-save failed:', error);
    }
  }, [currentAccountEmail, form]);

  const debouncedSave = useCallback(() => {
    if (!readyRef.current) return;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      void saveConfig();
    }, 500);
  }, [saveConfig]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    Promise.all([ConfigStorage.get('gemini.config')])
      .then(([geminiConfig]) => {
        const formData = {
          ...geminiConfig,
          // 先不设置 GOOGLE_CLOUD_PROJECT，等账号加载完再设置
          // Don't set GOOGLE_CLOUD_PROJECT yet, wait for account to load
          GOOGLE_CLOUD_PROJECT: '',
        };
        form.setFieldsValue(formData);
        readyRef.current = true;
        loadGoogleAuthStatus(geminiConfig?.proxy, geminiConfig);
      })
      .catch((error) => {
        console.error('Failed to load configuration:', error);
      });
  }, [form, loadGoogleAuthStatus]);

  return (
    <PageWrapper>
      <div className='flex flex-col h-full w-full'>
        <AionScrollArea className='flex-1 min-h-0' disableOverflow>
          <div className='space-y-4'>
            <div className='px-6 py-4 bg-muted rd-12px md:rd-16px border border-light'>
              <Form form={form} layout='horizontal' labelCol={{ flex: '140px' }} labelAlign='left' wrapperCol={{ flex: '1' }} onValuesChange={debouncedSave}>
                <Form.Item label={t('settings.personalAuth')} field='googleAccount' layout='horizontal'>
                  {(props) => (
                    <div className={'flex flex-wrap items-center gap-3 mt-3 w-full justify-start md:mt-0 md:w-auto md:justify-end'}>
                      {props.googleAccount ? (
                        <>
                          <span className='text-14px text-foreground'>{props.googleAccount}</span>
                          <Button
                            size='small'
                            className='rd-100px'
                            shape='round'
                            type='outline'
                            onClick={() => {
                              setUserLoggedOut(true);
                              ipcBridge.googleAuth.logout
                                .invoke({})
                                .then(() => {
                                  form.setFieldValue('googleAccount', '');
                                })
                                .catch((error) => {
                                  console.error('Failed to logout from Google:', error);
                                });
                            }}
                          >
                            {t('settings.googleLogout')}
                          </Button>
                        </>
                      ) : (
                        <Button
                          type='primary'
                          loading={googleAccountLoading}
                          className='rd-100px'
                          onClick={() => {
                            setGoogleAccountLoading(true);
                            ipcBridge.googleAuth.login
                              .invoke({ proxy: form.getFieldValue('proxy') })
                              .then((result) => {
                                if (result.success) {
                                  loadGoogleAuthStatus(form.getFieldValue('proxy'));
                                  if (result.data?.account) {
                                    Message.success(t('settings.googleLoginSuccess', { defaultValue: 'Successfully logged in' }));
                                  }
                                } else {
                                  // 登录失败，显示错误消息
                                  // Login failed, show error message
                                  const errorMsg = result.msg || t('settings.googleLoginFailed', { defaultValue: 'Login failed. Please try again.' });
                                  Message.error(errorMsg);
                                  console.error('[GoogleAuth] Login failed:', result.msg);
                                }
                              })
                              .catch((error) => {
                                Message.error(t('settings.googleLoginFailed', { defaultValue: 'Login failed. Please try again.' }));
                                console.error('Failed to login to Google:', error);
                              })
                              .finally(() => {
                                setGoogleAccountLoading(false);
                              });
                          }}
                        >
                          {t('settings.googleLogin')}
                        </Button>
                      )}
                    </div>
                  )}
                </Form.Item>
                <Divider className='mt-0 mb-5' />

                <Form.Item label={t('settings.proxyConfig')} field='proxy' layout='vertical' rules={[{ match: /^https?:\/\/.+$/, message: t('settings.proxyHttpOnly') }]}>
                  <Input placeholder={t('settings.proxyHttpOnly')} />
                </Form.Item>
                <Divider className='mt-0 mb-5' />

                <Form.Item label='GOOGLE_CLOUD_PROJECT' field='GOOGLE_CLOUD_PROJECT' layout='vertical'>
                  <Input placeholder={t('settings.googleCloudProjectPlaceholder')} />
                </Form.Item>
              </Form>
            </div>
          </div>
        </AionScrollArea>
      </div>
    </PageWrapper>
  );
};

export default GeminiSettings;
