/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Card, Descriptions, Input, Message, Modal, Space, Tag, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { useState } from 'react';
import { invokePark, useParkOrgId, useParkQuery } from '@renderer/hooks/usePark';
import PageWrapper from '@renderer/components/base/PageWrapper';

interface ILeadDetail {
  lead_id: string;
  enterprise_org_id: string;
  source: string;
  score: number | null;
  score_explanation: string | null;
  suggested_action: string | null;
  industry_tags: string[];
  status: string;
  owner_id: string | null;
  inquiry_summary: {
    inquiry_id: string;
    redacted_question: string | null;
    redacted_answer: string | null;
    intent: string | null;
    confidence: number | null;
    created_at: number;
  } | null;
}

export default function ParkLeadDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { leadId } = useParams<{ leadId: string }>();
  const { parkOrgId, role } = useParkOrgId();
  const { data, loading, error, reload } = useParkQuery<ILeadDetail>(
    'getLeadDetail',
    parkOrgId && leadId ? { parkOrgId, leadId } : undefined,
  );
  const [isRejectOpen, setIsRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  async function update(updates: Record<string, unknown>) {
    if (!parkOrgId || !leadId) return;
    try {
      await invokePark('updateLead', { parkOrgId, leadId, updates });
      reload()
    } catch (err) {
      Message.error(err instanceof Error ? err.message : t('park.leads.updateFailed', '操作失败'))
    }
  }

  async function reject() {
    if (!rejectReason.trim()) {
      Message.warning(t('park.leads.rejectReasonRequired', '请填写驳回理由'))
      return;
    }
    await update({ status: 'rejected', reason: rejectReason })
    setIsRejectOpen(false)
    setRejectReason('')
  }

  const status = data?.status

  return (
    <PageWrapper title={t('park.leads.leadDetail', '线索详情')} back={{ onClick: () => navigate('/park/leads') }}>
      {error ? (
        <Typography.Text type='error'>{t('park.common.loadFailed', '加载失败')}: {error}</Typography.Text>
      ) : (
        <div className='space-y-4'>
          <Card loading={loading}>
            <Descriptions
              column={2}
              data={[
                { label: t('park.common.enterprise', '企业'), value: data?.enterprise_org_id ?? '-' },
                {
                  label: t('park.common.status', '状态'),
                  value: status ? <Tag>{t(`park.status.${status}`, status)}</Tag> : '-',
                },
                { label: t('park.leads.source', '来源'), value: data ? t(`park.leads.${data.source}`, data.source) : '-' },
                { label: t('park.common.score', '评分'), value: data?.score ?? '-' },
                { label: t('park.leads.owner', '负责人'), value: data?.owner_id ?? t('park.leads.noOwner', '未认领') },
                { label: t('park.leads.industryTags', '行业标签'), value: (data?.industry_tags ?? []).join(', ') || '-' },
              ]}
            />
            {data?.score_explanation ? (
              <Typography.Text type='secondary' className='block pt-2 text-13px'>
                {t('park.leads.scoreExplanation', '评分依据')}: {data.score_explanation}
              </Typography.Text>
            ) : null}
            {data?.suggested_action ? (
              <Typography.Text className='block pt-1 text-13px'>
                {t('park.leads.suggestedAction', '建议动作')}: {data.suggested_action}
              </Typography.Text>
            ) : null}
            {role === 'park_ops' || role === 'park_leader' ? (
              <Space className='pt-3'>
                {status === 'proposed' && role === 'park_ops' ? (
                  <>
                    <Button type='primary' size='small' onClick={() => void update({ status: 'confirmed' })}>
                      {t('park.leads.confirmLead', '确认')}
                    </Button>
                    <Button status='danger' size='small' onClick={() => setIsRejectOpen(true)}>
                      {t('park.leads.reject', '驳回')}
                    </Button>
                  </>
                ) : null}
                {(status === 'proposed' || status === 'confirmed') && role === 'park_ops' ? (
                  <Button size='small' onClick={() => void invokePark('claimLead', { parkOrgId, leadId }).then(reload).catch(err => Message.error(String(err)))}>
                    {t('park.leads.claim', '认领')}
                  </Button>
                ) : null}
                {status === 'confirmed' ? (
                  <Button size='small' onClick={() => void update({ status: 'assigned' })}>
                    {t('park.leads.dispatch', '分派')}
                  </Button>
                ) : null}
                {status === 'assigned' ? (
                  <Button size='small' onClick={() => void update({ status: 'following_up' })}>
                    {t('park.status.following_up', '跟进中')}
                  </Button>
                ) : null}
                {status === 'following_up' ? (
                  <>
                    <Button type='primary' size='small' onClick={() => void update({ status: 'converted' })}>
                      {t('park.leads.convert', '转化')}
                    </Button>
                    <Button status='warning' size='small' onClick={() => void update({ status: 'lost' })}>
                      {t('park.leads.lost', '流失')}
                    </Button>
                  </>
                ) : null}
                {role === 'park_leader' ? (
                  <Button size='small' onClick={() => void invokePark('watchLead', { parkOrgId, leadId }).then(reload).catch(err => Message.error(String(err)))}>
                    {t('park.leads.watch', '关注')}
                  </Button>
                ) : null}
              </Space>
            ) : null}
          </Card>
          <Card title={t('park.leads.inquirySummary', '咨询摘要（脱敏）')} loading={loading}>
            {data?.inquiry_summary ? (
              <div className='space-y-2 text-13px'>
                <div>
                  <span className='text-secondary'>Q:</span> {data.inquiry_summary.redacted_question ?? '-'}
                </div>
                <div>
                  <span className='text-secondary'>A:</span> {data.inquiry_summary.redacted_answer ?? '-'}
                </div>
                <div className='text-secondary'>
                  {data.inquiry_summary.intent ?? '-'} · {t('park.consultations.confidence', '置信度')}{' '}
                  {data.inquiry_summary.confidence ?? '-'}
                </div>
              </div>
            ) : (
              <Typography.Text type='secondary'>{t('park.common.empty', '暂无数据')}</Typography.Text>
            )}
          </Card>
        </div>
      )}
      <Modal
        title={t('park.leads.reject', '驳回')}
        visible={isRejectOpen}
        onOk={() => void reject()}
        onCancel={() => setIsRejectOpen(false)}
      >
        <Input
          placeholder={t('park.leads.rejectReasonPlaceholder', '驳回理由（必填）')}
          value={rejectReason}
          onChange={setRejectReason}
        />
      </Modal>
    </PageWrapper>
  );
}
