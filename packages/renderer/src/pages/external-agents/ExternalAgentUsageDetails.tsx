import { Collapse, Typography } from '@arco-design/web-react';
import type { ExternalAgent } from '@sudowork/contracts/external-provider';
import { useTranslation } from 'react-i18next';

export default function ExternalAgentUsageDetails({ agent }: IExternalAgentUsageDetailsProps) {
  const { t } = useTranslation();
  const usage = agent.usage;
  return (
    <Collapse bordered={false} className='my-2'>
      <Collapse.Item name='usage' header={t('agent.external.usage.title')}>
        {usage ? (
          <div className='text-xs'>
            <Typography.Paragraph>{t('agent.external.usage.scope')}</Typography.Paragraph>
            {agent.conversation_mode === 'single_turn' && <Typography.Paragraph>{t('agent.external.protocol.singleTurn')}</Typography.Paragraph>}
            <Typography.Paragraph>{t('agent.external.usage.classification')}</Typography.Paragraph>
            <dl className='grid grid-cols-2 gap-2 mb-3'>
              {(['streaming', 'cancel', 'resume', 'version_pin'] as const).map((key) => (
                <div key={key}>
                  <dt>{t(`agent.external.usage.${key}`)}</dt>
                  <dd className='m-0'>{t(`agent.external.usage.${agent.capabilities[key]}`)}</dd>
                </div>
              ))}
              <div>
                <dt>{t('agent.external.usage.review')}</dt>
                <dd className='m-0'>{t(`agent.external.usage.${usage.review_state}`)}</dd>
              </div>
              <div>
                <dt>{t('agent.external.usage.reviewedAt')}</dt>
                <dd className='m-0'>{usage.reviewed_at === null ? t('agent.external.usage.notRecorded') : new Date(usage.reviewed_at).toLocaleString()}</dd>
              </div>
              <div>
                <dt>{t('agent.external.usage.evaluatedAt')}</dt>
                <dd className='m-0'>{new Date(usage.evaluated_at).toLocaleString()}</dd>
              </div>
            </dl>
            <Typography.Paragraph type='secondary'>{t('agent.external.usage.basis')}</Typography.Paragraph>
            <Typography.Paragraph type='secondary'>{t('agent.external.usage.evidence')}</Typography.Paragraph>
          </div>
        ) : (
          <Typography.Paragraph type='secondary'>{t('agent.external.usage.unavailable')}</Typography.Paragraph>
        )}
      </Collapse.Item>
    </Collapse>
  );
}

interface IExternalAgentUsageDetailsProps {
  agent: ExternalAgent;
}
