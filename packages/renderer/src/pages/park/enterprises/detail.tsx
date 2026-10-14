/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Card, Descriptions, Input, Message, Space, Tag, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useState } from 'react';
import { invokePark, useParkOrgId, useParkQuery } from '@renderer/hooks/usePark';
import PageWrapper from '@renderer/components/base/PageWrapper';

interface IEnterpriseDetail {
  enterprise_org_id: string;
  enterprise_name: string;
  industry: string | null;
  scale: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  assigned_owner_id: string | null;
  tags: string[];
  lifecycle: string;
  lead_summary: { total: number; by_status: Record<string, number> };
}

export default function ParkEnterpriseDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { enterpriseOrgId } = useParams<{ enterpriseOrgId: string }>();
  const { parkOrgId, role } = useParkOrgId();
  const { data, loading, error, reload } = useParkQuery<IEnterpriseDetail>(
    'getEnterpriseDetail',
    parkOrgId && enterpriseOrgId ? { parkOrgId, enterpriseOrgId } : undefined,
  );
  const [tagInput, setTagInput] = useState('');

  async function saveFollowUp() {
    if (!parkOrgId || !enterpriseOrgId) return;
    try {
      await invokePark('updateEnterpriseFollowUp', {
        parkOrgId,
        enterpriseOrgId,
        updates: tagInput.trim() ? { tags: tagInput.split(',').map(s => s.trim()).filter(Boolean) } : {},
      });
      Message.success(t('park.common.save', '保存'))
      reload()
    } catch (err) {
      Message.error(err instanceof Error ? err.message : t('park.leads.updateFailed', '操作失败'))
    }
  }

  return (
    <PageWrapper title={t('park.nav.enterpriseDetail', '企业画像')} back={{ onClick: () => navigate('/park/enterprises') }}>
      {error ? (
        <Typography.Text type='error'>{t('park.common.loadFailed', '加载失败')}: {error}</Typography.Text>
      ) : (
        <Card loading={loading}>
          <Descriptions
            column={2}
            data={[
              { label: t('park.enterprises.name', '企业名称'), value: data?.enterprise_name ?? '-' },
              {
                label: t('park.enterprises.lifecycle', '生命周期'),
                value: data ? <Tag>{t(`park.status.${data.lifecycle}`, data.lifecycle)}</Tag> : '-',
              },
              { label: t('park.enterprises.industry', '行业'), value: data?.industry ?? '-' },
              { label: t('park.enterprises.scale', '规模'), value: data?.scale ?? '-' },
              { label: t('park.enterprises.contactName', '联系人姓名'), value: data?.contact_name ?? '-' },
              { label: t('park.enterprises.contactPhone', '联系电话'), value: data?.contact_phone ?? '-' },
              { label: t('park.enterprises.assignedOwner', '负责运营'), value: data?.assigned_owner_id ?? '-' },
              { label: t('park.enterprises.tags', '标签'), value: (data?.tags ?? []).join(', ') || '-' },
              {
                label: t('park.enterprises.leadSummary', '线索汇总'),
                value: data?.lead_summary
                  ? `${data.lead_summary.total}（${Object.entries(data.lead_summary.by_status)
                      .map(([k, n]) => `${t(`park.status.${k}`, k)} ${n}`)
                      .join(' / ')}）`
                  : '-',
              },
            ]}
          />
          {role === 'park_ops' ? (
            <Space className='pt-4'>
              <Input
                className='w-64'
                placeholder={`${t('park.enterprises.followUp', '跟进信息')} (tags, comma-separated)`}
                value={tagInput}
                onChange={setTagInput}
              />
              <Button type='primary' size='small' onClick={() => void saveFollowUp()}>
                {t('park.common.save', '保存')}
              </Button>
            </Space>
          ) : null}
        </Card>
      )}
    </PageWrapper>
  );
}
