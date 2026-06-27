import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Avatar, Button, Modal, Input, Message, Spin } from '@arco-design/web-react';
import { IconEdit, IconLock, IconMobile, IconUser } from '@arco-design/web-react/icon';
import { useTranslation } from 'react-i18next';
import { formatUsagePoints } from '@/common/tokenUsage';
import type { UserProfileData } from '@/common/ipcBridge';
import { ipcBridge } from '@/common';
import PageWrapper from '@renderer/components/base/PageWrapper';
import { useAuth } from '@renderer/context/AuthContext';
import { useDashboardStats } from '@renderer/context/DashboardStatsContext';
import { useAppMode } from '@renderer/hooks/useAppMode';
import { useSystemLoginMethod } from '@renderer/hooks/useSystemLoginMethod';
import ConsumerAvatar from './components/ConsumerAvatar';
import WeeklyModelUsageChart from './components/WeeklyModelUsageChart';
import ChangePasswordModal from './components/ChangePasswordModal';

const UserProfile: React.FC = () => {
  const { t } = useTranslation();
  const { user: currentUser, refresh: refreshAuth, ensureValidToken, forceRefreshToken } = useAuth();
  const { profile, stats, refresh: refreshDashboard } = useDashboardStats();
  const { isEnterprise } = useAppMode();
  const [editingNickname, setEditingNickname] = useState('');
  const [editModalVisible, setEditModalVisible] = useState(false);
  const { loginMethod } = useSystemLoginMethod();
  const [changePwdModalVisible, setChangePwdModalVisible] = useState(false);

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
      Message.warning(t('settings.userProfile.nicknameRequired', '昵称不能为空'));
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
        Message.error(t('settings.userProfile.loginExpired', '登录状态已过期，请重新登录'));
        return;
      }

      const data = await res.json();
      if (data.success) {
        Message.success(t('settings.userProfile.nicknameUpdated', '昵称已更新'));
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
        Message.error(data.msg || t('settings.userProfile.updateFailed', '更新失败'));
      }
    } catch (e) {
      console.error('Failed to update nickname:', e);
      Message.error(t('settings.userProfile.updateFailed', '更新失败'));
    }
  };

  const todayPoints = useMemo(() => {
    const usageToday = stats?.usage_today;
    return formatUsagePoints(usageToday?.cost_points) ?? '0';
  }, [stats?.usage_today]);

  return (
    <PageWrapper contentClassName='max-w-200'>
      <div className='flex flex-col gap-6 py-2'>
        <div className='text-20px font-600 text-foreground leading-32px'>{t('settings.profile', '用户中心')}</div>

        {isEnterprise ? (
          <>
            {/* Enterprise: Identity */}
            <div className='flex items-center gap-5 p-6 rd-16px border border-light'>
              <Avatar size={64} className='bg-primary'>
                <IconUser style={{ fontSize: 32, color: '#fff' }} />
              </Avatar>
              <div className='flex-1'>
                <div className='text-18px font-600 text-foreground'>{enterpriseProfile?.username || '--'}</div>
                <div className='flex gap-2 mt-2'>
                  <span className='inline-flex items-center h-6 px-2.5 rd-6px text-12px bg-control text-secondary'>{enterpriseProfile?.role || '--'}</span>
                </div>
              </div>
            </div>

            {/* Enterprise: Usage Stats */}
            <div className='p-6 rd-16px border border-light'>
              <div className='text-14px font-600 text-foreground mb-4'>{t('settings.userProfile.resourceUsage', '资源使用')}</div>
              <div className='grid grid-cols-4 gap-4'>
                <div className='text-center'>
                  <div className='text-24px font-700 text-foreground'>{enterpriseProfile?.usage?.input_tokens?.toLocaleString() || 0}</div>
                  <div className='text-12px text-tertiary'>{t('settings.userProfile.inputTokens', '输入 Token')}</div>
                </div>
                <div className='text-center'>
                  <div className='text-24px font-700 text-foreground'>{enterpriseProfile?.usage?.output_tokens?.toLocaleString() || 0}</div>
                  <div className='text-12px text-tertiary'>{t('settings.userProfile.outputTokens', '输出 Token')}</div>
                </div>
                <div className='text-center'>
                  <div className='text-24px font-700 text-foreground'>{enterpriseProfile?.usage?.total_tokens?.toLocaleString() || 0}</div>
                  <div className='text-12px text-tertiary'>{t('settings.userProfile.totalTokens', '总 Token')}</div>
                </div>
                <div className='text-center'>
                  <div className='text-24px font-700 text-foreground'>{enterpriseProfile?.usage?.session_count || 0}</div>
                  <div className='text-12px text-tertiary'>{t('settings.userProfile.sessions', '会话数')}</div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Consumer: Identity */}
            <div className='flex items-center gap-5 p-6 rd-16px border border-light'>
              <ConsumerAvatar />
              <div className='flex-1'>
                <div className='flex items-center gap-2'>
                  <div className='text-18px font-600 text-foreground'>{profile?.nickname || currentUser?.nickname || t('settings.userProfile.defaultNickname', 'Sudowork 用户')}</div>
                  <Button type='outline' size='mini' icon={<IconEdit />} onClick={handleEditNickname}>
                    {t('settings.userProfile.edit', '编辑')}
                  </Button>
                  {loginMethod === 1 && (
                    <Button type='outline' size='mini' icon={<IconLock />} onClick={() => setChangePwdModalVisible(true)}>
                      {t('settings.userProfile.changePassword', '修改密码')}
                    </Button>
                  )}
                </div>
                <div className='flex gap-3 mt-2'>
                  <span className='text-12px text-secondary flex items-center gap-1'>
                    <IconMobile className='text-14px' /> {profile?.phone || currentUser?.phone || t('settings.userProfile.unbound', '未绑定')}
                  </span>
                </div>
              </div>
            </div>

            {/* Consumer: Today Stats */}
            <div className='p-6 rd-16px border border-light'>
              <div className='text-14px font-600 text-foreground mb-4'>{t('settings.userProfile.todayUsage', '今日使用')}</div>
              <div className='grid grid-cols-3 gap-4'>
                <div className='text-center'>
                  <div className='text-24px font-700 text-foreground min-h-8 f-center'>{stats === null ? <Spin size={20} /> : (stats.usage_today?.tokens?.toLocaleString() ?? '0')}</div>
                  <div className='text-12px text-tertiary'>{t('settings.userProfile.tokens', 'Tokens')}</div>
                </div>
                <div className='text-center'>
                  <div className='text-24px font-700 text-primary min-h-8 f-center'>{stats === null ? <Spin size={20} /> : todayPoints}</div>
                  <div className='text-12px text-tertiary'>{t('settings.userProfile.consumedPoints', '消耗积分')}</div>
                </div>
                <div className='text-center'>
                  <div className='text-24px font-700 text-foreground min-h-8 f-center'>{stats === null ? <Spin size={20} /> : (stats.usage_today?.requests ?? 0)}</div>
                  <div className='text-12px text-tertiary'>{t('settings.userProfile.requests', '请求数')}</div>
                </div>
              </div>
            </div>

            {/* Consumer: Model Usage Chart */}
            <WeeklyModelUsageChart />
          </>
        )}
      </div>

      {/* Edit Nickname Modal (consumer only) */}
      <Modal title={t('settings.userProfile.editNickname', '编辑昵称')} visible={editModalVisible} onOk={handleSaveNickname} onCancel={() => setEditModalVisible(false)} okText={t('common.save', '保存')} cancelText={t('common.cancel', '取消')}>
        <Input value={editingNickname} onChange={(val) => setEditingNickname(val)} placeholder={t('settings.userProfile.nicknamePlaceholder', '请输入昵称')} onPressEnter={handleSaveNickname} />
      </Modal>
      {/* Change Password Modal (only when login_method=1) */}
      <ChangePasswordModal visible={changePwdModalVisible} onClose={() => setChangePwdModalVisible(false)} />
    </PageWrapper>
  );
};

export default UserProfile;
