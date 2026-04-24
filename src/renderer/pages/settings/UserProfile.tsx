import { ipcBridge } from '@/common';
import React, { useState, useEffect, useCallback } from 'react';
import { Avatar, Button, Modal, Input, Message } from '@arco-design/web-react';
import { User, Phone, Edit } from '@icon-park/react';
import SettingsPageWrapper from './components/SettingsPageWrapper';
import WeeklyModelUsageChart from './components/WeeklyModelUsageChart';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';

const UserProfile: React.FC = () => {
  const { t } = useTranslation();
  const { user: currentUser, refresh, ensureValidToken, forceRefreshToken } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [editingNickname, setEditingNickname] = useState('');
  const [editModalVisible, setEditModalVisible] = useState(false);

  // 带自动刷新的 fetch 封装
  const fetchWithAuth = useCallback(
    async (url: string, options: RequestInit = {}, retry = true): Promise<Response> => {
      const token = await ensureValidToken();
      if (!token) {
        throw new Error('NO_TOKEN');
      }

      const headers = {
        ...options.headers,
        Authorization: `Bearer ${token}`,
      };

      const response = await fetch(url, { ...options, headers });

      // 如果返回 401，尝试强制刷新 token 后重试一次
      if (response.status === 401 && retry) {
        console.log('[UserProfile] Got 401, attempting force token refresh...');
        const newToken = await forceRefreshToken();
        if (newToken) {
          // 用新 token 重试
          const retryHeaders = {
            ...options.headers,
            Authorization: `Bearer ${newToken}`,
          };
          return fetch(url, { ...options, headers: retryHeaders });
        }
      }

      return response;
    },
    [ensureValidToken, forceRefreshToken]
  );

  const fetchProfile = async () => {
    setLoading(true);
    try {
      const serverConfig = await ipcBridge.sudoworkServer.getConfig.invoke();

      // 并行调用：用户信息 + 仪表盘数据（积分、今日统计、使用流水）
      const [profileRes, dashboardRes] = await Promise.all([fetchWithAuth(`${serverConfig.baseUrl}/api/v1/user/profile`), fetchWithAuth(`${serverConfig.baseUrl}/api/v1/user/dashboard`)]);

      // 检查是否有 401 响应
      if (profileRes.status === 401 || dashboardRes.status === 401) {
        console.warn('[UserProfile] Unauthorized after retry, user may need to re-login');
        setLoading(false);
        return;
      }

      const profileData = await profileRes.json();
      const dashboardData = await dashboardRes.json();

      if (profileData.success) setProfile(profileData.data);
      if (dashboardData.success) {
        setStats({
          usage_today: dashboardData.data.usage_today,
        });
      }
    } catch (e) {
      console.error('Failed to fetch profile/dashboard:', e);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (currentUser?.token) void fetchProfile();
  }, [currentUser]);

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

      const res = await fetchWithAuth(`${serverConfig.baseUrl}/api/v1/user/update-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: editingNickname.trim() }),
      });

      // 检查 401
      if (res.status === 401) {
        Message.error('登录状态已过期，请重新登录');
        return;
      }

      const data = await res.json();
      if (data.success) {
        Message.success('昵称已更新');
        setEditModalVisible(false);
        // 更新本地存储的用户信息
        const stored = localStorage.getItem('sudowork_auth_v2');
        if (stored) {
          const authData = JSON.parse(stored);
          authData.user.nickname = editingNickname.trim();
          localStorage.setItem('sudowork_auth_v2', JSON.stringify(authData));
        }
        // 同步昵称到主进程，触发 USER.md 更新，让 AI 能正确称呼用户
        ipcBridge.sudoworkAuth.saveUserNickname.invoke({ nickname: editingNickname.trim() }).catch((error) => {
          console.error('[UserProfile] Failed to sync nickname to main process:', error);
        });
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

        {/* Model Usage Chart */}
        <WeeklyModelUsageChart />
      </div>

      {/* Edit Nickname Modal */}
      <Modal title='编辑昵称' visible={editModalVisible} onOk={handleSaveNickname} onCancel={() => setEditModalVisible(false)} okText='保存' cancelText='取消'>
        <Input value={editingNickname} onChange={(val) => setEditingNickname(val)} placeholder='请输入昵称' onPressEnter={handleSaveNickname} />
      </Modal>
    </SettingsPageWrapper>
  );
};

export default UserProfile;
