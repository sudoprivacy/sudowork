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
    <div className='py-3.5 first:pt-0 last:pb-0'>
      <div className='flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-4'>
        <div className='flex items-center gap-3 min-w-0 flex-1'>
          <div className={classNames('w-7 h-7 rd-8px f-center flex-shrink-0 text-9px md:text-10px font-700 shadow-sm', badgeColors[record.key] || 'bg-blue-1 color-blue-6 border border-blue-3')}>
            {record.key === 'shareone' ? <ShareOne theme='outline' size={16} className='block' /> : record.badge}
          </div>

          <div className='min-w-0 flex-1 space-y-1'>
            <div className='flex flex-col gap-1 lg:flex-row lg:items-center lg:gap-2'>
              <span className='text-14px font-600 text-foreground leading-none'>{record.displayName}</span>
              <span className='w-fit px-2 py-1.5 rd-full text-10px font-mono leading-none bg-subtle text-secondary border'>{record.command}</span>
            </div>

            <div className='flex flex-wrap items-center gap-1.5'>
              <span className={classNames('inline-flex items-center gap-1.5 px-2 py-1.5 rd-full text-10px font-500 leading-none border', isShareOneDisabled ? 'bg-primary-light-1 text-primary' : 'bg-subtle text-secondary')}>
                <span className={classNames('w-1.5 h-1.5 rd-full flex-shrink-0', dotColor)} />
                <span>{statusText}</span>
              </span>
              {version && <span className='px-2 py-1.5 rd-full text-10px font-500 leading-none bg-subtle text-secondary border whitespace-nowrap'>{version}</span>}
              {sourceLabel && installed && <span className='px-2 py-1.5 rd-full text-10px font-500 leading-none bg-primary-light-1 text-primary border whitespace-nowrap'>{sourceLabel}</span>}
            </div>
          </div>
        </div>

        <div className='flex flex-wrap items-center gap-3 md:justify-end md:max-w-70'>
          {actions.map((action) => (
            <Button key={`${record.key}-${action.key}`} type='outline' size='small' status={action.status} disabled={loading} onClick={action.onClick} className='min-w-18'>
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
