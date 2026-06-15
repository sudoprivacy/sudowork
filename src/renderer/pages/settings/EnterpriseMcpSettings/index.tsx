import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Tabs, Message, Spin } from '@arco-design/web-react';
import SettingsPageWrapper from '../components/SettingsPageWrapper';
import { ConfigStorage } from '@/common/storage';
import EnterpriseMcpTab from './tabs/EnterpriseMcpTab';
import McpLibraryTab from './tabs/McpLibraryTab';
import MyMcpTab from './tabs/MyMcpTab';
import PolicyTab from './tabs/PolicyTab';
import AdminRedirectBanner from './components/AdminRedirectBanner';
import { useEnterpriseMcpClient } from './hooks/useEnterpriseMcpClient';
import { useMcpServers } from './hooks/useMcpServers';
import { useMcpTemplates } from './hooks/useMcpTemplates';
import { useMcpPolicy } from './hooks/useMcpPolicy';
import { useMcpEventsSubscription } from './hooks/useMcpEventsSubscription';
import { normalizeInstallError, describeMcpError } from './utils/normalizeError';
import type { EnterpriseMcpServerDto, EnterpriseMcpTemplateDto } from './types';

const EnterpriseMcpSettings: React.FC = () => {
  const [activeKey, setActiveKey] = useState<string>('enterprise');
  const [isAdmin, setIsAdmin] = useState(false);
  const [serverUrl, setServerUrl] = useState<string | null>(null);

  // Real data hooks
  const { servers, isLoading: serversLoading, error: serversError, mutate: mutateServers } = useMcpServers();
  const { data: templatesPage, isLoading: templatesLoading, error: templatesError } = useMcpTemplates();
  const { policy, isLoading: policyLoading, error: policyError } = useMcpPolicy();
  const { servers: serversApi, templates: templatesApi } = useEnterpriseMcpClient();

  // Subscribe to SSE; auto-invalidates servers/templates/policy SWR keys
  useMcpEventsSubscription(true);

  // Admin detection from local cached enterprise user info
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const [info, url] = await Promise.all([ConfigStorage.get('eeclaw.userInfo'), ConfigStorage.get('eeclaw.serverUrl')]);
        if (!mounted) return;
        const role = (info as { role?: string } | null | undefined)?.role;
        setIsAdmin(role === 'admin');
        setServerUrl(typeof url === 'string' ? url : null);
      } catch {
        // silent
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const templates = templatesPage?.data ?? [];

  // Derive installed template IDs and user-config availability from server.template_id.
  // Only user-scope servers are considered — MCP library installs are always personal.
  const { installedTemplateIds, serverHasUserConfig } = useMemo<{
    installedTemplateIds: Set<string>;
    serverHasUserConfig: Map<string, boolean>;
  }>(() => {
    const ids = new Set<string>();
    const hasConfigMap = new Map<string, boolean>();
    if (servers.length === 0 || templates.length === 0) {
      return { installedTemplateIds: ids, serverHasUserConfig: hasConfigMap };
    }
    const tplMap = new Map(templates.map((t) => [t.id, t]));
    for (const s of servers) {
      if (s.scope !== 'user' || !s.template_id) continue;
      const tpl = tplMap.get(s.template_id);
      if (tpl) {
        ids.add(tpl.id);
        hasConfigMap.set(s.id, (tpl.user_config_items?.length ?? 0) > 0);
      }
    }
    return { installedTemplateIds: ids, serverHasUserConfig: hasConfigMap };
  }, [servers, templates]);

  // === Install callback ===
  const handleInstall = useCallback(
    async (tpl: EnterpriseMcpTemplateDto, payload: { config_values: Record<string, string>; display_name?: string }) => {
      try {
        await templatesApi.install(tpl.id, payload);
        Message.success(`已安装「${tpl.name}」`);
        await mutateServers();
      } catch (err) {
        const norm = normalizeInstallError(err);
        Message.error(norm.message);
        // throw to caller so the modal can keep open & highlight missing keys
        const richErr = new Error(norm.message) as Error & { missingKeys?: string[]; code?: string };
        richErr.code = norm.code;
        if (norm.missingKeys) richErr.missingKeys = norm.missingKeys;
        throw richErr;
      }
    },
    [templatesApi, mutateServers]
  );

  // === Toggle user-level enabled/disabled on MCP ===
  const handleToggleEnabled = useCallback(
    async (srv: EnterpriseMcpServerDto, enabled: boolean) => {
      try {
        if (enabled) {
          await serversApi.enable(srv.id);
        } else {
          await serversApi.disable(srv.id);
        }
        await mutateServers();
      } catch (err) {
        Message.error(describeMcpError(err));
        await mutateServers();
        throw err;
      }
    },
    [serversApi, mutateServers]
  );

  // === Delete personal MCP ===
  const handleDelete = useCallback(
    async (srv: EnterpriseMcpServerDto) => {
      try {
        await serversApi.remove(srv.id);
        await mutateServers();
      } catch (err) {
        Message.error(describeMcpError(err));
        throw err;
      }
    },
    [serversApi, mutateServers]
  );

  // === Load user config for EditConfigModal ===
  const loadUserConfig = useCallback((serverId: string) => serversApi.getUserConfig(serverId), [serversApi]);

  // === Save user config (batch PUT) for EditConfigModal ===
  const saveUserConfig = useCallback((serverId: string, config_values: Record<string, string>) => serversApi.updateUserConfig(serverId, config_values), [serversApi]);

  const renderTabContent = (key: string) => {
    if (key === 'enterprise') {
      if (serversLoading && servers.length === 0) {
        return <LoadingBlock />;
      }
      if (serversError) {
        return <ErrorBlock message={describeMcpError(serversError)} />;
      }
      return <EnterpriseMcpTab servers={servers} loading={serversLoading} onToggleUserDisabled={handleToggleEnabled} />;
    }
    if (key === 'library') {
      if (templatesLoading && templates.length === 0) {
        return <LoadingBlock />;
      }
      if (templatesError) {
        return <ErrorBlock message={describeMcpError(templatesError)} />;
      }
      return <McpLibraryTab templates={templates} installedTemplateIds={installedTemplateIds} loading={templatesLoading} onInstall={handleInstall} />;
    }
    if (key === 'mine') {
      if (serversLoading && servers.length === 0) {
        return <LoadingBlock />;
      }
      if (serversError) {
        return <ErrorBlock message={describeMcpError(serversError)} />;
      }
      return <MyMcpTab servers={servers} loading={serversLoading} onToggleEnabled={handleToggleEnabled} onDelete={handleDelete} loadUserConfig={loadUserConfig} saveUserConfig={saveUserConfig} serverHasUserConfig={serverHasUserConfig} allowInstall={policy?.allow_personal_mcp} onInstalled={() => void mutateServers()} />;
    }
    if (key === 'policy') {
      if (policyLoading && !policy) {
        return <LoadingBlock />;
      }
      if (policyError) {
        return <ErrorBlock message={describeMcpError(policyError)} />;
      }
      if (!policy) {
        return <ErrorBlock message='未能获取企业策略' />;
      }
      return <PolicyTab policy={policy} />;
    }
    return null;
  };

  return (
    <SettingsPageWrapper contentClassName='max-w-1200px'>
      <div className='p-6 flex flex-col gap-4'>
        <div className='flex flex-col gap-0.5'>
          <h2 className='text-24px font-600 text-foreground my-0'>MCP 服务</h2>
          <p className='text-13px text-secondary my-0'>管理企业、部门与个人 MCP 服务，安装模板，查看企业策略。</p>
        </div>

        <AdminRedirectBanner visible={isAdmin} serverUrl={serverUrl} />

        <Tabs activeTab={activeKey} onChange={setActiveKey} type='line'>
          <Tabs.TabPane key='enterprise' title='企业 MCP'>
            <div className='pt-3'>{renderTabContent('enterprise')}</div>
          </Tabs.TabPane>
          <Tabs.TabPane key='library' title='MCP 库'>
            <div className='pt-3'>{renderTabContent('library')}</div>
          </Tabs.TabPane>
          <Tabs.TabPane key='mine' title='我的 MCP'>
            <div className='pt-3'>{renderTabContent('mine')}</div>
          </Tabs.TabPane>
          <Tabs.TabPane key='policy' title='策略说明'>
            <div className='pt-3'>{renderTabContent('policy')}</div>
          </Tabs.TabPane>
        </Tabs>
      </div>
    </SettingsPageWrapper>
  );
};

const LoadingBlock: React.FC = () => (
  <div className='f-center py-15'>
    <Spin size={28} />
  </div>
);

const ErrorBlock: React.FC<{ message: string }> = ({ message }) => <div className='py-10 text-center text-13px text-tertiary'>{message}</div>;

export default EnterpriseMcpSettings;
