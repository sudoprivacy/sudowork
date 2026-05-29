import React, { useMemo, useState } from 'react';
import { Switch, Button, Popconfirm, Message } from '@arco-design/web-react';
import { Edit, Delete } from '@icon-park/react';
import EmptyState from '@/renderer/components/base/EmptyState';
import McpIcon from '../components/McpIcon';
import RiskLevelTag from '../components/RiskLevelTag';
import EditConfigModal from '../components/EditConfigModal';
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
}

const MyMcpTab: React.FC<MyMcpTabProps> = ({ servers, loading = false, onToggleEnabled, onDelete, loadUserConfig, saveUserConfig, serverHasUserConfig }) => {
  const filtered = useMemo(() => servers.filter((s) => s.scope === 'user'), [servers]);
  const [editing, setEditing] = useState<EnterpriseMcpServerDto | null>(null);

  if (!loading && filtered.length === 0) {
    return <EmptyState illustrationType='default' title='暂无个人 MCP' description='前往「MCP 库」浏览并安装。' simple />;
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
    <div className='flex flex-col gap-10px'>
      {filtered.map((srv) => (
        <div key={srv.id} className='flex items-center gap-12px px-16px py-12px rd-12px bg-1 hover:bg-2 transition-colors'>
          <McpIcon icon={srv.icon} size={40} />
          <div className='flex-1 min-w-0'>
            <div className='flex items-center gap-8px'>
              <span className='text-14px font-500 text-t-primary truncate'>{srv.display_name || srv.name}</span>
              <RiskLevelTag level={srv.risk_level} />
            </div>
            {srv.description && <div className='text-12px text-t-tertiary mt-2px truncate'>{srv.description}</div>}
          </div>
          <div className='shrink-0 flex items-center gap-4px'>
            {serverHasUserConfig?.get(srv.id) && (
              <Button type='text' size='mini' icon={<Edit theme='outline' size='14' />} onClick={() => setEditing(srv)}>
                修改配置
              </Button>
            )}
            <Switch checked={srv.enabled} onChange={(v) => void handleToggle(srv, v)} size='small' />
            <Popconfirm title='确认删除该 MCP？' content='此操作不可撤销，已写入的配置将被一并清除。' onOk={() => void handleDelete(srv)} okText='删除' cancelText='取消' okButtonProps={{ status: 'danger' }}>
              <Button type='text' size='mini' status='danger' icon={<Delete theme='outline' size='14' />} />
            </Popconfirm>
          </div>
        </div>
      ))}

      <EditConfigModal visible={editing !== null} server={editing} loadConfig={loadUserConfig} saveConfig={saveUserConfig} onCancel={() => setEditing(null)} />
    </div>
  );
};

export default MyMcpTab;
