import { ipcBridge } from '@/common';
import type { UserProfileData } from '@/common/ipcBridge';
import { formatUsagePoints } from '@/common/tokenUsage';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Avatar, Button, Modal, Input, Message, Spin } from '@arco-design/web-react';
import { User, Phone, Edit } from '@icon-park/react';
import SettingsPageWrapper from './components/SettingsPageWrapper';
import WeeklyModelUsageChart from './components/WeeklyModelUsageChart';
import ConsumerAvatar from './components/ConsumerAvatar';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useDashboardStats } from '../../context/DashboardStatsContext';
import { useAppMode } from '../../hooks/useAppMode';

const UserProfile: React.FC = () => {
  const { t } = useTranslation();
  const { user: currentUser, refresh: refreshAuth, ensureValidToken, forceRefreshToken } = useAuth();
  const { profile, stats, refresh: refreshDashboard } = useDashboardStats();
  const { isEnterprise } = useAppMode();
  const [editingNickname, setEditingNickname] = useState('');
  const [editModalVisible, setEditModalVisible] = useState(false);

  // Enterprise mode state
  const [enterpriseProfile, setEnterpriseProfile] = useState<UserProfileData | null>(null);

  // 带自动刷新的 fetch 封装（仅用于昵称更新等写操作；读路径已迁移到 DashboardStatsContext）
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

  // Enterprise mode: fetch user profile from MOSS server
  const fetchEnterpriseProfile = async () => {
    try {
      const result = await ipcBridge.eeclaw.getUserProfile.invoke();
      if (result.success && result.data) {
        setEnterpriseProfile(result.data);
      }
    } catch (e) {
      console.error('Failed to fetch enterprise profile:', e);
    }
  };

  useEffect(() => {
    if (isEnterprise) void fetchEnterpriseProfile();
  }, [isEnterprise]);

  // Consumer mode: trigger a stale-while-revalidate refresh on every visit.
  // Context returns the cached value immediately if still fresh (<30s) and
  // fetches in the background otherwise — so revisits feel instant.
  useEffect(() => {
    if (!isEnterprise && currentUser?.token) {
      void refreshDashboard();
    }
  }, [isEnterprise, currentUser?.token, refreshDashboard]);

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
        await refreshDashboard({ force: true });
        await refreshAuth();
      } else {
        Message.error(data.msg || '更新失败');
      }
    } catch (e) {
      console.error('Failed to update nickname:', e);
      Message.error('更新失败');
    }
  };

  const todayPoints = useMemo(() => {
    const usageToday = stats?.usage_today;
    return formatUsagePoints(usageToday?.cost_points) ?? '0';
  }, [stats?.usage_today]);

  return (
    <SettingsPageWrapper contentClassName='max-w-200'>
      <div className='flex flex-col gap-6 py-2'>
        <div className='text-20px font-600 text-foreground leading-32px'>{t('settings.profile')}</div>

        {isEnterprise ? (
          <>
            {/* Enterprise: Identity */}
            <div className='flex items-center gap-5 p-6 bg-2 rd-16px border border-solid border-[var(--color-border-2)]'>
              <Avatar size={64} className='bg-primary'>
                <User theme='outline' size={32} fill='#fff' />
              </Avatar>
              <div className='flex-1'>
                <div className='text-18px font-600 text-foreground'>{enterpriseProfile?.username || '--'}</div>
                <div className='flex gap-2 mt-2'>
                  <span className='inline-flex items-center h-6 px-2.5 rd-6px text-12px bg-fill-2 text-secondary'>{enterpriseProfile?.role || '--'}</span>
                </div>
              </div>
            </div>

            {/* Enterprise: Usage Stats */}
            <div className='p-6 bg-2 rd-16px border border-solid border-[var(--color-border-2)]'>
              <div className='text-14px font-600 text-foreground mb-4'>资源使用</div>
              <div className='grid grid-cols-4 gap-4'>
                <div className='text-center'>
                  <div className='text-24px font-700 text-foreground'>{enterpriseProfile?.usage?.input_tokens?.toLocaleString() || 0}</div>
                  <div className='text-12px text-tertiary'>输入 Token</div>
                </div>
                <div className='text-center'>
                  <div className='text-24px font-700 text-foreground'>{enterpriseProfile?.usage?.output_tokens?.toLocaleString() || 0}</div>
                  <div className='text-12px text-tertiary'>输出 Token</div>
                </div>
                <div className='text-center'>
                  <div className='text-24px font-700 text-foreground'>{enterpriseProfile?.usage?.total_tokens?.toLocaleString() || 0}</div>
                  <div className='text-12px text-tertiary'>总 Token</div>
                </div>
                <div className='text-center'>
                  <div className='text-24px font-700 text-foreground'>{enterpriseProfile?.usage?.session_count || 0}</div>
                  <div className='text-12px text-tertiary'>会话数</div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Consumer: Identity */}
            <div className='flex items-center gap-5 p-6 bg-2 rd-16px border border-solid border-[var(--color-border-2)]'>
              <ConsumerAvatar />
              <div className='flex-1'>
                <div className='flex items-center gap-2'>
                  <div className='text-18px font-600 text-foreground'>{profile?.nickname || currentUser?.nickname || 'Sudowork 用户'}</div>
                  <Button type='outline' size='mini' icon={<Edit size={14} fill='currentColor' />} onClick={handleEditNickname}>
                    编辑
                  </Button>
                </div>
                <div className='flex gap-3 mt-2'>
                  <span className='text-12px text-secondary flex items-center gap-1'>
                    <Phone size='14' /> {profile?.phone || currentUser?.phone || '未绑定'}
                  </span>
                </div>
              </div>
            </div>

            {/* Consumer: Today Stats */}
            <div className='p-6 bg-2 rd-16px border border-solid border-[var(--color-border-2)]'>
              <div className='text-14px font-600 text-foreground mb-4'>{t('settings.userProfile.todayUsage')}</div>
              <div className='grid grid-cols-3 gap-4'>
                <div className='text-center'>
                  <div className='text-24px font-700 text-foreground min-h-8 flex items-center justify-center'>{stats === null ? <Spin size={20} /> : (stats.usage_today?.tokens?.toLocaleString() ?? '0')}</div>
                  <div className='text-12px text-tertiary'>{t('settings.userProfile.tokens')}</div>
                </div>
                <div className='text-center'>
                  <div className='text-24px font-700 text-primary min-h-8 flex items-center justify-center'>{stats === null ? <Spin size={20} /> : todayPoints}</div>
                  <div className='text-12px text-tertiary'>{t('settings.userProfile.consumedPoints')}</div>
                </div>
                <div className='text-center'>
                  <div className='text-24px font-700 text-foreground min-h-8 flex items-center justify-center'>{stats === null ? <Spin size={20} /> : (stats.usage_today?.requests ?? 0)}</div>
                  <div className='text-12px text-tertiary'>{t('settings.userProfile.requests')}</div>
                </div>
              </div>
            </div>

            {/* Consumer: Model Usage Chart */}
            <WeeklyModelUsageChart />
          </>
        )}
      </div>

      {/* Edit Nickname Modal (consumer only) */}
      <Modal title='编辑昵称' visible={editModalVisible} onOk={handleSaveNickname} onCancel={() => setEditModalVisible(false)} okText='保存' cancelText='取消'>
        <Input value={editingNickname} onChange={(val) => setEditingNickname(val)} placeholder='请输入昵称' onPressEnter={handleSaveNickname} />
      </Modal>
    </SettingsPageWrapper>
  );
};

export default UserProfile;
