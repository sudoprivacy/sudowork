import { Button, Dropdown, Menu, Switch, Tooltip } from '@arco-design/web-react';
import { Check, CloseOne, CloseSmall, LoadingOne, Refresh, Write, DeleteFour, SettingOne, Login } from '@icon-park/react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { IMcpServer } from '@/common/storage';
import type { IMcpOAuthStatus } from '../types';
import McpAgentStatusDisplay from './McpAgentStatusDisplay';

interface McpServerHeaderProps {
  server: IMcpServer;
  agentInstallStatus: Record<string, string[]>;
  isServerLoading: (serverName: string) => boolean;
  isTestingConnection: boolean;
  oauthStatus?: IMcpOAuthStatus;
  isLoggingIn?: boolean;
  /** Extension-contributed servers are read-only */
  isReadOnly?: boolean;
  onTestConnection: (server: IMcpServer) => void;
  onEditServer: (server: IMcpServer) => void;
  onDeleteServer: (serverId: string) => void;
  onToggleServer: (serverId: string, enabled: boolean) => void;
  onOAuthLogin?: (server: IMcpServer) => void;
}

const getStatusIcon = (status?: IMcpServer['status'], oauthStatus?: IMcpOAuthStatus) => {
  if (status === 'testing' || oauthStatus?.isChecking) {
    return <LoadingOne fill={'var(--foreground)'} />;
  }

  if (status === 'error') {
    return <CloseSmall fill={'var(--danger)'} />;
  }

  if (oauthStatus?.needsLogin) {
    return <span className='text-warning text-xl font-bold leading-none'>△</span>;
  }

  if (status === 'connected' || oauthStatus?.isAuthenticated) {
    return <Check fill={'var(--success)'} className='items-center' />;
  }

  return <CloseOne fill={'var(--text-secondary)'} />;
};

const getStatusText = (status?: IMcpServer['status'], oauthStatus?: IMcpOAuthStatus, t?: any) => {
  // 优先级1: 测试中状态
  if (status === 'testing' || oauthStatus?.isChecking) {
    return t?.('settings.mcpTesting') || 'testing';
  }

  // 优先级2: 错误状态
  if (status === 'error') {
    return t?.('settings.mcpError') || 'error';
  }

  // 优先级3: OAuth 需要登录
  if (oauthStatus?.needsLogin) {
    return t?.('settings.mcpNeedsLogin') || 'disconnected · Enter to login';
  }

  // 优先级4: 连接成功或已认证
  if (status === 'connected' || oauthStatus?.isAuthenticated) {
    return t?.('settings.mcpConnected') || 'connected';
  }

  // 默认: 未连接
  return t?.('settings.mcpDisconnected') || 'disconnected';
};

const McpServerHeader: React.FC<McpServerHeaderProps> = ({ server, agentInstallStatus, isServerLoading, isTestingConnection, oauthStatus, isLoggingIn, isReadOnly, onTestConnection, onEditServer, onDeleteServer, onToggleServer, onOAuthLogin }) => {
  const { t } = useTranslation();

  // 判断是否支持 OAuth（仅 HTTP/SSE）
  const supportsOAuth = server.transport.type === 'http' || server.transport.type === 'sse';
  const needsLogin = supportsOAuth && oauthStatus?.needsLogin;
  const statusText = getStatusText(server.status, oauthStatus, t);
  const statusIcon = getStatusIcon(server.status, oauthStatus);

  return (
    <div className='flex items-center justify-between group'>
      <div className='flex items-center gap-4'>
        <span>{server.name}</span>
        <Tooltip content={statusText} position='top'>
          <span className='flex items-center cursor-default'>{statusIcon}</span>
        </Tooltip>
        {isReadOnly && <McpAgentStatusDisplay serverName={server.name} agentInstallStatus={agentInstallStatus} isLoadingAgentStatus={isServerLoading(server.name)} alwaysVisible />}
        {!isReadOnly && needsLogin && onOAuthLogin && (
          <Button size='mini' type='primary' icon={<Login size={'14'} />} title={t('settings.mcpLogin') || 'Login'} loading={isLoggingIn} onClick={() => onOAuthLogin(server)}>
            {t('settings.mcpLogin') || 'Login'}
          </Button>
        )}
        {!isReadOnly && !needsLogin && <Button size='mini' icon={<Refresh size={'14'} />} title={t('settings.mcpTestConnection')} loading={isTestingConnection} onClick={() => onTestConnection(server)} />}
      </div>
      {!isReadOnly && (
        <div className='flex items-center gap-2' onClick={(e) => e.stopPropagation()}>
          <div className='flex items-center gap-2 invisible group-hover:visible'>
            <Dropdown
              trigger='hover'
              droplist={
                <Menu>
                  <Menu.Item key='edit' onClick={() => onEditServer(server)}>
                    <div className='flex items-center gap-2'>
                      <Write size={'14'} />
                      {t('settings.mcpEditServer')}
                    </div>
                  </Menu.Item>
                  <Menu.Item key='delete' onClick={() => onDeleteServer(server.id)}>
                    <div className='flex items-center gap-2 text-danger'>
                      <DeleteFour size={'14'} />
                      {t('settings.mcpDeleteServer')}
                    </div>
                  </Menu.Item>
                </Menu>
              }
            >
              <Button size='mini' icon={<SettingOne size={'14'} />} />
            </Dropdown>
          </div>
          <Switch checked={server.enabled} onChange={(checked) => onToggleServer(server.id, checked)} disabled={server.status === 'testing'} className='settings-accent-switch' style={server.enabled ? { backgroundColor: 'var(--ui-accent-orange)' } : undefined} />
        </div>
      )}
    </div>
  );
};

export default McpServerHeader;
