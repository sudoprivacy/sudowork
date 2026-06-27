import { Card, Tooltip } from '@arco-design/web-react';
import React from 'react';

export default function StatusCard({ title, value, icon, status = 'info', description }: IStatusCardProps) {
  const statusColors = {
    success: { bg: '#52c41a15', text: '#52c41a' },
    warning: { bg: '#faad1415', text: '#faad14' },
    error: { bg: '#ff4d4f15', text: '#ff4d4f' },
    info: { bg: `${'var(--foreground)'}15`, text: 'var(--foreground)' },
  };

  const colors = statusColors[status];

  return (
    <Card className='rd-12px hover:shadow-md transition-shadow'>
      <div className='flex items-start gap-12px'>
        <div className='w-48px h-48px rounded-12px f-center flex-shrink-0' style={{ backgroundColor: colors.bg }}>
          {icon}
        </div>
        <div className='flex-1 min-w-0'>
          <div className='text-13px text-secondary mb-4px'>{title}</div>
          <div className='text-20px font-600 text-foreground truncate' title={String(value)}>
            {value}
          </div>
          {description && (
            <Tooltip content={description}>
              <div className='text-12px text-tertiary mt-4px truncate'>{description}</div>
            </Tooltip>
          )}
        </div>
      </div>
    </Card>
  );
}

interface IStatusCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  status?: 'success' | 'warning' | 'error' | 'info';
  description?: string;
}
