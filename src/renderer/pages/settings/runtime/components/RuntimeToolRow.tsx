import { Button } from '@arco-design/web-react';
import React from 'react';
import classNames from 'classnames';
import { ShareOne } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import type { ToolRow } from '../types';
import { badgeColors, getRuntimeActions, getStatusInfo, isInstalled } from '../utils';

export default function RuntimeToolRow({ record }: IRuntimeToolRowProps) {
  const { t } = useTranslation();

  const { dotColor, statusText } = getStatusInfo(record, t);
  const version = record.status?.version;
  const loading = record.loadState !== 'idle';
  const installed = isInstalled(record);
  const isShareOne = record.key === 'shareone';
  const isShareOneDisabled = isShareOne && statusText === t('settings.runtimeSettings.status.disabled', { defaultValue: '未启用' });
  const source = record.status?.source;
  const sourceLabel = source && source !== 'none' ? t(`settings.runtimeSettings.source.${source}`, { defaultValue: source }) : undefined;
  const actions = getRuntimeActions(record, t);

  return (
    <div className='py-14px first:pt-0 last:pb-0'>
      <div className='flex flex-col gap-12px md:flex-row md:items-center md:justify-between md:gap-16px'>
        <div className='flex items-center gap-12px min-w-0 flex-1'>
          <div className={classNames('w-28px h-28px rd-8px f-center flex-shrink-0 text-9px md:text-10px font-700 shadow-sm', badgeColors[record.key] || 'bg-blue-1 color-blue-6 border border-blue-3')}>
            {record.key === 'shareone' ? <ShareOne theme='outline' size={16} className='block' /> : record.badge}
          </div>

          <div className='min-w-0 flex-1 space-y-4px'>
            <div className='flex flex-col gap-4px lg:flex-row lg:items-center lg:gap-8px'>
              <span className='text-14px font-600 text-foreground leading-none'>{record.displayName}</span>
              <span className='w-fit px-8px py-2px rd-999px text-10px font-mono leading-none bg-fill-1 text-secondary border'>{record.command}</span>
            </div>

            <div className='flex flex-wrap items-center gap-6px'>
              <span className={classNames('inline-flex items-center gap-6px px-8px py-2px rd-999px text-11px border', isShareOneDisabled ? 'bg-[var(--color-primary-light-1)] text-[var(--color-primary-6)] border-[var(--color-primary-light-3)]' : 'bg-fill-1 text-secondary')}>
                <span className={classNames('w-6px h-6px rd-full flex-shrink-0', dotColor)} />
                <span className='leading-none font-500'>{statusText}</span>
              </span>
              {version && <span className='px-8px py-2px rd-999px text-10px font-500 bg-fill-1 text-secondary border whitespace-nowrap'>{version}</span>}
              {sourceLabel && installed && <span className='px-8px py-2px rd-999px text-10px font-500 bg-[var(--color-primary-light-1)] text-[var(--color-primary-6)] border border-[var(--color-primary-light-3)] whitespace-nowrap'>{sourceLabel}</span>}
            </div>
          </div>
        </div>

        <div className='flex flex-wrap items-center gap-3 md:justify-end md:max-w-280px'>
          {actions.map((action) => (
            <Button key={`${record.key}-${action.key}`} type='outline' size='small' status={action.status} disabled={loading} onClick={action.onClick} className='min-w-72px'>
              {action.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

interface IRuntimeToolRowProps {
  record: ToolRow;
}
