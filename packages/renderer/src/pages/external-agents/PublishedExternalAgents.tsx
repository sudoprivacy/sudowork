import ExternalAgentUsageDetails from './ExternalAgentUsageDetails';
import { Alert, Button, Tag, Typography } from '@arco-design/web-react';
import { Bot, ArrowUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import styles from '@renderer/components/MossCatalogBrowser.module.css';
import { newExternalConversationPath } from './navigation';
import { useExternalDirectory } from './useExternalDirectory';

export default function PublishedExternalAgents({ query = '' }: IPublishedExternalAgentsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { agents, identity, isFailed } = useExternalDirectory(true);
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
                <Tag>{agent.protocol || (['dify', 'custom_http'].includes(agent.provider) ? t(`agent.external.provider.${agent.provider}`) : agent.provider)}</Tag>
              </div>
              {agent.publishedVersion && <Tag>{t('settings.mossCatalog.version')}: {agent.publishedVersion}</Tag>}
              <p className={styles.description}>{t('agent.external.published.scope')}</p>
              <ExternalAgentUsageDetails agent={agent} />
              <div className={styles.actions}>
                <Button type='primary' icon={<ArrowUpRight size={14} />} onClick={() => void navigate(newExternalConversationPath(agent.id))}>
                  {t('settings.mossCatalog.use')}
                </Button>
              </div>
            </article>
          ))}
    </>
  );
}

interface IPublishedExternalAgentsProps {
  query?: string;
}
