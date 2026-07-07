/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { Button, Input, Message, Spin } from '@arco-design/web-react';
import { Building2, CheckCircle, XCircle } from 'lucide-react';
import { ConfigStorage } from '@/common/storage';
import { ipcBridge } from '@/common';
import { TENANT_CONFIG_STORAGE_KEY, resolveTenantConfig } from '@/common/types/tenantConfig';
import { useAuth } from '@/renderer/context/AuthContext';
import PageWrapper from '@renderer/components/base/PageWrapper';

const EnterpriseSettings: React.FC = () => {
  const { logout } = useAuth();
  const [tenantName, setTenantName] = useState<string>('');
  const [serverUrl, setServerUrl] = useState<string>('');
  const [editingServerUrl, setEditingServerUrl] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadConfig = async () => {
      try {
        const [name, url] = await Promise.all([ConfigStorage.get('eeclaw.tenantName'), ConfigStorage.get('eeclaw.serverUrl')]);
        setTenantName(name || '');
        setServerUrl(url || '');
        setEditingServerUrl(url || '');
        // If we have a serverUrl, consider it connected
        setConnectionStatus(url ? 'connected' : 'disconnected');
      } catch (error) {
        console.error('[EnterpriseSettings] Failed to load config:', error);
        setConnectionStatus('disconnected');
      } finally {
        setLoading(false);
      }
    };
    void loadConfig();
  }, []);

  const handleSaveServerUrl = async () => {
    if (!editingServerUrl.trim()) {
      Message.error('服务器地址不能为空');
      return;
    }

    const normalizedUrl = editingServerUrl.trim().replace(/\/+$/, '');
    setSaving(true);
    setConnectionStatus('checking');

    try {
      // Step 1: Verify and get new tenantName from server via IPC bridge
      const result = await ipcBridge.eeclaw.verifyServer.invoke({ serverUrl: normalizedUrl });

      if (!result.success || !result.data) {
        Message.error('服务器响应异常，请检查地址是否正确');
        setConnectionStatus('disconnected');
        return;
      }

      const tenantConfig = resolveTenantConfig(result.data);

      // Step 2: Update ConfigStorage
      await ConfigStorage.set('eeclaw.serverUrl', normalizedUrl);
      await ConfigStorage.set('eeclaw.tenantName', tenantConfig.app_company_name);
      localStorage.setItem(TENANT_CONFIG_STORAGE_KEY, JSON.stringify(tenantConfig));
      setServerUrl(normalizedUrl);
      setTenantName(tenantConfig.app_company_name);
      setEditingServerUrl(normalizedUrl);

      // Step 3: Clear auth data (SECURITY-2)
      localStorage.removeItem('eeclaw_auth_v1');
      await ConfigStorage.set('eeclaw.authStorage', undefined);

      // Step 4: Logout
      await logout();

      setConnectionStatus('connected');
      Message.success('服务器地址已更新，请重新登录');
    } catch (error) {
      console.error('[EnterpriseSettings] Failed to save server URL:', error);
      Message.error('无法连接到服务器，请检查地址是否正确');
      setConnectionStatus('disconnected');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
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
          <h3 className='text-16px font-600 text-foreground m-0'>企业连接信息</h3>
        </div>

        <div className='flex flex-col gap-4'>
          {/* Tenant Name (read-only) */}
          <div className='flex items-center justify-between py-2'>
            <div className='flex items-center gap-2'>
              <Building2 size={16} className='text-secondary' />
              <span className='text-14px text-secondary'>企业名称</span>
            </div>
            <span className='text-14px text-foreground font-500'>{tenantName || '--'}</span>
          </div>

          {/* Connection Status */}
          <div className='flex items-center justify-between py-2'>
            <div className='flex items-center gap-2'>
              {connectionStatus === 'connected' ? <CheckCircle size={16} className='text-success' /> : connectionStatus === 'checking' ? <Spin size={16} /> : <XCircle size={16} className='text-danger' />}
              <span className='text-14px text-secondary'>连接状态</span>
            </div>
            <span className={`text-14px font-500 ${connectionStatus === 'connected' ? 'text-success' : connectionStatus === 'disconnected' ? 'text-danger' : 'text-3'}`}>{connectionStatus === 'connected' ? '已连接' : connectionStatus === 'checking' ? '检查中...' : '未连接'}</span>
          </div>

          {/* Server URL (editable) */}
          <div className='flex flex-col gap-2 pt-2'>
            <span className='text-14px text-secondary'>服务器地址</span>
            <div className='flex gap-2'>
              <Input value={editingServerUrl} onChange={setEditingServerUrl} placeholder='https://your-company-server.com' className='flex-1 h-8' disabled={saving} />
              <Button type='primary' size='small' loading={saving} onClick={() => void handleSaveServerUrl()} disabled={editingServerUrl.trim() === serverUrl.trim() || !editingServerUrl.trim()}>
                保存
              </Button>
            </div>
          </div>
        </div>
      </div>
    </PageWrapper>
  );
};

export default EnterpriseSettings;
