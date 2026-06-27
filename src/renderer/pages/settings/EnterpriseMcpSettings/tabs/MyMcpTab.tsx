import React, { useMemo, useState } from 'react';
import { Switch, Button, Popconfirm, Message } from '@arco-design/web-react';
import { IconEdit, IconDelete } from '@arco-design/web-react/icon';
import { useTranslation } from 'react-i18next';
import EmptyState from '@/renderer/components/base/EmptyState';
import McpIcon from '../components/McpIcon';
import RiskLevelTag from '../components/RiskLevelTag';
import EditConfigModal from '../components/EditConfigModal';
import InstallJsonModal from '../components/InstallJsonModal';
import type { EnterpriseMcpServerDto, EnterpriseMcpUserConfigItem } from '../types';

interface MyMcpTabProps {
  servers: EnterpriseMcpServerDto[];
  loading?: boolean;
  onToggleEnabled?: (server: EnterpriseMcpServerDto, enabled: boolean) => Promise<void> | void;
  onDelete?: (server: EnterpriseMcpServerDto) => Promise<void> | void;
  /** Phase B 注入：用 servers.getUserConfig 读取 schema+values */
  loadUserConfig?: (serverId: string) => Promise<{ schema: EnterpriseMcpUserConfigItem[]; values: Record<string, string> }>;
  /** Phase B 注入：批量 PUT 保存用户配置 */
  saveUserConfig?: (serverId: string, config_values: Record<string, string>) => Promise<void>;
  /** 由父组件根据 server↔template 匹配派生：true 才显示"修改配置"按钮（未匹配到模板的 server 缺省按 false 处理） */
  serverHasUserConfig?: Map<string, boolean>;
  /** 企业策略是否允许安装个人 MCP */
  allowInstall?: boolean;
  /** 安装成功后的刷新回调 */
  onInstalled?: () => void;
}

const MyMcpTab: React.FC<MyMcpTabProps> = ({ servers, loading = false, onToggleEnabled, onDelete, loadUserConfig, saveUserConfig, serverHasUserConfig, allowInstall, onInstalled }) => {
  const { t } = useTranslation();
  const filtered = useMemo(() => servers.filter((s) => s.scope === 'user'), [servers]);
  const [editing, setEditing] = useState<EnterpriseMcpServerDto | null>(null);
  const [installVisible, setInstallVisible] = useState(false);

  if (!loading && filtered.length === 0) {
    return (
      <>
        {allowInstall && (
          <div className='mb-2'>
            <Button type='primary' size='small' onClick={() => setInstallVisible(true)}>
              {t('settings.mcpInstallJsonButton', { defaultValue: '安装 MCP' })}
            </Button>
          </div>
        )}
        <EmptyState illustrationType='default' title='暂无个人 MCP' description='前往「MCP 库」浏览并安装，或点击上方按钮通过 JSON 安装。' simple />
        <InstallJsonModal
          visible={installVisible}
          onCancel={() => setInstallVisible(false)}
          onSuccess={() => {
            setInstallVisible(false);
            onInstalled?.();
          }}
        />
      </>
    );
  }

  const handleToggle = async (srv: EnterpriseMcpServerDto, enabled: boolean) => {
    if (onToggleEnabled) {
      try {
        await onToggleEnabled(srv, enabled);
      } catch (err) {
        Message.error(err instanceof Error ? err.message : '操作失败');
      }
    } else {
      Message.info(`原型：${enabled ? '启用' : '禁用'}「${srv.display_name || srv.name}」`);
    }
  };

  const handleDelete = async (srv: EnterpriseMcpServerDto) => {
    if (onDelete) {
      try {
        await onDelete(srv);
        Message.success('已删除');
      } catch (err) {
        Message.error(err instanceof Error ? err.message : '删除失败');
      }
    } else {
      Message.info(`原型：已模拟删除「${srv.display_name || srv.name}」`);
    }
  };

  return (
    <div className='flex flex-col gap-2.5'>
      {allowInstall && (
        <div>
          <Button type='primary' size='small' onClick={() => setInstallVisible(true)}>
            {t('settings.mcpInstallJsonButton', { defaultValue: '安装 MCP' })}
          </Button>
        </div>
      )}
      {filtered.map((srv) => (
        <div key={srv.id} className='flex items-center gap-3 px-4 py-3 rd-12px bg-1 hover:bg-muted transition-colors'>
          <McpIcon icon={srv.icon} size={40} />
          <div className='flex-1 min-w-0'>
            <div className='flex items-center gap-2'>
              <span className='text-14px font-500 text-foreground truncate'>{srv.display_name || srv.name}</span>
              <RiskLevelTag level={srv.risk_level} />
            </div>
            {srv.description && <div className='text-12px text-tertiary mt-0.5 truncate'>{srv.description}</div>}
          </div>
          <div className='shrink-0 flex items-center gap-1'>
            {serverHasUserConfig?.get(srv.id) && (
              <Button type='text' size='mini' icon={<IconEdit />} onClick={() => setEditing(srv)}>
                修改配置
              </Button>
            )}
            <Switch checked={!srv.user_disabled} onChange={(v) => void handleToggle(srv, v)} size='small' />
            <Popconfirm title='确认删除该 MCP？' content='此操作不可撤销，已写入的配置将被一并清除。' onOk={() => void handleDelete(srv)} okText='删除' cancelText='取消' okButtonProps={{ status: 'danger' }}>
              <Button type='text' size='mini' status='danger' icon={<IconDelete />} />
            </Popconfirm>
          </div>
        </div>
      ))}

      <EditConfigModal visible={editing !== null} server={editing} loadConfig={loadUserConfig} saveConfig={saveUserConfig} onCancel={() => setEditing(null)} />
      <InstallJsonModal
        visible={installVisible}
        onCancel={() => setInstallVisible(false)}
        onSuccess={() => {
          setInstallVisible(false);
          onInstalled?.();
        }}
      />
    </div>
  );
};

export default MyMcpTab;
