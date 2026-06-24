/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Tooltip } from '@arco-design/web-react';
import { AlarmClock, Attention, PauseOne } from '@icon-park/react';
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
      theme: 'outline' as const,
      size,
      strokeWidth: 3,
      fill: 'var(--text-secondary)',
      className: 'flex items-center',
    };

    switch (status) {
      case CronJobStatusEnums.Unread:
        // Show alarm clock with red dot overlay for unread executions
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
        return <PauseOne {...iconProps} />;
      case CronJobStatusEnums.Error:
        return <Attention {...iconProps} />;
      case CronJobStatusEnums.Unconfigured:
        return <AlarmClock {...iconProps} />;
      default:
        return null;
    }
  };

  const getTooltip = () => {
    switch (status) {
      case CronJobStatusEnums.Unread:
        return t('cron.status.unread');
      case CronJobStatusEnums.Active:
        return t('cron.status.active');
      case CronJobStatusEnums.Paused:
        return t('cron.status.paused');
      case CronJobStatusEnums.Error:
        return t('cron.status.error');
      case CronJobStatusEnums.Unconfigured:
        return t('cron.status.unconfigured');
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
