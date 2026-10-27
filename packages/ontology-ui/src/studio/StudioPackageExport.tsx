import { useEffect, useRef, useState } from 'react';
import { Alert, Checkbox, Message, Modal, Progress, Space, Spin, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { IOntologyPackageExportProgress, IOntologyPackageExportResult, IOntologyPackagePlan } from '@sudowork/ontology-common';
import type { IOntologyStudioApi } from './api';

export default function StudioPackageExport({ workspaceId, versionId, api, onClose, onError }: IStudioPackageExportProps) {
  const { t } = useTranslation();
  const [plan, setPlan] = useState<IOntologyPackagePlan>();
  const [error, setError] = useState('');
  const [embeddedResourceIds, setEmbeddedResourceIds] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<IOntologyPackageExportProgress>();
  const [exported, setExported] = useState<IOntologyPackageExportResult>();
  const requestId = useRef<string | undefined>(undefined);
  const text = (key: string) => t('ontology.studio.' + key);

  useEffect(() => {
    let isCancelled = false;
    void api
      .plan({ workspaceId, versionId })
      .then((result) => {
        if (!isCancelled) setPlan(result);
      })
      .catch((reason: unknown) => {
        if (!isCancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    const off = api.onProgress((event) => {
      if (!isCancelled && event.requestId === requestId.current) setProgress(event);
    });
    return () => {
      isCancelled = true;
      off();
    };
  }, [api, workspaceId, versionId]);

  const onExport = async () => {
    if (exported) return onClose();
    if (requestId.current || !plan) return;
    requestId.current = crypto.randomUUID();
    setIsExporting(true);
    try {
      const result = await api.export({ requestId: requestId.current, workspaceId, versionId, embeddedResourceIds });
      if (!result.isCancelled) {
        setExported(result);
        setProgress(undefined);
        Message.success(text('packageExportSuccess'));
      } else onClose();
    } catch (reason) {
      onError(reason);
    } finally {
      requestId.current = undefined;
      setIsExporting(false);
    }
  };

  const onCancel = () => {
    if (requestId.current) void api.cancel({ requestId: requestId.current }).catch(onError);
    else onClose();
  };

  return (
    <Modal
      visible
      title={text('exportRuntimePackage')}
      onCancel={onCancel}
      onOk={onExport}
      okText={text(exported ? 'packageDone' : 'export')}
      confirmLoading={isExporting}
      okButtonProps={{ disabled: !plan || !!error }}
      maskClosable={!isExporting}
      escToExit={!isExporting}
      style={{ width: 'min(680px, 90vw)' }}
      unmountOnExit
    >
      <Space direction='vertical' className='w-full' size='large'>
        <Typography.Paragraph>{text('packageExportDescription')}</Typography.Paragraph>
        {exported ? (
          <div className='flex flex-col gap-4'>
            <Alert type='success' content={text('packageExportSuccess')} />
            <Typography.Paragraph copyable style={{ overflowWrap: 'anywhere' }}>
              {exported.filePath}
            </Typography.Paragraph>
            {exported.fileBytes !== undefined && <Typography.Text>{t('ontology.studio.packageFileSize', { size: (exported.fileBytes / 1024 / 1024).toFixed(2) })}</Typography.Text>}
            {exported.runtimeVerification && <Typography.Text>{text('packageVerification.' + exported.runtimeVerification)}</Typography.Text>}
            {!!exported.requiresBindings?.length && <Alert type='info' content={t('ontology.studio.packageBindingsRequired', { count: exported.requiresBindings.length })} />}
            {exported.packageDigest && (
              <Typography.Paragraph copyable style={{ overflowWrap: 'anywhere' }}>
                {text('packageDigest')}: {exported.packageDigest}
              </Typography.Paragraph>
            )}
          </div>
        ) : error ? (
          <Alert type='error' content={error} />
        ) : !plan ? (
          <Spin />
        ) : (
          <div className='flex flex-col gap-4'>
            <Typography.Text>{t('ontology.studio.packageContents', { version: plan.version, count: plan.capabilities.length })}</Typography.Text>
            <Typography.Text>{text('packageEmbeddedResources')}</Typography.Text>
            <Space direction='vertical'>
              {plan.resources
                .filter((resource) => resource.provider === 'sqlite' || resource.provider === 'file')
                .map((resource) => (
                  <Checkbox key={resource.id} checked={embeddedResourceIds.includes(resource.id)} disabled={isExporting} onChange={(isChecked) => setEmbeddedResourceIds((current) => (isChecked ? [...current, resource.id] : current.filter((id) => id !== resource.id)))}>
                    {resource.name}
                  </Checkbox>
                ))}
            </Space>
            <Alert type='info' content={text('packageBindingsHint')} />
            <Space direction='vertical'>
              {plan.resources
                .filter((resource) => !embeddedResourceIds.includes(resource.id))
                .map((resource) => (
                  <Typography.Text key={resource.id} type='secondary'>
                    {resource.name} · {resource.provider}
                  </Typography.Text>
                ))}
            </Space>
          </div>
        )}
        {progress && <Progress percent={progress.total ? Math.round((progress.completed / progress.total) * 100) : 0} formatText={() => text('packagePhase.' + progress.phase)} />}
      </Space>
    </Modal>
  );
}

interface IStudioPackageExportProps {
  workspaceId: string;
  versionId: string;
  api: NonNullable<IOntologyStudioApi['runtimePackage']>;
  onClose: () => void;
  onError: (error: unknown) => void;
}
