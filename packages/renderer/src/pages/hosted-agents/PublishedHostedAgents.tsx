import { Alert, Button, Tag, Typography } from '@arco-design/web-react';
import { Bot, ArrowUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import styles from '@renderer/components/MossCatalogBrowser.module.css';
import { useHostedDirectory } from './useHostedDirectory';
import { newHostedConversationPath } from './navigation';

export default function PublishedHostedAgents({ query = '' }: IPublishedHostedAgentsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { agents, identity, isFailed } = useHostedDirectory();
  if (!identity) return null;
  return (
    <>
      {isFailed && <Alert className='col-span-full' type='warning' content={t('settings.mossCatalog.serviceUnavailable')} />}
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
            <div className={styles.actions}>
              <Button type='primary' icon={<ArrowUpRight size={14} />} onClick={() => void navigate(newHostedConversationPath(agent.id))}>
                {t('settings.mossCatalog.use')}
              </Button>
            </div>
          </article>
        ))}
    </>
  );
}
interface IPublishedHostedAgentsProps {
  query?: string;
}
