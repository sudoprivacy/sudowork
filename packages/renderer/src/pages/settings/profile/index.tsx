/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { Button, Modal, Input, Message } from '@arco-design/web-react';
import { IconEdit, IconLock, IconMobile } from '@arco-design/web-react/icon';
import { useTranslation } from 'react-i18next';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import PageWrapper from '@renderer/components/base/PageWrapper';
import { useAuth } from '@renderer/context/AuthContext';
import { useDashboardStats } from '@renderer/context/DashboardStatsContext';
import { useAppMode } from '@renderer/hooks/useAppMode';
import { useSystemLoginMethod } from '@renderer/hooks/useSystemLoginMethod';
import EnterpriseAvatar from './components/EnterpriseAvatar';
import ConsumerAvatar from './components/ConsumerAvatar';
import ModelAccountPanel from '../model-account';
import ChangePasswordModal from './components/ChangePasswordModal';

const UserProfile: React.FC = () => {
  const { t } = useTranslation();
  const { user: currentUser, refresh: refreshAuth, authFetch, enterpriseProfile, refreshEnterpriseProfile } = useAuth();
  const { profile, refresh: refreshDashboard } = useDashboardStats();
  const { isEnterprise } = useAppMode();
  const [editingNickname, setEditingNickname] = useState('');
  const [editModalVisible, setEditModalVisible] = useState(false);
  const { loginMethod } = useSystemLoginMethod(currentUser?.enterprise_code || '');
  const [changePwdModalVisible, setChangePwdModalVisible] = useState(false);

  const [isSavingNickname, setSavingNickname] = useState(false);
  useEffect(() => {
    if (isEnterprise) void refreshEnterpriseProfile().catch(() => Message.error(t('settings.userProfile.loadFailed')));
  }, [isEnterprise, refreshEnterpriseProfile, t]);

  // Consumer mode: trigger a stale-while-revalidate refresh on every visit.
  // Context returns the cached value immediately if still fresh (<30s) and
  // fetches in the background otherwise — so revisits feel instant.
  useEffect(() => {
    if (!isEnterprise && currentUser?.token) {
      void refreshDashboard();
    }
  }, [isEnterprise, currentUser?.token, refreshDashboard]);

  const handleEditNickname = () => {
    setEditingNickname((isEnterprise ? enterpriseProfile?.nickname || enterpriseProfile?.username : undefined) || profile?.nickname || currentUser?.nickname || '');
    setEditModalVisible(true);
  };

  const handleSaveNickname = async () => {
    if (!editingNickname.trim()) {
      Message.warning(t('settings.userProfile.nicknameRequired', '昵称不能为空'));
      return;
    }

    if (isSavingNickname) return;
    setSavingNickname(true);
    try {
      if (isEnterprise) {
        const result = await ipcBridge.eeclaw.updateUserProfile.invoke({ nickname: editingNickname.trim() });
        if (!result.success) throw new Error(result.msg || 'update_failed');
        await refreshEnterpriseProfile();
        setEditModalVisible(false);
        Message.success(t('settings.userProfile.nicknameUpdated'));
        return;
      }
      const serverConfig = await ipcBridge.sudoworkServer.getConfig.invoke();

      const res = await authFetch(`${serverConfig.baseUrl}/api/v1/user/update-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: editingNickname.trim() }),
      });

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
    } finally {
      setSavingNickname(false);
    }
  };

  return (
    <PageWrapper title={t('settings.profile', '用户中心')}>
      <div className='flex flex-col gap-6 pb-2'>
        {isEnterprise ? (
          <>
            {/* Enterprise: Identity */}
            <div className='flex items-center gap-5 p-6 rd-16px border border-light'>
              <EnterpriseAvatar key={currentUser?.id} />
              <div className='flex-1'>
                <div className='flex items-center gap-2 flex-wrap'>
                  <div className='text-18px font-600 text-foreground'>{enterpriseProfile?.nickname || enterpriseProfile?.username || '--'}</div>
                  <Button type='outline' size='mini' icon={<IconEdit />} disabled={!enterpriseProfile} onClick={handleEditNickname}>
                    {t('settings.userProfile.editNickname')}
                  </Button>
                  {enterpriseProfile?.can_change_password && (
                    <Button type='outline' size='mini' icon={<IconLock />} onClick={() => setChangePwdModalVisible(true)}>
                      {t('settings.userProfile.changePassword')}
                    </Button>
                  )}
                </div>
                <div className='flex flex-col gap-2 mt-2 text-12px text-secondary'>
                  <span>
                    {t('settings.userProfile.loginAccount')}: {enterpriseProfile?.login_name || '--'}
                  </span>
                  <span>
                    {t('settings.userProfile.organization')}: {enterpriseProfile?.organization_name || '--'}
                  </span>
                  <span>
                    {t('settings.userProfile.role')}: {enterpriseProfile?.role || '--'}
                  </span>
                  {enterpriseProfile && !enterpriseProfile.can_change_password && <span>{t('settings.userProfile.noLocalPassword')}</span>}
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
          </>
        )}
        <ModelAccountPanel />
      </div>

      {/* Edit nickname without changing the login account. */}
      <Modal title={t('settings.userProfile.editNickname', '编辑昵称')} visible={editModalVisible} confirmLoading={isSavingNickname} onOk={handleSaveNickname} onCancel={() => setEditModalVisible(false)} okText={t('common.save', '保存')} cancelText={t('common.cancel', '取消')}>
        <Input maxLength={60} disabled={isSavingNickname} value={editingNickname} onChange={(val) => setEditingNickname(val)} placeholder={t('settings.userProfile.nicknamePlaceholder', '请输入昵称')} onPressEnter={handleSaveNickname} />
      </Modal>
      {/* Change Password Modal (only when login_method=1) */}
      <ChangePasswordModal isEnterprise={isEnterprise} visible={changePwdModalVisible} onClose={() => setChangePwdModalVisible(false)} />
    </PageWrapper>
  );
};

export default UserProfile;
