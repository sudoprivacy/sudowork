import { Alert, Button, Drawer, Tag, Typography } from '@arco-design/web-react';
import { Bot, ArrowUpRight, RefreshCw } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { emitter } from '@renderer/utils/emitter';
import styles from '@renderer/components/MossCatalogBrowser.module.css';
import { newExternalConversationPath } from './navigation';
import { useExternalDirectory } from './useExternalDirectory';

const Management = lazy(() => import('./ExternalAgentManagement'));

export default function PublishedExternalAgents({ query = '' }: IPublishedExternalAgentsProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { agents, access, identity, isLoading, isFailed, onRefresh } = useExternalDirectory();
  const [isManagementOpen, setIsManagementOpen] = useState(false);
  if (!identity || (!isLoading && !isFailed && !agents.length && !access?.can_manage)) return null;
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
          {access?.can_manage && <Button onClick={() => setIsManagementOpen(true)}>{t('agent.external.manage.title')}</Button>}
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
                <Tag>{agent.provider === 'dify' ? 'Dify' : agent.provider}</Tag>
              </div>
              <p className={styles.description}>{t('agent.external.published.scope')}</p>
              <div className={styles.actions}>
                <Button type='primary' icon={<ArrowUpRight size={14} />} onClick={() => void navigate(newExternalConversationPath(agent.id))}>
                  {t('agent.external.published.start')}
                </Button>
              </div>
            </article>
          ))}
      </div>
      {!isLoading && !isFailed && !agents.length && access?.can_manage && <Typography.Paragraph type='secondary'>{t('agent.external.published.empty')}</Typography.Paragraph>}
      <Drawer key={identity} title={t('agent.external.manage.title')} width={880} visible={isManagementOpen && Boolean(access?.can_manage)} onCancel={() => setIsManagementOpen(false)} footer={null} unmountOnExit>
        {isManagementOpen && access?.can_manage && (
          <Suspense fallback={null}>
            <Management
              isPlatformAdmin={access.can_manage_policy}
              isCredentialStorageAvailable={access.credential_storage_available}
              onChanged={async () => {
                emitter.emit('chat.history.refresh');
                await onRefresh();
              }}
            />
          </Suspense>
        )}
      </Drawer>
    </section>
  );
}

interface IPublishedExternalAgentsProps {
  query?: string;
}
