/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { Button, Input, Message, Spin } from '@arco-design/web-react';
import { Building2, CheckCircle, XCircle } from 'lucide-react';
import { ConfigStorage } from '@sudowork/common/storage';
import { normalizeHttpOrigin } from '@sudowork/common/sudoworkServer';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import { TENANT_CONFIG_STORAGE_KEY, resolveTenantConfig } from '@sudowork/common/types/tenantConfig';
import { useAuth } from '@renderer/context/AuthContext';
import { useTranslation } from 'react-i18next';
import PageWrapper from '@renderer/components/base/PageWrapper';

const MOSS_URL_STORAGE_KEY = 'login.mossBaseUrl';
const isWebRuntime = typeof window !== 'undefined' && !window.electronAPI;

function EnterpriseSettings() {
  const { t } = useTranslation();
  const { logout } = useAuth();
  const [tenantName, setTenantName] = useState<string>('');
  const [serverUrl, setServerUrl] = useState<string>('');
  const [editingServerUrl, setEditingServerUrl] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [isSaving, setSaving] = useState(false);
  const [isLoading, setLoading] = useState(true);

  const [draftError, setDraftError] = useState('');
  const operation = useRef(0);
  const isBusy = useRef(false);
  const normalizedDraft = normalizeHttpOrigin(editingServerUrl);
  const isUnchanged = normalizedDraft !== null && normalizedDraft === normalizeHttpOrigin(serverUrl);

  useEffect(() => {
    const requestId = ++operation.current;
    const loadConfig = async () => {
      try {
        const name = await ConfigStorage.get('eeclaw.tenantName');
        let url: string | undefined;
        if (isWebRuntime) {
          // Web：本地自定义 moss 地址优先，未设置则回退 webui 服务器配置的 moss 地址。
          // 桌面兼容键 eeclaw.serverUrl 在 web 上是 origin 占位种子，不作为显示来源。
          url = localStorage.getItem(MOSS_URL_STORAGE_KEY) || undefined;
          if (!url) {
            const response = await fetch('/api/settings/about', { credentials: 'include' });
            if (response.ok) {
              const data = (await response.json()) as { mossBaseUrl?: string };
              url = data.mossBaseUrl;
            }
          }
        } else {
          url = await ConfigStorage.get('eeclaw.serverUrl');
        }
        if (requestId !== operation.current) return;
        setTenantName(name || '');
        setServerUrl(url || '');
        setEditingServerUrl(url || '');
        if (!url) {
          setConnectionStatus('disconnected');
        } else if (isWebRuntime) {
          // Check the authenticated upstream, not just the saved address.
          const response = await fetch('/api/settings/profile', { credentials: 'include' });
          if (requestId === operation.current) setConnectionStatus(response.ok ? 'connected' : 'disconnected');
        } else {
          const result = await ipcBridge.eeclaw.verifyServer.invoke({ serverUrl: url });
          if (requestId === operation.current) setConnectionStatus(result.success ? 'connected' : 'disconnected');
        }
      } catch (error) {
        console.error('[EnterpriseSettings] Failed to load config:', error);
        setConnectionStatus('disconnected');
      } finally {
        setLoading(false);
      }
    };
    void loadConfig();
    return () => {
      operation.current++;
    };
  }, []);

  const verify = async (url: string) => {
    if (isWebRuntime) {
      const response = await fetch(`/api/v1/system-config?mossBaseUrl=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('server_verification_failed');
      const body = await response.json();
      if (!body.success || !body.data) throw new Error('server_verification_failed');
      return resolveTenantConfig(body.data);
    }
    const result = await ipcBridge.eeclaw.verifyServer.invoke({ serverUrl: url });
    if (!result.success || !result.data) throw new Error('server_verification_failed');
    return resolveTenantConfig(result.data);
  };

  const onRecheck = async () => {
    if (isBusy.current || !serverUrl) return;
    isBusy.current = true;
    const requestId = ++operation.current;
    setConnectionStatus('checking');
    try {
      await verify(serverUrl);
      if (requestId === operation.current) setConnectionStatus('connected');
    } catch {
      if (requestId === operation.current) setConnectionStatus('disconnected');
    } finally {
      isBusy.current = false;
    }
  };

  const onSaveServerUrl = async () => {
    if (isBusy.current || isUnchanged) return;
    if (!normalizedDraft) {
      setDraftError(t('settings.enterpriseConnection.invalidUrl'));
      return;
    }
    isBusy.current = true;
    const requestId = ++operation.current;
    setSaving(true);
    setDraftError('');
    try {
      const tenantConfig = await verify(normalizedDraft);
      if (requestId !== operation.current) return;
      if (isWebRuntime) {
        localStorage.setItem(MOSS_URL_STORAGE_KEY, normalizedDraft);
      } else {
        // Roll back configuration if persistence fails; keep the active identity usable.
        const previousTenant = await ConfigStorage.get('eeclaw.tenantName');
        const previousConfig = localStorage.getItem(TENANT_CONFIG_STORAGE_KEY);
        try {
          await ConfigStorage.set('eeclaw.serverUrl', normalizedDraft);
          await ConfigStorage.set('eeclaw.tenantName', tenantConfig.app_company_name);
          localStorage.setItem(TENANT_CONFIG_STORAGE_KEY, JSON.stringify(tenantConfig));
        } catch (error) {
          await ConfigStorage.set('eeclaw.serverUrl', serverUrl);
          await ConfigStorage.set('eeclaw.tenantName', previousTenant);
          if (previousConfig === null) localStorage.removeItem(TENANT_CONFIG_STORAGE_KEY);
          else localStorage.setItem(TENANT_CONFIG_STORAGE_KEY, previousConfig);
          throw error;
        }
      }
      setServerUrl(normalizedDraft);
      setEditingServerUrl(normalizedDraft);
      setTenantName(tenantConfig.app_company_name);
      setConnectionStatus('connected');
      await logout({ isLocalOnly: !isWebRuntime });
      Message.success(t('settings.enterpriseConnection.updated'));
    } catch {
      if (requestId === operation.current) setDraftError(t('settings.enterpriseConnection.verificationFailed'));
    } finally {
      isBusy.current = false;
      if (requestId === operation.current) setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <PageWrapper>
        <div className='f-center py-25'>
          <Spin size={32} />
        </div>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      {/* Card 1: Enterprise Connection Info */}
      <div className='mb-6 rd-16px bg-muted p-6'>
        <div className='flex items-center gap-2 mb-5'>
          <Building2 size={20} className='text-secondary' />
          <h3 className='text-16px font-600 text-foreground m-0'>{t('settings.enterpriseConnection.title')}</h3>
        </div>

        <div className='flex flex-col gap-4'>
          {/* Tenant Name (read-only) */}
          <div className='flex items-center justify-between py-2'>
            <div className='flex items-center gap-2'>
              <Building2 size={16} className='text-secondary' />
              <span className='text-14px text-secondary'>{t('settings.enterpriseConnection.tenantName')}</span>
            </div>
            <span className='text-14px text-foreground font-500'>{tenantName || '--'}</span>
          </div>

          {/* Connection Status */}
          <div className='flex items-center justify-between py-2'>
            <div className='flex items-center gap-2'>
              {connectionStatus === 'connected' ? <CheckCircle size={16} className='text-success' /> : connectionStatus === 'checking' ? <Spin size={16} /> : <XCircle size={16} className='text-danger' />}
              <span className='text-14px text-secondary'>{t('settings.enterpriseConnection.status')}</span>
            </div>
            <span className={`text-14px font-500 ${connectionStatus === 'connected' ? 'text-success' : connectionStatus === 'disconnected' ? 'text-danger' : 'text-3'}`}>{t(`settings.enterpriseConnection.${connectionStatus}`)}</span>
          </div>

          {/* Server URL (editable) */}
          <div className='flex flex-col gap-2 pt-2'>
            <span className='text-14px text-secondary'>{t('settings.enterpriseConnection.serverUrl')}</span>
            <div className='flex gap-2'>
              <Input
                aria-label={t('settings.enterpriseConnection.serverUrl')}
                value={editingServerUrl}
                onChange={(value) => {
                  setEditingServerUrl(value);
                  setDraftError('');
                }}
                placeholder='https://your-company-server.com'
                className='flex-1 h-8'
                disabled={isSaving || connectionStatus === 'checking'}
              />
              <Button type='primary' size='small' loading={isSaving} onClick={() => void onSaveServerUrl()} disabled={isUnchanged || !editingServerUrl.trim() || connectionStatus === 'checking'}>
                {t('common.save')}
              </Button>
              <Button size='small' onClick={() => void onRecheck()} disabled={isSaving || connectionStatus === 'checking' || !serverUrl}>
                {t('settings.enterpriseConnection.recheck')}
              </Button>
            </div>
            {draftError && (
              <div role='alert' className='text-danger text-12px'>
                {draftError}
              </div>
            )}
          </div>
        </div>
      </div>
    </PageWrapper>
  );
}

export default EnterpriseSettings;
