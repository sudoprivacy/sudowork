import { ipcBridge } from '@/common';
import React, { useState, useEffect } from 'react';
import { Avatar, Progress, Table, Button } from '@arco-design/web-react';
import { User, Phone, Wechat, Logout } from '@icon-park/react';
import SettingsPageWrapper from './components/SettingsPageWrapper';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useNavigate } from 'react-router-dom';

const UserProfile: React.FC = () => {
  const { t } = useTranslation();
  const { user: currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<any>(null);
  const [ledger, setLedger] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    await logout();
  };

  const fetchProfile = async () => {
    setLoading(true);
    try {
      const serverConfig = await ipcBridge.sudoworkServer.getConfig.invoke();
      const headers = { Authorization: `Bearer ${currentUser?.token}` };

      const [profileRes, ledgerRes] = await Promise.all([fetch(`${serverConfig.baseUrl}/api/v1/user/profile`, { headers }), fetch(`${serverConfig.baseUrl}/api/v1/user/ledger`, { headers })]);

      const profileData = await profileRes.json();
      const ledgerData = await ledgerRes.json();

      if (profileData.success) setProfile(profileData.data);
      if (ledgerData.success) setLedger(ledgerData.data);
    } catch (e) {
      console.error('Failed to fetch profile/ledger:', e);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (currentUser?.token) fetchProfile();
  }, [currentUser]);

  const usedPoints = profile?.used_points || 0;
  const totalPoints = profile?.total_points || 100;
  const usedPercent = Math.round((usedPoints / totalPoints) * 100);

  return (
    <SettingsPageWrapper contentClassName='max-w-800px'>
      <div className='flex flex-col gap-24px py-8px'>
        <div className='flex items-center justify-between'>
          <div className='text-20px font-600 text-t-primary leading-32px'>{t('settings.profile')}</div>
          <Button type='secondary' status='danger' icon={<Logout />} onClick={handleLogout} className='rd-8px'>
            退出登录
          </Button>
        </div>

        {/* Identity */}
        <div className='flex items-center gap-20px p-24px bg-2 rd-16px border border-border-2'>
          <Avatar size={64} className='bg-primary/10'>
            <User theme='outline' size={32} className='text-primary' />
          </Avatar>
          <div className='flex-1'>
            <div className='text-18px font-600 text-t-primary'>{profile?.nickname || currentUser?.nickname || 'Sudowork 用户'}</div>
            <div className='flex gap-12px mt-8px'>
              <span className='text-12px text-t-secondary flex items-center gap-4px'>
                <Phone size='14' /> {profile?.phone || '未绑定'}
              </span>
              <span className='text-12px text-t-secondary flex items-center gap-4px'>
                <Wechat size='14' /> {profile?.enterprise_code ? `企业码: ${profile.enterprise_code}` : '已绑定微信'}
              </span>
            </div>
          </div>
        </div>

        {/* Dashboard */}
        <div className='grid grid-cols-1 md:grid-cols-2 gap-16px'>
          <div className='p-24px bg-2 rd-16px border border-border-2 flex flex-col justify-between h-160px'>
            <div className='text-13px font-500 text-t-secondary'>{t('settings.sudorouter.points')}</div>
            <div className='flex items-baseline gap-8px'>
              <span className='text-40px font-700 italic'>{(profile?.balance || 0).toFixed(2)}</span>
              <span className='text-12px font-600 text-primary'>PTS</span>
            </div>
            <Progress percent={usedPercent} showText={false} size='small' color='var(--color-primary)' />
          </div>

          <div className='p-24px bg-2 rd-16px border border-border-2 flex flex-col justify-between h-160px'>
            <div className='text-13px font-500 text-t-secondary'>{t('settings.sudorouter.usageLedger')}</div>
            <div className='flex justify-between items-end'>
              <div className='flex flex-col'>
                <span className='text-11px text-t-dim uppercase'>累计已用</span>
                <span className='text-20px font-700'>{usedPoints.toFixed(2)}</span>
              </div>
              <div className='flex flex-col text-right'>
                <span className='text-11px text-t-dim uppercase'>总额度</span>
                <span className='text-20px font-700 text-t-primary'>{totalPoints.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Ledger Table */}
        <div className='bg-2 rd-16px border border-border-2 overflow-hidden'>
          <div className='px-20px py-16px border-b border-border-2 font-600 text-14px'>使用流水</div>
          <Table dataSource={ledger} pagination={{ pageSize: 5 }} loading={loading} className='[&_.arco-table-th]:bg-transparent [&_.arco-table-td]:bg-transparent'>
            <Table.Column title='时间' dataIndex='timestamp' render={(t) => new Date(t).toLocaleString()} />
            <Table.Column title='类型' dataIndex='type' render={(val) => <Tag color={val === 'BONUS' ? 'green' : 'orange'}>{val}</Tag>} />
            <Table.Column title='备注' dataIndex='memo' />
            <Table.Column title='变动' dataIndex='amount' align='right' render={(val) => <span className={val > 0 ? 'text-green-500' : 'text-primary'}>{val > 0 ? `+${val}` : val}</span>} />
          </Table>
        </div>
      </div>
    </SettingsPageWrapper>
  );
};

export default UserProfile;
