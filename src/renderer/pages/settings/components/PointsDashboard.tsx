import React from 'react';
import { useTranslation } from 'react-i18next';

interface PointsDashboardProps {
  remainingPoints: number;
  usedPoints: number;
  bonusPoints: number;
  className?: string;
}

const PointsDashboard: React.FC<PointsDashboardProps> = ({ remainingPoints, usedPoints, bonusPoints, className }) => {
  const { t } = useTranslation();

  return (
    <div className={`p-24px bg-fill-0 rd-16px border border-border-base ${className || ''}`}>
      <div className='text-14px font-600 text-t-primary mb-16px'>{t('settings.recharge.pointsInfo') || '积分信息'}</div>
      <div className='grid grid-cols-1 md:grid-cols-3 gap-16px'>
        <div className='p-24px bg-fill-0 rd-16px border border-border-base flex flex-col justify-between h-140px'>
          <div className='text-13px font-500 text-t-secondary'>{t('settings.recharge.remainingPoints') || '剩余积分'}</div>
          <div className='flex items-baseline'>
            <div className='flex items-baseline gap-8px'>
              <span className='text-36px font-700 italic text-primary'>{remainingPoints}</span>
              <span className='text-12px font-600 text-t-tertiary'>PTS</span>
            </div>
          </div>
        </div>

        <div className='p-24px bg-fill-0 rd-16px border border-border-base flex flex-col justify-between h-140px'>
          <div className='text-13px font-500 text-t-secondary'>{t('settings.recharge.usedPoints') || '累计已用'}</div>
          <div className='flex items-baseline gap-8px'>
            <span className='text-36px font-700 text-t-primary'>{usedPoints}</span>
            <span className='text-12px font-600 text-t-tertiary'>PTS</span>
          </div>
        </div>

        <div className='p-24px bg-fill-0 rd-16px border border-border-base flex flex-col justify-between h-140px'>
          <div className='text-13px font-500 text-t-secondary'>{t('settings.recharge.bonusPoints') || '赠送积分'}</div>
          <div className='flex items-baseline gap-8px'>
            <span className='text-36px font-700 text-success'>{bonusPoints}</span>
            <span className='text-12px font-600 text-t-tertiary'>PTS</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PointsDashboard;
