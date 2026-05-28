import React, { useMemo } from 'react';
import { Switch, Message, Tooltip } from '@arco-design/web-react';
import EmptyState from '@/renderer/components/base/EmptyState';
import McpIcon from '../components/McpIcon';
import ScopeBadge from '../components/ScopeBadge';
import RiskLevelTag from '../components/RiskLevelTag';
import type { EnterpriseMcpServerDto } from '../types';

interface EnterpriseMcpTabProps {
  servers: EnterpriseMcpServerDto[];
  loading?: boolean;
}

/**
 * Tab1 — 企业 MCP：列出 scope=org/department 的实例。
 * 已知缺口 §8.2：员工对企业 MCP 的启停 API 不存在。Switch 暂作 UI 占位，
 * 点击会弹 toast 提示，不发请求。Phase B 接 PATCH 后预期 403 → toast。
 */
const EnterpriseMcpTab: React.FC<EnterpriseMcpTabProps> = ({ servers, loading = false }) => {
  const filtered = useMemo(() => servers.filter((s) => s.scope === 'org' || s.scope === 'department'), [servers]);

  if (!loading && filtered.length === 0) {
    return <EmptyState illustrationType='default' title='暂无企业 MCP' description='管理员尚未发布任何企业级或部门级 MCP 实例。' simple />;
  }

  const handleToggle = () => {
    // §8.2: backend gap — UI only.
    Message.info('该 MCP 暂不支持自助开关，请联系管理员');
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
          <div className='shrink-0'>
            <ScopeBadge scope={srv.scope} />
          </div>
          <div className='shrink-0 w-44px flex justify-end'>
            <Tooltip content='当前版本暂不支持员工自助启停企业 MCP'>
              <Switch checked={srv.enabled} onChange={handleToggle} size='small' />
            </Tooltip>
          </div>
        </div>
      ))}
    </div>
  );
};

export default EnterpriseMcpTab;
