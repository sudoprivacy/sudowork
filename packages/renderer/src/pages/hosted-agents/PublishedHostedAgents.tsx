import { Alert, Button, Tag, Typography } from '@arco-design/web-react';
import { Bot, ArrowUpRight, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import styles from '@renderer/components/MossCatalogBrowser.module.css';
import { useHostedDirectory } from './useHostedDirectory';
import { newHostedConversationPath } from './navigation';

export default function PublishedHostedAgents({ query = '' }: IPublishedHostedAgentsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { agents, identity, isLoading, isFailed, onRefresh } = useHostedDirectory();
  if (!identity) return null;
  return (
    <section aria-label={t('agent.hosted.directory')} className='shrink-0 mb-4'>
      <div className='flex items-center justify-between gap-3 mb-3'>
        <Typography.Text type='secondary'>{t('agent.hosted.description')}</Typography.Text>
        <Button aria-label={t('agent.external.refresh')} icon={<RefreshCw size={16} />} loading={isLoading} onClick={() => void onRefresh()} />
      </div>
      {isFailed && <Alert type='warning' content={t('agent.hosted.unavailable')} />}
      <div className={styles.grid}>
        {agents
          .filter((agent) => agent.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
          .map((agent) => (
            <article key={agent.id} className={styles.card}>
              <div className={styles.cardHeading}>
                <Bot size={24} />
                <Typography.Text bold>{agent.name}</Typography.Text>
                <Tag>{agent.source_platform}</Tag>
              </div>
              <p className={styles.description}>{agent.description}</p>
              <Typography.Text type='secondary'>{t('agent.hosted.version', { version: agent.version })}</Typography.Text>
              <p className={styles.description}>{t('agent.hosted.synthetic')}</p>
              <div className={styles.actions}>
                <Button type='primary' icon={<ArrowUpRight size={14} />} onClick={() => void navigate(newHostedConversationPath(agent.id))}>
                  {t('agent.external.published.start')}
                </Button>
              </div>
            </article>
          ))}
      </div>
    </section>
  );
}
interface IPublishedHostedAgentsProps {
  query?: string;
}
