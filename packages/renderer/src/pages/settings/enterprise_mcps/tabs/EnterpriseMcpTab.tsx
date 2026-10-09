/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { Switch, Message, Tooltip } from '@arco-design/web-react';
import EmptyState from '@renderer/components/base/EmptyState';
import McpIcon from '../components/McpIcon';
import ScopeBadge from '../components/ScopeBadge';
import RiskLevelTag from '../components/RiskLevelTag';
import type { EnterpriseMcpServerDto } from '../types';

interface EnterpriseMcpTabProps {
  servers: EnterpriseMcpServerDto[];
  loading?: boolean;
  onToggleUserDisabled?: (server: EnterpriseMcpServerDto, enabled: boolean) => Promise<void> | void;
}

/**
 * Tab1 — 企业 MCP：列出 scope=org/department 的实例。
 * allow_user_disable=false 的 MCP 排在最上面，不显示开关；
 * allow_user_disable=true 的 MCP 显示开关，基于 user_disabled 字段驱动状态。
 */
const EnterpriseMcpTab: React.FC<EnterpriseMcpTabProps> = ({ servers, loading = false, onToggleUserDisabled }) => {
  const filtered = useMemo(() => {
    const orgDept = servers.filter((s) => s.scope === 'org' || s.scope === 'department');
    // allow_user_disable=false 排最上面，同组保持原始顺序
    return orgDept.sort((a, b) => {
      if (a.allow_user_disable === b.allow_user_disable) return 0;
      return a.allow_user_disable ? 1 : -1;
    });
  }, [servers]);

  if (!loading && filtered.length === 0) {
    return <EmptyState illustrationType='default' title='暂无企业 MCP' description='管理员尚未发布任何企业级或部门级 MCP 实例。' simple />;
  }

  const handleToggle = async (srv: EnterpriseMcpServerDto, enabled: boolean) => {
    if (onToggleUserDisabled) {
      try {
        await onToggleUserDisabled(srv, enabled);
      } catch (err) {
        Message.error(err instanceof Error ? err.message : '操作失败');
      }
    }
  };

  return (
    <div className='flex flex-col gap-2.5'>
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
          <div className='shrink-0'>
            <ScopeBadge scope={srv.scope} />
          </div>
          <div className='shrink-0 w-11 flex justify-end'>
            {srv.allow_user_disable ? (
              <Switch checked={!srv.user_disabled} onChange={(v: boolean) => void handleToggle(srv, v)} size='small' />
            ) : (
              <Tooltip content='管理员已锁定该 MCP，不允许员工自行启停'>
                <Switch checked={!srv.user_disabled} size='small' disabled />
              </Tooltip>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default EnterpriseMcpTab;
