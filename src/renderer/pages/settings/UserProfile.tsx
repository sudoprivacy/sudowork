import React from 'react';
import { Avatar, Divider, Tag, Progress, Table } from '@arco-design/web-react';
import { User, Phone, Wechat, Dashboard, History, ArrowUp, ArrowDown, Point } from '@icon-park/react';
import SettingsPageWrapper from './components/SettingsPageWrapper';
import { useTranslation } from 'react-i18next';

const UserProfile: React.FC = () => {
  const { t } = useTranslation();

  const userData = {
    nickname: 'Sudowork 用户',
    phone: '138****8888',
    totalPoints: 100.0,
    usedPoints: 15.42,
    joinDate: '2026-03-19',
  };

  const usageHistory = [
    { id: 1, time: '2026-03-19 14:20', agent: 'Claude Code', tokens: '1,240', cost: '0.12' },
    { id: 2, time: '2026-03-19 12:05', agent: 'OpenCode', tokens: '5,800', cost: '0.58' },
    { id: 3, time: '2026-03-18 22:11', agent: 'OpenClaw', tokens: '12,400', cost: '1.24' },
  ];

  const usedPercent = Math.round((userData.usedPoints / userData.totalPoints) * 100);

  return (
    <SettingsPageWrapper contentClassName='max-w-800px'>
      <div className='flex flex-col gap-24px py-8px'>
        <div className='text-20px font-600 text-t-primary leading-32px'>{t('settings.profile')}</div>

        {/* Identity */}
        <div className='flex items-center gap-20px p-24px bg-2 rd-16px border border-border-2'>
          <Avatar size={64} className='bg-primary/10'>
            <User theme='outline' size={32} className='text-primary' />
          </Avatar>
          <div className='flex-1'>
            <div className='text-18px font-600 text-t-primary'>{userData.nickname}</div>
            <div className='flex gap-12px mt-8px'>
              <span className='text-12px text-t-secondary flex items-center gap-4px'>
                <Phone size='14' /> {userData.phone}
              </span>
              <span className='text-12px text-t-secondary flex items-center gap-4px'>
                <Wechat size='14' /> 已绑定微信
              </span>
            </div>
          </div>
        </div>

        {/* Dashboard */}
        <div className='grid grid-cols-1 md:grid-cols-2 gap-16px'>
          <div className='p-24px bg-2 rd-16px border border-border-2 flex flex-col justify-between h-160px'>
            <div className='text-13px font-500 text-t-secondary'>{t('settings.sudorouter.points')}</div>
            <div className='flex items-baseline gap-8px'>
              <span className='text-40px font-700 italic'>{(userData.totalPoints - userData.usedPoints).toFixed(2)}</span>
              <span className='text-12px font-600 text-primary'>PTS</span>
            </div>
            <Progress percent={usedPercent} showText={false} size='small' color='var(--color-primary)' />
          </div>

          <div className='p-24px bg-2 rd-16px border border-border-2 flex flex-col justify-between h-160px'>
            <div className='text-13px font-500 text-t-secondary'>{t('settings.sudorouter.usageLedger')}</div>
            <div className='flex justify-between items-end'>
              <div className='flex flex-col'>
                <span className='text-11px text-t-dim uppercase'>累计已用</span>
                <span className='text-20px font-700'>{userData.usedPoints.toFixed(2)}</span>
              </div>
              <div className='flex flex-col text-right'>
                <span className='text-11px text-t-dim uppercase'>总额度</span>
                <span className='text-20px font-700 text-t-primary'>{userData.totalPoints.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className='bg-2 rd-16px border border-border-2 overflow-hidden'>
          <div className='px-20px py-16px border-b border-border-2 font-600 text-14px'>最近使用记录</div>
          <Table dataSource={usageHistory} pagination={false} className='[&_.arco-table-th]:bg-transparent [&_.arco-table-td]:bg-transparent'>
            <Table.Column title='时间' dataIndex='time' />
            <Table.Column title='实例' dataIndex='agent' />
            <Table.Column title='Tokens' dataIndex='tokens' align='right' />
            <Table.Column title='消耗 (PTS)' dataIndex='cost' align='right' render={(val) => <span className='font-600 text-primary'>-{val}</span>} />
          </Table>
        </div>
      </div>
    </SettingsPageWrapper>
  );
};

export default UserProfile;
