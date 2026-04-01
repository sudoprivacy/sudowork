import { ipcBridge } from '@/common';
import React, { useState, useEffect } from 'react';
import { Avatar, Progress, Table, Tag, Button, Input, Modal, Message } from '@arco-design/web-react';
import { User, Phone, Wechat, Edit } from '@icon-park/react';
import SettingsPageWrapper from './components/SettingsPageWrapper';
import RechargeModal from './components/RechargeModal';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';

const UserProfile: React.FC = () => {
  const { t } = useTranslation();
  const { user: currentUser, refresh } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [ledger, setLedger] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingNickname, setEditingNickname] = useState('');
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [rechargeModalVisible, setRechargeModalVisible] = useState(false);

  const fetchProfile = async () => {
    setLoading(true);
    try {
      const serverConfig = await ipcBridge.sudoworkServer.getConfig.invoke();
      const headers = { Authorization: `Bearer ${currentUser?.token}` };

      // 并行调用：用户信息 + 仪表盘数据（积分、今日统计、使用流水）
      const [profileRes, dashboardRes] = await Promise.all([fetch(`${serverConfig.baseUrl}/api/v1/user/profile`, { headers }), fetch(`${serverConfig.baseUrl}/api/v1/user/dashboard`, { headers })]);

      const profileData = await profileRes.json();
      const dashboardData = await dashboardRes.json();

      if (profileData.success) setProfile(profileData.data);
      if (dashboardData.success) {
        // 合并 points 和 usage_today 到 stats
        setStats({
          ...dashboardData.data.points,
          usage_today: dashboardData.data.usage_today,
        });
        setLedger(dashboardData.data.ledger?.list || []);
      }
    } catch (e) {
      console.error('Failed to fetch profile/dashboard:', e);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (currentUser?.token) void fetchProfile();
  }, [currentUser]);

  const usedPoints = stats?.used || 0;
  const totalPoints = stats?.total || 100;
  const remainingPoints = stats?.remaining || 0;
  const bonusPoints = stats?.bonus || 1000;
  const usedPercent = totalPoints > 0 ? Math.round((usedPoints / totalPoints) * 100) : 0;

  const handleEditNickname = () => {
    setEditingNickname(profile?.nickname || currentUser?.nickname || '');
    setEditModalVisible(true);
  };

  const handleSaveNickname = async () => {
    if (!editingNickname.trim()) {
      Message.warning('昵称不能为空');
      return;
    }

    try {
      const serverConfig = await ipcBridge.sudoworkServer.getConfig.invoke();
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${currentUser?.token}`,
      };

      const res = await fetch(`${serverConfig.baseUrl}/api/v1/user/update-profile`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ nickname: editingNickname.trim() }),
      });

      const data = await res.json();
      if (data.success) {
        Message.success('昵称已更新');
        setEditModalVisible(false);
        // 更新本地存储的用户信息
        const stored = localStorage.getItem('sudowork_auth_v1');
        if (stored) {
          const authData = JSON.parse(stored);
          authData.nickname = editingNickname.trim();
          localStorage.setItem('sudowork_auth_v1', JSON.stringify(authData));
        }
        // 刷新页面数据
        await fetchProfile();
        await refresh();
      } else {
        Message.error(data.msg || '更新失败');
      }
    } catch (e) {
      console.error('Failed to update nickname:', e);
      Message.error('更新失败');
    }
  };

  return (
    <SettingsPageWrapper contentClassName='max-w-800px'>
      <div className='flex flex-col gap-24px py-8px'>
        <div className='text-20px font-600 text-t-primary leading-32px'>{t('settings.profile')}</div>

        {/* Identity */}
        <div className='flex items-center gap-20px p-24px bg-fill-0 rd-16px border border-border-base'>
          <Avatar size={64} className='bg-primary/10'>
            <User theme='outline' size={32} className='text-primary' />
          </Avatar>
          <div className='flex-1'>
            <div className='flex items-center gap-8px'>
              <div className='text-18px font-600 text-t-primary'>{profile?.nickname || currentUser?.nickname || 'Sudowork 用户'}</div>
              <Button type='text' size='small' icon={<Edit size={14} />} onClick={handleEditNickname}>
                编辑
              </Button>
            </div>
            <div className='flex gap-12px mt-8px'>
              <span className='text-12px text-t-secondary flex items-center gap-4px'>
                <Phone size='14' /> {profile?.phone || currentUser?.phone || '未绑定'}
              </span>
            </div>
          </div>
        </div>

        {/* Dashboard */}
        <div className='grid grid-cols-1 md:grid-cols-3 gap-16px'>
          <div className='p-24px bg-fill-0 rd-16px border border-border-base flex flex-col justify-between h-140px'>
            <div className='text-13px font-500 text-t-secondary'>剩余积分</div>
            <div className='flex items-baseline justify-between'>
              <div className='flex items-baseline gap-8px'>
                <span className='text-36px font-700 italic text-primary'>{remainingPoints}</span>
                <span className='text-12px font-600 text-t-tertiary'>PTS</span>
              </div>
              {currentUser?.token && (
                <span className='text-13px font-500 text-primary cursor-pointer hover:opacity-80 transition-opacity' onClick={() => setRechargeModalVisible(true)}>
                  充值
                </span>
              )}
            </div>
          </div>

          <div className='p-24px bg-fill-0 rd-16px border border-border-base flex flex-col justify-between h-140px'>
            <div className='text-13px font-500 text-t-secondary'>累计已用</div>
            <div className='flex items-baseline gap-8px'>
              <span className='text-36px font-700 text-t-primary'>{usedPoints}</span>
              <span className='text-12px font-600 text-t-tertiary'>PTS</span>
            </div>
          </div>

          <div className='p-24px bg-fill-0 rd-16px border border-border-base flex flex-col justify-between h-140px'>
            <div className='text-13px font-500 text-t-secondary'>赠送积分</div>
            <div className='flex items-baseline gap-8px'>
              <span className='text-36px font-700 text-success'>{bonusPoints}</span>
              <span className='text-12px font-600 text-t-tertiary'>PTS</span>
            </div>
          </div>
        </div>

        {/* Today Stats */}
        <div className='p-24px bg-fill-0 rd-16px border border-border-base'>
          <div className='text-14px font-600 text-t-primary mb-16px'>今日使用</div>
          <div className='grid grid-cols-3 gap-16px'>
            <div className='text-center'>
              <div className='text-24px font-700 text-t-primary'>{stats?.usage_today?.tokens?.toLocaleString() || 0}</div>
              <div className='text-12px text-t-tertiary'>Tokens</div>
            </div>
            <div className='text-center'>
              <div className='text-24px font-700 text-primary'>{stats?.usage_today?.cost_points || 0}</div>
              <div className='text-12px text-t-tertiary'>消耗积分</div>
            </div>
            <div className='text-center'>
              <div className='text-24px font-700 text-t-primary'>{stats?.usage_today?.requests || 0}</div>
              <div className='text-12px text-t-tertiary'>请求数</div>
            </div>
          </div>
        </div>

        {/* Ledger Table */}
        <div className='bg-fill-0 rd-16px border border-border-base overflow-hidden'>
          <div className='px-20px py-16px border-b border-border-base font-600 text-14px text-t-primary'>使用流水</div>
          {ledger.length > 0 ? (
            <table className='w-full'>
              <thead>
                <tr className='border-b border-border-base text-13px text-t-secondary'>
                  <th className='py-12px px-20px text-left font-500'>模型</th>
                  <th className='py-12px px-20px text-left font-500'>使用时间</th>
                  <th className='py-12px px-20px text-right font-500'>输入Token</th>
                  <th className='py-12px px-20px text-right font-500'>输出Token</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((item, index) => (
                  <tr key={index} className='border-b border-border-1 last:border-b-0 text-14px'>
                    <td className='py-12px px-20px text-t-primary'>{item.model || '-'}</td>
                    <td className='py-12px px-20px text-t-secondary'>{item.timestamp ? new Date(item.timestamp).toLocaleString() : '-'}</td>
                    <td className='py-12px px-20px text-right font-500 text-t-primary'>{(item.prompt_tokens || 0).toLocaleString()}</td>
                    <td className='py-12px px-20px text-right font-500 text-t-primary'>{(item.completion_tokens || 0).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className='py-24px text-center text-t-tertiary'>暂无使用记录</div>
          )}
        </div>
      </div>

      {/* Edit Nickname Modal */}
      <Modal title='编辑昵称' visible={editModalVisible} onOk={handleSaveNickname} onCancel={() => setEditModalVisible(false)} okText='保存' cancelText='取消'>
        <Input value={editingNickname} onChange={(val) => setEditingNickname(val)} placeholder='请输入昵称' onPressEnter={handleSaveNickname} />
      </Modal>

      {/* Recharge Modal */}
      <RechargeModal
        visible={rechargeModalVisible}
        onCancel={() => setRechargeModalVisible(false)}
        onSuccess={() => {
          void fetchProfile();
          void refresh();
        }}
      />
    </SettingsPageWrapper>
  );
};

export default UserProfile;
