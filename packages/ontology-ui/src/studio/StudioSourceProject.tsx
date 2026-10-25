import type { ReactNode } from 'react';
import { Button, Card, Space, Tag, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { IOntologyStudioProject } from '@sudowork/ontology-common';
import styles from './studio.module.css';

/** A canonical project uses the existing chat, never the legacy RDF editor. */
export default function StudioSourceProject({ project, renderChat, onBack, onRefresh }: IStudioSourceProjectProps) {
  const { t } = useTranslation();
  const text = (key: string) => t(`ontology.studio.${key}`);
  const source = project.source;
  return (
    <div className={styles['ontology-source-project']}>
      <div className={styles['ontology-page-heading']}>
        <Space>
          <Button onClick={onBack}>{text('library')}</Button>
          <Typography.Title heading={4}>{project.name}</Typography.Title>
        </Space>
        <Button onClick={() => void onRefresh()}>{text('sourceRefresh')}</Button>
      </div>
      <Card title={text('sourceOverview')}>
        <Space wrap>
          {source ? (
            <>
              <Tag color={source.structureComplete ? 'green' : 'orange'}>{text(source.structureComplete ? 'sourceStructureComplete' : 'sourceStructureIncomplete')}</Tag>
              <Tag>{text(source.delivery === 'live' ? 'sourceLiveRecords' : source.delivery === 'snapshot' ? 'sourceSnapshotRecords' : 'sourceRecordsUnavailable')}</Tag>
            </>
          ) : (
            <Tag>{text('sourceReceiptMissing')}</Tag>
          )}
        </Space>
        {source && (
          <>
            <p>
              {t('ontology.studio.sourceCounts', {
                tables: source.tables,
                views: source.databaseViews,
                fields: source.fields,
              })}
            </p>
            <details>
              <summary>
                {text('sourceRevision')}: <code>{source.revision.slice(0, 12)}</code>
              </summary>
              <p>
                {text('sourceObservation')}: {source.observedAt || text('sourceObservationUnknown')}
              </p>
              <Typography.Text type='secondary'>{text('sourceObservationHint')}</Typography.Text>
            </details>
          </>
        )}
      </Card>
      <Typography.Paragraph style={{ marginTop: 16 }}>{text('sourceConversationHint')}</Typography.Paragraph>
      <div className={styles['ontology-chat-pane']}>{renderChat(project.workspaceId, project.name)}</div>
    </div>
  );
}

interface IStudioSourceProjectProps {
  project: IOntologyStudioProject;
  renderChat: (workspaceId: string, name: string) => ReactNode;
  onBack: () => void;
  onRefresh: () => Promise<void>;
}
