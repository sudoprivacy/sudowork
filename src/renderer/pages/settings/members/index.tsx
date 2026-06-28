import React, { useState, useEffect, useCallback } from 'react';
import { Table, Button, Tabs, Tag, Space, Message, Modal, Badge } from '@arco-design/web-react';
import { IconDelete } from '@arco-design/web-react/icon';
import { User, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import PageWrapper from '@renderer/components/base/PageWrapper';
import { useAuth } from '../../../context/AuthContext';

const MemberManagement: React.FC = () => {
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState('pending');
  const [loading, setLoading] = useState(false);

  const [pendingUsers, setPendingUsers] = useState<any[]>([]);
  const [approvedUsers, setApprovedUsers] = useState<any[]>([]);

  const fetchMembers = useCallback(async () => {
    if (!currentUser?.token) return;

    setLoading(true);
    try {
      const serverConfig = await ipcBridge.sudoworkServer.getConfig.invoke();
      const res = await fetch(`${serverConfig.baseUrl}/api/v1/admin/members`, {
        headers: { Authorization: `Bearer ${currentUser?.token}` },
      });
      const data = await res.json();
      console.log('[Admin] Members raw data:', data);
      if (data.success && Array.isArray(data.data)) {
        setPendingUsers(data.data.filter((u: any) => Number(u.status) === 0));
        setApprovedUsers(data.data.filter((u: any) => Number(u.status) === 1));
      }
    } catch (e) {
      console.error('Failed to fetch members:', e);
    }
    setLoading(false);
  }, [currentUser?.token]);

  useEffect(() => {
    void fetchMembers();
  }, [fetchMembers]);

  const handleApprove = (user: any) => {
    Modal.confirm({
      title: t('settings.memberApproveConfirmTitle', '确认审批通过'),
      content: t('settings.memberApproveConfirmContent', { name: user.nickname, defaultValue: '同意 "{{name}}" 加入企业并分配 Sudorouter API Key 吗？' }),
      onOk: async () => {
        try {
          const serverConfig = await ipcBridge.sudoworkServer.getConfig.invoke();
          const res = await fetch(`${serverConfig.baseUrl}/api/v1/admin/approve`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${currentUser?.token}`,
            },
            body: JSON.stringify({ userId: user.id }),
          });
          const data = await res.json();
          if (data.success) {
            Message.success(t('settings.memberApproveSuccess', { name: user.nickname, defaultValue: '已批准 {{name}}，Key 已下发。' }));
            void fetchMembers();
          }
        } catch {
          Message.error(t('settings.memberApproveFailed', '审批失败'));
        }
      },
    });
  };

  const handleReject = (user: any) => {
    Modal.confirm({
      title: t('settings.memberRejectConfirmTitle', '确认拒绝申请'),
      content: t('settings.memberRejectConfirmContent', { name: user.nickname, defaultValue: '确定要拒绝 "{{name}}" 的加入申请吗？拒绝后用户将无法登录。' }),
      okText: t('settings.memberRejectButton', '拒绝'),
      okButtonProps: { status: 'danger' },
      onOk: async () => {
        try {
          const serverConfig = await ipcBridge.sudoworkServer.getConfig.invoke();
          const res = await fetch(`${serverConfig.baseUrl}/api/v1/admin/reject`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${currentUser?.token}`,
            },
            body: JSON.stringify({ userId: user.id }),
          });
          const data = await res.json();
          if (data.success) {
            Message.success(t('settings.memberRejectSuccess', { name: user.nickname, defaultValue: '已拒绝 {{name}} 的申请。' }));
            void fetchMembers();
          }
        } catch {
          Message.error(t('settings.memberRejectFailed', '拒绝失败'));
        }
      },
    });
  };

  const handleDelete = (user: any) => {
    Modal.confirm({
      title: t('settings.memberDeleteConfirmTitle', '确认删除用户'),
      content: t('settings.memberDeleteConfirmContent', { name: user.nickname, defaultValue: '确定要删除 "{{name}}" 吗？删除后用户将无法登录，相关数据将被清空。' }),
      okText: t('settings.memberDeleteButton', '删除'),
      okButtonProps: { status: 'danger' },
      onOk: async () => {
        try {
          const serverConfig = await ipcBridge.sudoworkServer.getConfig.invoke();
          const res = await fetch(`${serverConfig.baseUrl}/api/v1/admin/delete`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${currentUser?.token}`,
            },
            body: JSON.stringify({ userId: user.id }),
          });
          const data = await res.json();
          if (data.success) {
            Message.success(t('settings.memberDeleteSuccess', { name: user.nickname, defaultValue: '已删除用户 {{name}}。' }));
            void fetchMembers();
          } else {
            Message.error(data.msg || t('settings.memberDeleteFailed', '删除失败'));
          }
        } catch {
          Message.error(t('settings.memberDeleteFailed', '删除失败'));
        }
      },
    });
  };

  const pendingColumns = [
    {
      title: t('settings.memberApplicant', '申请人'),
      dataIndex: 'nickname',
      render: (val: string) => (
        <Space>
          <User size={14} />
          <span className='font-500'>{val}</span>
        </Space>
      ),
    },
    {
      title: t('settings.memberContact', '联系方式'),
      dataIndex: 'phone',
    },
    {
      title: t('settings.memberActions', '操作'),
      align: 'right' as const,
      render: (_: any, record: any) => (
        <Space>
          <Button type='primary' size='small' onClick={() => handleApprove(record)}>
            {t('settings.memberApproveButton', '同意')}
          </Button>
          <Button type='secondary' size='small' status='danger' onClick={() => handleReject(record)}>
            {t('settings.memberRejectButton', '拒绝')}
          </Button>
        </Space>
      ),
    },
  ];

  const approvedColumns = [
    {
      title: t('settings.memberColumnName', '成员'),
      dataIndex: 'nickname',
    },
    {
      title: t('settings.memberRole', '角色'),
      dataIndex: 'role',
      render: (r: string) => <Tag color={r === 'ADMIN' ? 'gold' : 'blue'}>{r}</Tag>,
    },
    {
      title: t('settings.memberApiKey', 'API Key'),
      dataIndex: 'api_key',
      render: (k: string) => <code className='text-11px'>{k || t('settings.memberApiKeyNotIssued', '未下发')}</code>,
    },
    {
      title: t('settings.memberManage', '管理'),
      align: 'right' as const,
      render: (_: any, record: any) => record.role !== 'ADMIN' && <Button type='text' status='danger' icon={<IconDelete />} onClick={() => handleDelete(record)} />,
    },
  ];

  return (
    <PageWrapper
      title={t('settings.memberManagement', { defaultValue: '成员管理' })}
      subtitle={t('settings.memberManagementDescription', { defaultValue: '管理企业成员加入申请及 API 权限分配' })}
      actions={
        <Badge count={pendingUsers.length} dot={pendingUsers.length > 0} className='mt-1'>
          <div className='p-2 bg-control rd-8px'>
            <Users size={20} className='text-secondary' />
          </div>
        </Badge>
      }
    >
      <div className='flex flex-col gap-6 py-2'>
        <Tabs activeTab={activeTab} onChange={setActiveTab} type='capsule'>
          <Tabs.TabPane key='pending' title={t('settings.memberPendingTab', { count: pendingUsers.length, defaultValue: '待审批 ({{count}})' })}>
            <div className='mt-4 bg-muted min-h-50'>
              <Table loading={loading} data={pendingUsers} columns={pendingColumns} rowKey='id' pagination={false} className='[&_.arco-table-th]:bg-transparent' />
            </div>
          </Tabs.TabPane>

          <Tabs.TabPane key='approved' title={t('settings.memberApprovedTab', '正式成员')}>
            <div className='mt-4 bg-muted min-h-50'>
              <Table loading={loading} data={approvedUsers} columns={approvedColumns} rowKey='id' pagination={false} className='[&_.arco-table-th]:bg-transparent' />
            </div>
          </Tabs.TabPane>
        </Tabs>
      </div>
    </PageWrapper>
  );
};

export default MemberManagement;
