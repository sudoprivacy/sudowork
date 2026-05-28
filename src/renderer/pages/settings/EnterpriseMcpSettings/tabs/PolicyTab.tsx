import React, { useMemo } from 'react';
import { Tag } from '@arco-design/web-react';
import EmptyState from '@/renderer/components/base/EmptyState';
import type { EnterpriseMcpPolicyDto } from '../types';

interface PolicyTabProps {
  policy: EnterpriseMcpPolicyDto | null;
  loading?: boolean;
}

interface PolicyRow {
  key: string;
  label: string;
  description: string;
  renderValue: (v: unknown) => React.ReactNode;
}

const BooleanValue: React.FC<{ value: unknown; positiveLabel?: string; negativeLabel?: string }> = ({ value, positiveLabel = '允许', negativeLabel = '禁止' }) => {
  if (typeof value !== 'boolean') {
    return <span className='text-t-tertiary'>未配置</span>;
  }
  return value ? (
    <Tag size='small' color='green'>
      {positiveLabel}
    </Tag>
  ) : (
    <Tag size='small' color='red'>
      {negativeLabel}
    </Tag>
  );
};

const KNOWN_ROWS: PolicyRow[] = [
  {
    key: 'allow_personal_mcp',
    label: '允许个人 MCP',
    description: '关闭后，员工无法从模板市场安装任何个人 MCP。',
    renderValue: (v) => <BooleanValue value={v} />,
  },
  {
    key: 'allow_stdio_mcp',
    label: '允许 STDIO 类型',
    description: '是否允许本地 stdio 类型的 MCP 服务。',
    renderValue: (v) => <BooleanValue value={v} />,
  },
  {
    key: 'allow_http_sse_mcp',
    label: '允许 HTTP / SSE 类型',
    description: '是否允许远程 HTTP 或 SSE 类型的 MCP 服务。',
    renderValue: (v) => <BooleanValue value={v} />,
  },
];

const fallbackRender = (v: unknown): React.ReactNode => {
  if (typeof v === 'boolean') return <BooleanValue value={v} />;
  if (v === null || v === undefined) return <span className='text-t-tertiary'>—</span>;
  if (typeof v === 'string' || typeof v === 'number') return <span className='text-t-primary'>{String(v)}</span>;
  try {
    return <span className='font-mono text-12px text-t-secondary'>{JSON.stringify(v)}</span>;
  } catch {
    return <span className='text-t-tertiary'>[Object]</span>;
  }
};

const PolicyTab: React.FC<PolicyTabProps> = ({ policy, loading = false }) => {
  const extraRows = useMemo(() => {
    if (!policy) return [];
    const known = new Set(KNOWN_ROWS.map((r) => r.key));
    return Object.entries(policy).filter(([k]) => !known.has(k));
  }, [policy]);

  if (!loading && !policy) {
    return <EmptyState illustrationType='default' title='暂无策略信息' description='企业管理员未配置任何 MCP 策略。' simple />;
  }

  return (
    <div className='flex flex-col gap-2px rd-12px bg-1 overflow-hidden'>
      {KNOWN_ROWS.map((row) => (
        <div key={row.key} className='flex items-center justify-between gap-16px px-16px py-14px border-b border-b-[var(--color-border-1)] last:border-b-0'>
          <div className='flex-1 min-w-0'>
            <div className='text-14px font-500 text-t-primary'>{row.label}</div>
            <div className='text-12px text-t-tertiary mt-2px'>{row.description}</div>
          </div>
          <div className='shrink-0'>{row.renderValue(policy?.[row.key])}</div>
        </div>
      ))}

      {extraRows.map(([key, value]) => (
        <div key={key} className='flex items-center justify-between gap-16px px-16px py-14px border-b border-b-[var(--color-border-1)] last:border-b-0'>
          <div className='flex-1 min-w-0'>
            <div className='text-14px font-500 text-t-primary'>{key}</div>
            <div className='text-12px text-t-tertiary mt-2px'>企业自定义策略字段</div>
          </div>
          <div className='shrink-0'>{fallbackRender(value)}</div>
        </div>
      ))}
    </div>
  );
};

export default PolicyTab;
