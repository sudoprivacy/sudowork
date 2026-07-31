/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

const PANEL_CLASS = 'border border-border bg-card p-6 rd-16px';

export default function PointsDashboard({ remainingPoints, usedPoints, bonusPoints }: IPointsDashboardProps) {
  const { t } = useTranslation();

  const statItems = [
    { label: t('settings.recharge.remainingPoints', '剩余积分'), value: remainingPoints, valueClass: 'text-brand' },
    { label: t('settings.recharge.usedPoints', '累计已用'), value: usedPoints, valueClass: 'text-foreground' },
    { label: t('settings.recharge.bonusPoints', '赠送积分'), value: bonusPoints, valueClass: 'text-foreground' },
  ];

  return (
    <div className={PANEL_CLASS}>
      <div className='text-14px font-600 text-foreground mb-6'>{t('settings.recharge.pointsInfo', '积分信息')}</div>
      <div className='grid grid-cols-3'>
        {statItems.map(({ label, value, valueClass }) => (
          <div key={label} className={`flex flex-col gap-2`}>
            <div className='text-13px font-500 text-foreground-secondary'>{label}</div>
            <div className='flex items-baseline gap-2'>
              <span className={`text-32px font-700 leading-none ${valueClass}`}>{value.toLocaleString()}</span>
              <span className='text-12px font-600 text-foreground-secondary'>PTS</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface IPointsDashboardProps {
  remainingPoints: number;
  usedPoints: number;
  bonusPoints: number;
}
