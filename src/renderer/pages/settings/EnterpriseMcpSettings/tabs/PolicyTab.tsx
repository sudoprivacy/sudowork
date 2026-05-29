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
    label: '允许用户创建个人 MCP',
    description: '开启后，用户可在客户端创建个人 MCP 服务',
    renderValue: (v) => <BooleanValue value={v} />,
  },
  {
    key: 'allow_stdio_mcp',
    label: '允许本地 STDIO MCP',
    description: '允许用户配置本地 STDIO 类型的 MCP',
    renderValue: (v) => <BooleanValue value={v} />,
  },
  {
    key: 'allow_http_sse_mcp',
    label: '允许远程 HTTP/SSE MCP',
    description: '允许用户配置远程 HTTP 或 SSE 类型的 MCP',
    renderValue: (v) => <BooleanValue value={v} />,
  },
  {
    key: 'allow_local_file_access',
    label: '允许访问本地文件',
    description: '允许个人 MCP 访问用户本地文件系统',
    renderValue: (v) => <BooleanValue value={v} />,
  },
  {
    key: 'allow_external_network',
    label: '允许访问外网域名',
    description: '允许个人 MCP 访问外部网络域名',
    renderValue: (v) => <BooleanValue value={v} />,
  },
  {
    key: 'domain_whitelist_json',
    label: '外网域名白名单',
    description: '当允许访问外网时，限制可访问的域名列表',
    renderValue: (v) => fallbackRender(v),
  },
  {
    key: 'require_approval',
    label: '需要管理员审批',
    description: '用户创建的个人 MCP 需要管理员审批后才能使用',
    renderValue: (v) => <BooleanValue value={v} />,
  },
  {
    key: 'allow_auto_task_call_personal_mcp',
    label: '允许自动任务调用个人 MCP',
    description: '允许自动任务（如定时任务）调用用户的个人 MCP',
    renderValue: (v) => <BooleanValue value={v} />,
  },
  {
    key: 'allow_enterprise_assistant_call_personal_mcp',
    label: '允许企业助手调用个人 MCP',
    description: '允许企业级助手调用用户的个人 MCP',
    renderValue: (v) => <BooleanValue value={v} />,
  },
  {
    key: 'allow_enterprise_context_in_personal_mcp',
    label: '允许携带企业上下文调用',
    description: '允许在调用个人 MCP 时携带企业上下文信息',
    renderValue: (v) => <BooleanValue value={v} />,
  },
  {
    key: 'require_confirmation_for_high_risk',
    label: '高风险工具需用户确认',
    description: '高风险级别的工具调用前需要用户确认',
    renderValue: (v) => <BooleanValue value={v} />,
  },
  {
    key: 'require_confirmation_for_write',
    label: '写操作需二次确认',
    description: '执行写操作的 MCP 工具需要二次确认',
    renderValue: (v) => <BooleanValue value={v} />,
  },
  {
    key: 'audit_request_params',
    label: '记录调用参数',
    description: '记录 MCP 工具调用的请求参数',
    renderValue: (v) => <BooleanValue value={v} />,
  },
  {
    key: 'audit_response_summary',
    label: '记录响应摘要',
    description: '记录 MCP 工具调用的响应摘要',
    renderValue: (v) => <BooleanValue value={v} />,
  },
  {
    key: 'redact_audit_logs',
    label: '脱敏日志',
    description: '对审计日志中的敏感信息进行脱敏处理',
    renderValue: (v) => <BooleanValue value={v} />,
  },
  {
    key: 'limit_concurrency_and_rate',
    label: '限制并发和频率',
    description: '限制 MCP 工具调用的并发数和调用频率',
    renderValue: (v) => <BooleanValue value={v} />,
  },
  {
    key: 'restrict_callable_models',
    label: '限制可调用模型/助手',
    description: '限制哪些模型和助手可以调用 MCP 工具',
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
