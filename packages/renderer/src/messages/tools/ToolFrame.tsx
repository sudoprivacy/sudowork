import { Card, Tag } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { normalizeToolState } from './toolPresentation';

export function ToolBadge({ tone, children }: IToolBadgeProps) {
  return <Tag style={{ color: tone ? `var(--${tone})` : 'var(--text-secondary)', background: tone ? `var(--${tone}-soft)` : 'var(--bg-muted)', border: `1px solid ${tone ? `var(--${tone}-line)` : 'var(--border-default)'}` }}>{children}</Tag>;
}

export function ToolStatusTag({ status }: IToolStatusTagProps) {
  const { t } = useTranslation();
  const state = normalizeToolState(status);
  const tone = state === 'success' ? 'success' : state === 'error' ? 'danger' : state === 'running' ? 'warning' : state === 'pending' ? 'info' : undefined;
  const label = state === 'running' ? 'executing' : state;
  return <ToolBadge tone={tone}>{state === 'unknown' ? status : t(`tools.status.${label}`)}</ToolBadge>;
}

/** Shared full tool card; compact transcript rows reuse its status and content primitives. */
export default function ToolFrame({ toolCallId, title, status, description, icon, additionalTags, children }: IToolFrameProps) {
  const { t } = useTranslation();
  return (
    <Card className='w-full mb-2' size='small' bordered>
      <div className='min-w-0'>
        <div className='flex flex-wrap items-center gap-2 mb-2'>
          {icon && <span aria-hidden='true'>{icon}</span>}
          <span className='font-medium text-foreground min-w-0 break-words'>{title}</span>
          <ToolStatusTag status={status} />
          {additionalTags}
        </div>
        {description && <div className='text-sm text-secondary mb-2 overflow-hidden'>{description}</div>}
        {children}
        <div className='text-xs text-secondary mt-2 break-all'>
          {t('tools.labels.tool')} · {toolCallId}
        </div>
      </div>
    </Card>
  );
}

interface IToolStatusTagProps {
  status: string;
}
interface IToolBadgeProps {
  tone?: 'success' | 'danger' | 'warning' | 'info';
  children: React.ReactNode;
}
interface IToolFrameProps {
  toolCallId: string;
  title: string;
  status: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  additionalTags?: React.ReactNode;
  children?: React.ReactNode;
}
