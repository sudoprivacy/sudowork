import { Tooltip } from '@arco-design/web-react';
import { AlarmClock, Pause, TriangleAlert } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { CronJobStatusEnums } from '@/renderer/utils/enum';

interface ICronStatusIconProps {
  status: CronJobStatusEnums;
  size?: number;
  className?: string;
}

/**
 * Simple indicator icon for conversations with cron jobs
 * Used in ChatHistory to distinguish conversations with scheduled tasks
 */
const CronStatusIcon: React.FC<ICronStatusIconProps> = ({ status, size = 14, className = '' }) => {
  const { t } = useTranslation();

  if (status === CronJobStatusEnums.None) {
    return null;
  }

  const getIcon = () => {
    const iconProps = {
      size,
      strokeWidth: 2,
      color: 'var(--text-secondary)',
    };

    switch (status) {
      case CronJobStatusEnums.Unread:
        return (
          <span className='relative inline-flex'>
            <AlarmClock {...iconProps} />
            <span
              className='absolute rounded-full bg-red-500'
              style={{
                width: Math.max(6, size * 0.4),
                height: Math.max(6, size * 0.4),
                top: -1,
                right: -1,
              }}
            />
          </span>
        );
      case CronJobStatusEnums.Active:
        return <AlarmClock {...iconProps} />;
      case CronJobStatusEnums.Paused:
        return <Pause {...iconProps} />;
      case CronJobStatusEnums.Error:
        return <TriangleAlert {...iconProps} />;
      case CronJobStatusEnums.Unconfigured:
        return <AlarmClock {...iconProps} />;
      default:
        return null;
    }
  };

  const getTooltip = () => {
    switch (status) {
      case CronJobStatusEnums.Unread:
        return t('cron.status.unread', '有新执行');
      case CronJobStatusEnums.Active:
        return t('cron.status.active', '运行中');
      case CronJobStatusEnums.Paused:
        return t('cron.status.paused', '已暂停');
      case CronJobStatusEnums.Error:
        return t('cron.status.error', '执行出错');
      case CronJobStatusEnums.Unconfigured:
        return t('cron.status.unconfigured', '未配置定时任务');
      default:
        return '';
    }
  };

  return (
    <Tooltip content={getTooltip()} mini>
      <span className={`inline-flex items-center justify-center ${className}`}>{getIcon()}</span>
    </Tooltip>
  );
};

export default CronStatusIcon;
