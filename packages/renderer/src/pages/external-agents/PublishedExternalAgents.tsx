import ExternalAgentUsageDetails from './ExternalAgentUsageDetails';
import { Alert, Button, Tag, Typography } from '@arco-design/web-react';
import { Bot, ArrowUpRight, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import styles from '@renderer/components/MossCatalogBrowser.module.css';
import { newExternalConversationPath } from './navigation';
import { useExternalDirectory } from './useExternalDirectory';

export default function PublishedExternalAgents({ query = '' }: IPublishedExternalAgentsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { agents, identity, isLoading, isFailed, onRefresh } = useExternalDirectory();
  if (!identity) return null;
  return (
    <section aria-label={t('agent.external.published.title')} className='shrink-0 mb-4'>
      <div className='flex items-center justify-between gap-3 mb-3 flex-wrap'>
        <div>
          <Typography.Title heading={5} style={{ margin: 0 }}>
            {t('agent.external.published.title')}
          </Typography.Title>
          <Typography.Text type='secondary'>{t('agent.external.published.description')}</Typography.Text>
        </div>
        <div className='flex gap-2 items-center'>
          <Button aria-label={t('agent.external.refresh')} icon={<RefreshCw size={16} />} loading={isLoading} onClick={() => void onRefresh()} />
        </div>
      </div>
      {isFailed && <Alert type='warning' content={t('agent.external.loadFailed')} />}
      <div className={styles.grid}>
        {agents
          .filter((agent) => agent.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
          .map((agent) => (
            <article key={agent.id} className={styles.card}>
              <div className={styles.cardHeading}>
                <Bot size={24} />
                <Typography.Text bold>{agent.name}</Typography.Text>
                <Tag>{['dify', 'custom_http'].includes(agent.provider) ? t(`agent.external.provider.${agent.provider}`) : agent.provider}</Tag>
              </div>
              <p className={styles.description}>{t('agent.external.published.scope')}</p>
              <Typography.Text type='secondary'>{t('agent.external.sourceIdentityUnverified')}</Typography.Text>
              <ExternalAgentUsageDetails agent={agent} />
              <div className={styles.actions}>
                <Button type='primary' icon={<ArrowUpRight size={14} />} onClick={() => void navigate(newExternalConversationPath(agent.id))}>
                  {t('agent.external.published.start')}
                </Button>
              </div>
            </article>
          ))}
      </div>
      {!isLoading && !isFailed && !agents.length && <Typography.Paragraph type='secondary'>{t('agent.external.published.empty')}</Typography.Paragraph>}
    </section>
  );
}

interface IPublishedExternalAgentsProps {
  query?: string;
}
