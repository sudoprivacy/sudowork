import React, { useState, useEffect } from 'react';
import { Table, Button, Tabs, Tag, Space, Message, Modal, Badge } from '@arco-design/web-react';
import { IconDelete } from '@arco-design/web-react/icon';
import { User, Peoples } from '@icon-park/react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import PageWrapper from '@renderer/components/base/PageWrapper';
import { useAuth } from '../../context/AuthContext';

const MemberManagement: React.FC = () => {
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState('pending');
  const [loading, setLoading] = useState(false);

  const [pendingUsers, setPendingUsers] = useState<any[]>([]);
  const [approvedUsers, setApprovedUsers] = useState<any[]>([]);

  const fetchMembers = async () => {
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
  };

  useEffect(() => {
    if (currentUser?.token) void fetchMembers();
  }, [currentUser]);

  const handleApprove = (user: any) => {
    Modal.confirm({
      title: '确认审批通过',
      content: `同意 "${user.nickname}" 加入企业并分配 Sudorouter API Key 吗？`,
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
            Message.success(`已批准 ${user.nickname}，Key 已下发。`);
            void fetchMembers();
          }
        } catch {
          Message.error('审批失败');
        }
      },
    });
  };

  const handleReject = (user: any) => {
    Modal.confirm({
      title: '确认拒绝申请',
      content: `确定要拒绝 "${user.nickname}" 的加入申请吗？拒绝后用户将无法登录。`,
      okText: '拒绝',
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
            Message.success(`已拒绝 ${user.nickname} 的申请。`);
            void fetchMembers();
          }
        } catch {
          Message.error('拒绝失败');
        }
      },
    });
  };

  const handleDelete = (user: any) => {
    Modal.confirm({
      title: '确认删除用户',
      content: `确定要删除 "${user.nickname}" 吗？删除后用户将无法登录，相关数据将被清空。`,
      okText: '删除',
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
            Message.success(`已删除用户 ${user.nickname}。`);
            void fetchMembers();
          } else {
            Message.error(data.msg || '删除失败');
          }
        } catch {
          Message.error('删除失败');
        }
      },
    });
  };

  const pendingColumns = [
    {
      title: '申请人',
      dataIndex: 'nickname',
      render: (val: string) => (
        <Space>
          <User theme='outline' size='14' />
          <span className='font-500'>{val}</span>
        </Space>
      ),
    },
    {
      title: '联系方式',
      dataIndex: 'phone',
    },
    {
      title: '操作',
      align: 'right' as const,
      render: (_: any, record: any) => (
        <Space>
          <Button type='primary' size='small' onClick={() => handleApprove(record)}>
            同意
          </Button>
          <Button type='secondary' size='small' status='danger' onClick={() => handleReject(record)}>
            拒绝
          </Button>
        </Space>
      ),
    },
  ];

  const approvedColumns = [
    {
      title: '成员',
      dataIndex: 'nickname',
    },
    {
      title: '角色',
      dataIndex: 'role',
      render: (r: string) => <Tag color={r === 'ADMIN' ? 'gold' : 'blue'}>{r}</Tag>,
    },
    {
      title: 'API Key',
      dataIndex: 'api_key',
      render: (k: string) => <code className='text-11px'>{k || '未下发'}</code>,
    },
    {
      title: '管理',
      align: 'right' as const,
      render: (_: any, record: any) => record.role !== 'ADMIN' && <Button type='text' status='danger' icon={<IconDelete />} onClick={() => handleDelete(record)} />,
    },
  ];

  return (
    <PageWrapper contentClassName='max-w-225'>
      <div className='flex flex-col gap-6 py-2'>
        <div className='flex items-center justify-between'>
          <div className='flex flex-col gap-1'>
            <div className='text-20px font-600 text-foreground leading-32px'>{t('settings.memberManagement', { defaultValue: '成员管理' })}</div>
            <div className='text-13px text-secondary'>管理企业成员加入申请及 API 权限分配</div>
          </div>
          <Badge count={pendingUsers.length} dot={pendingUsers.length > 0}>
            <div className='p-2 bg-fill-2 rd-8px'>
              <Peoples size='20' className='text-secondary' />
            </div>
          </Badge>
        </div>

        <Tabs activeTab={activeTab} onChange={setActiveTab} type='capsule'>
          <Tabs.TabPane key='pending' title={`待审批 (${pendingUsers.length})`}>
            <div className='mt-4 bg-muted rd-16px border overflow-hidden min-h-50'>
              <Table loading={loading} data={pendingUsers} columns={pendingColumns} rowKey='id' pagination={false} className='[&_.arco-table-th]:bg-transparent' />
            </div>
          </Tabs.TabPane>

          <Tabs.TabPane key='approved' title='正式成员'>
            <div className='mt-4 bg-muted rd-16px border overflow-hidden min-h-50'>
              <Table loading={loading} data={approvedUsers} columns={approvedColumns} rowKey='id' pagination={false} className='[&_.arco-table-th]:bg-transparent' />
            </div>
          </Tabs.TabPane>
        </Tabs>
      </div>
    </PageWrapper>
  );
};

export default MemberManagement;
