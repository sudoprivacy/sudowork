import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Empty, Modal, Space, Table, Tag, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ontologyFieldSignature } from '@sudowork/ontology-common';
import type { IOntologyEnvironmentAsset, IOntologyPreviewAssetResult } from '@sudowork/ontology-common';
import type { IOntologyStudioApi } from './api';
import styles from './studio.module.css';

export default function StudioAssetPreview({ asset, workspaceId, api, isSyncing, onSync, onRefresh, onClose }: IStudioAssetPreviewProps) {
  const { t, i18n } = useTranslation();
  const text = (key: string) => t(`ontology.studio.${key}`);
  const language = i18n.resolvedLanguage || i18n.language || 'zh-CN';
  const [preview, setPreview] = useState<IOntologyPreviewAssetResult>();
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isDescribing, setIsDescribing] = useState(false);
  const [isRefreshConfirmOpen, setIsRefreshConfirmOpen] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [meaningError, setMeaningError] = useState('');
  const attempted = useRef(new Set<string>());
  const isMounted = useRef(true);
  const schemaSignature = JSON.stringify(asset.fields.map(ontologyFieldSignature));
  const describedCount = asset.fields.filter((field) => field.businessMeaning?.text && field.businessMeaning.language === language).length;
  const isMissingMeanings = describedCount < asset.fields.length;
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);
  const errorText = useCallback(
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      return message.startsWith('ontology.') ? t(message) : message;
    },
    [t]
  );
  const onDescribe = useCallback(
    async (isRefresh = false) => {
      setIsDescribing(true);
      setMeaningError('');
      try {
        await api.describeAssetFields({ workspaceId, id: asset.id, language, isRefresh });
        if (isMounted.current) await onRefresh();
      } catch (error) {
        if (isMounted.current) setMeaningError(errorText(error));
      } finally {
        if (isMounted.current) setIsDescribing(false);
      }
    },
    [api, workspaceId, asset.id, language, onRefresh, errorText]
  );
  useEffect(() => {
    const key = `${language}:${schemaSignature}`;
    if (!isMissingMeanings || attempted.current.has(key)) return;
    attempted.current.add(key);
    void onDescribe();
  }, [language, schemaSignature, isMissingMeanings, onDescribe]);
  useEffect(() => {
    setPreview(undefined);
    setPreviewError('');
  }, [schemaSignature]);
  const onLoadPreview = async () => {
    setIsPreviewLoading(true);
    setPreviewError('');
    try {
      const result = await api.previewAsset({ workspaceId, id: asset.id, limit: 100 });
      if (isMounted.current) setPreview(result);
    } catch (error) {
      if (isMounted.current) setPreviewError(errorText(error));
    } finally {
      if (isMounted.current) setIsPreviewLoading(false);
    }
  };
  const columns = preview?.columns.length ? preview.columns : asset.fields.map((field) => field.name);
  return (
    <>
      <Modal visible title={t('ontology.studio.assetPreviewTitle', { name: asset.name })} onCancel={onClose} footer={null} style={{ width: 'min(1200px, 94vw)' }} className={styles['ontology-asset-preview']}>
        <div className={styles['ontology-asset-summary']}>
          <Space wrap>
            <Tag>{t(`ontology.assetKind.${asset.kind}`)}</Tag>
            <Typography.Text>{asset.sourceName}</Typography.Text>
            <Typography.Text type='secondary'>{t('ontology.studio.fieldCount', { count: asset.fields.length })}</Typography.Text>
          </Space>
          <Space wrap>
            <Typography.Text type='secondary'>
              {text('lastSynced')} {asset.metadata.schemaSyncedAt ? new Date(Number(asset.metadata.schemaSyncedAt)).toLocaleString(language) : text('notSynced')}
            </Typography.Text>
            <Button loading={isSyncing} disabled={isDescribing || isPreviewLoading} onClick={() => void onSync(asset)}>
              {text('sync')}
            </Button>
          </Space>
        </div>
        <section className={styles['ontology-preview-section']}>
          <div className={styles['ontology-section-heading']}>
            <div>
              <Typography.Title heading={6}>{text('fieldStructure')}</Typography.Title>
              <Typography.Text type='secondary'>{text('meaningHint')}</Typography.Text>
            </div>
            <Space wrap>
              <Typography.Text type='secondary'>{t('ontology.studio.meaningProgress', { count: describedCount, total: asset.fields.length })}</Typography.Text>
              <Button
                loading={isDescribing}
                disabled={!asset.fields.length || isSyncing}
                onClick={() => {
                  if (isMissingMeanings) void onDescribe();
                  else setIsRefreshConfirmOpen(true);
                }}
              >
                {isMissingMeanings ? text('completeMeanings') : text('refreshMeanings')}
              </Button>
            </Space>
          </div>
          {meaningError && <Alert type='error' content={meaningError} className={styles['ontology-preview-alert']} />}
          <Table
            rowKey='name'
            size='small'
            border={{ cell: true }}
            pagination={false}
            scroll={{ x: 1180, y: 340 }}
            data={asset.fields}
            noDataElement={<Empty description={text('noFields')} />}
            columns={[
              { title: text('fieldName'), dataIndex: 'name', width: 160, render: (value) => <span className={styles['ontology-field-name']}>{value}</span> },
              { title: text('dataType'), dataIndex: 'dataType', width: 140 },
              { title: text('nullable'), width: 100, render: (_value, field) => (field.nullable === undefined ? text('unknownValue') : field.nullable ? text('yes') : text('no')) },
              {
                title: text('fieldConstraints'),
                width: 180,
                render: (_value, field) => (
                  <Space direction='vertical' size='mini'>
                    {field.isPrimaryKey && (
                      <Tag>
                        {text('primaryKey')}
                        {field.primaryKeyPosition ? ` #${field.primaryKeyPosition}` : ''}
                      </Tag>
                    )}
                    {field.isGenerated && <Tag>{text('generatedColumn')}</Tag>}
                    {field.defaultValue !== undefined && <Typography.Text type='secondary'>{t('ontology.studio.fieldDefault', { value: field.defaultValue })}</Typography.Text>}
                    {field.references?.map((ref) => (
                      <Typography.Text key={`${ref.constraintId}:${ref.position}`} type='secondary'>
                        {t('ontology.studio.fieldReference', { table: ref.table, field: ref.field })}
                      </Typography.Text>
                    ))}
                    {!field.isPrimaryKey && !field.isGenerated && field.defaultValue === undefined && !field.references?.length && text('unknownValue')}
                  </Space>
                ),
              },
              { title: text('sourceDescription'), width: 250, render: (_value, field) => <span className={styles['ontology-field-description']}>{field.description || text('noDescription')}</span> },
              {
                title: text('businessMeaning'),
                width: 350,
                render: (_value, field) =>
                  field.businessMeaning?.language === language ? <div className={styles['ontology-field-description']}>{field.businessMeaning.text}</div> : <Typography.Text type='secondary'>{isDescribing ? text('meaningGenerating') : text('meaningPending')}</Typography.Text>,
              },
            ]}
          />
        </section>
        <section className={styles['ontology-preview-section']}>
          <div className={styles['ontology-section-heading']}>
            <div>
              <Typography.Title heading={6}>{text('sampleData')}</Typography.Title>
              <Typography.Text type='secondary'>
                {preview ? t('ontology.studio.sampleRows', { count: preview.rowsReturned }) : text('sampleHint')}
                {preview?.truncated ? ` · ${text('sampleTruncated')}` : ''}
              </Typography.Text>
            </div>
            <Button loading={isPreviewLoading} disabled={isSyncing} onClick={() => void onLoadPreview()}>
              {preview ? text('refreshSample') : text('preview100')}
            </Button>
          </div>
          {previewError && <Alert type='error' content={previewError} className={styles['ontology-preview-alert']} />}
          {preview ? (
            <Table
              rowKey='rowKey'
              size='small'
              border={{ cell: true }}
              pagination={{ pageSize: 10, sizeCanChange: false }}
              scroll={{ x: Math.max(900, columns.length * 180), y: 280 }}
              noDataElement={<Empty description={text('emptyTable')} />}
              columns={columns.map((column, index) => ({ title: column, dataIndex: `cell_${index}`, width: 180, ellipsis: true }))}
              data={preview.rows.map((row, index) => ({ rowKey: index, ...Object.fromEntries(row.map((cell, cellIndex) => [`cell_${cellIndex}`, cell === null ? text('nullValue') : String(cell)])) }))}
            />
          ) : (
            <div className={styles['ontology-sample-placeholder']}>{text('sampleNotLoaded')}</div>
          )}
        </section>
      </Modal>
      <Modal
        visible={isRefreshConfirmOpen}
        title={text('refreshMeanings')}
        onCancel={() => setIsRefreshConfirmOpen(false)}
        onOk={() => {
          setIsRefreshConfirmOpen(false);
          void onDescribe(true);
        }}
        unmountOnExit
      >
        {text('refreshMeaningsConfirm')}
      </Modal>
    </>
  );
}

interface IStudioAssetPreviewProps {
  asset: IOntologyEnvironmentAsset;
  workspaceId: string;
  api: IOntologyStudioApi;
  isSyncing: boolean;
  onSync: (asset: IOntologyEnvironmentAsset) => Promise<void>;
  onRefresh: () => Promise<void>;
  onClose: () => void;
}
