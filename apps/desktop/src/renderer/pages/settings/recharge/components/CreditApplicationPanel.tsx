import { Button, Form, Input, InputNumber, Message, Spin, Tag } from '@arco-design/web-react';
import { RefreshCw, Send } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import { useAuth } from '@/renderer/context/AuthContext';
import type { CreditApplication, CreditApplicationStatus } from '../types';

const STATUS_COLOR: Record<CreditApplicationStatus, string> = {
  PENDING: 'orange',
  PROCESSING: 'blue',
  APPROVED: 'green',
  REJECTED: 'red',
  SYNC_FAILED: 'red',
  SYNC_UNKNOWN: 'purple',
};

export default function CreditApplicationPanel({ onSubmitted }: ICreditApplicationPanelProps) {
  const { t } = useTranslation();
  const { user: currentUser, ensureValidToken } = useAuth();
  const [form] = Form.useForm();
  const [applications, setApplications] = useState<CreditApplication[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const statusText = useMemo<Record<CreditApplicationStatus, string>>(
    () => ({
      PENDING: t('settings.creditApplication.status.pending', '待审批'),
      PROCESSING: t('settings.creditApplication.status.processing', '处理中'),
      APPROVED: t('settings.creditApplication.status.approved', '已通过'),
      REJECTED: t('settings.creditApplication.status.rejected', '已拒绝'),
      SYNC_FAILED: t('settings.creditApplication.status.syncFailed', '同步失败'),
      SYNC_UNKNOWN: t('settings.creditApplication.status.syncUnknown', '待人工核对'),
    }),
    [t]
  );

  const fetchApplications = useCallback(async () => {
    if (!currentUser?.token) return;
    setIsLoading(true);
    try {
      const serverConfig = await ipcBridge.sudoworkServer.getConfig.invoke();
      const token = await ensureValidToken();
      if (!token) return;
      const response = await fetch(`${serverConfig.baseUrl}/api/v1/credit-applications?page=1&pageSize=50`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (data.success) {
        setApplications(data.data?.list || []);
        return;
      }
      Message.error(data.msg || t('settings.creditApplication.loadFailed', '加载积分申请失败'));
    } catch (error) {
      console.error('Failed to fetch credit applications:', error);
      Message.error(t('settings.creditApplication.loadFailed', '加载积分申请失败'));
    } finally {
      setIsLoading(false);
    }
  }, [currentUser?.token, ensureValidToken, t]);

  useEffect(() => {
    void fetchApplications();
  }, [fetchApplications]);

  const onSubmit = async (values: { requested_points: number; reason: string }) => {
    if (!currentUser?.token) return;
    setIsSubmitting(true);
    try {
      const serverConfig = await ipcBridge.sudoworkServer.getConfig.invoke();
      const token = await ensureValidToken();
      if (!token) return;
      const response = await fetch(`${serverConfig.baseUrl}/api/v1/credit-applications`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requested_points: values.requested_points,
          reason: values.reason,
        }),
      });
      const data = await response.json();
      if (!data.success) {
        Message.error(data.msg || t('settings.creditApplication.submitFailed', '提交申请失败'));
        return;
      }
      Message.success(t('settings.creditApplication.submitSuccess', '申请已提交'));
      form.resetFields();
      await fetchApplications();
      onSubmitted?.();
    } catch (error) {
      console.error('Failed to submit credit application:', error);
      Message.error(t('settings.creditApplication.submitFailed', '提交申请失败'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className='p-6 bg-muted rd-16px border border-light'>
      <div className='text-14px font-600 text-foreground mb-4'>{t('settings.creditApplication.title', '积分申请')}</div>
      <Form form={form} layout='vertical' onSubmit={onSubmit}>
        <Form.Item field='requested_points' label={t('settings.creditApplication.points', '申请积分')} rules={[{ required: true, message: t('settings.creditApplication.pointsRequired', '请输入申请积分') }]}>
          <InputNumber min={1} precision={0} className='w-full' />
        </Form.Item>
        <Form.Item field='reason' label={t('settings.creditApplication.reason', '申请原因')} rules={[{ required: true, message: t('settings.creditApplication.reasonRequired', '请输入申请原因') }]}>
          <Input.TextArea maxLength={500} showWordLimit autoSize={{ minRows: 3, maxRows: 5 }} />
        </Form.Item>
        <div className='flex justify-end'>
          <Button type='primary' htmlType='submit' loading={isSubmitting} icon={<Send size={16} />}>
            {t('settings.creditApplication.submit', '提交申请')}
          </Button>
        </div>
      </Form>

      <div className='mt-6 border-t border-light pt-4'>
        <div className='flex items-center justify-between mb-3'>
          <div className='text-14px font-600 text-foreground'>{t('settings.creditApplication.history', '申请记录')}</div>
          <Button type='text' size='mini' icon={<RefreshCw size={14} />} onClick={() => void fetchApplications()} />
        </div>
        {isLoading ? (
          <div className='f-center py-6'>
            <Spin />
          </div>
        ) : applications.length === 0 ? (
          <div className='py-6 text-center text-tertiary text-14px'>{t('settings.creditApplication.empty', '暂无申请记录')}</div>
        ) : (
          <div className='space-y-2'>
            {applications.map((item) => (
              <div key={item.id} className='flex items-center gap-3 p-3 bg-emphasis rd-8px'>
                <div className='flex-1 min-w-0'>
                  <div className='text-13px text-foreground truncate'>{item.application_no}</div>
                  <div className='text-12px text-secondary truncate'>{item.reason}</div>
                </div>
                <div className='text-14px text-primary font-500'>{item.requested_points.toLocaleString()} PTS</div>
                <Tag color={STATUS_COLOR[item.status] || 'gray'}>{statusText[item.status] || item.status}</Tag>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface ICreditApplicationPanelProps {
  onSubmitted?: () => void;
}
