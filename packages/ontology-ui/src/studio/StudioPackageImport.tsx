import { useRef, useState } from 'react';
import { Alert, Checkbox, Descriptions, Form, Input, Modal, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { IOntologyPackagePreview, IOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import type { IOntologyStudioApi } from './api';

export default function StudioPackageImport({ filePath, preview, api, onClose, onImported, onError }: IStudioPackageImportProps) {
  const { t } = useTranslation();
  const text = (key: string) => t('ontology.studio.' + key);
  const [name, setName] = useState(preview.manifest.name);
  const [isFork, setIsFork] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const isPending = useRef(false);
  const onImport = async () => {
    if (isPending.current || !name.trim()) return;
    isPending.current = true;
    setIsImporting(true);
    try {
      const snapshot = await api.import({ filePath, fingerprint: preview.fingerprint, name: name.trim(), isFork });
      onImported(snapshot);
    } catch (error) {
      onError(error);
    } finally {
      isPending.current = false;
      setIsImporting(false);
    }
  };
  return (
    <Modal
      visible
      title={text('packageImportTitle')}
      onCancel={() => {
        if (!isPending.current) onClose();
      }}
      onOk={onImport}
      okText={text('import')}
      confirmLoading={isImporting}
      okButtonProps={{ disabled: !name.trim() }}
      cancelButtonProps={{ disabled: isImporting }}
      maskClosable={!isImporting}
      escToExit={!isImporting}
      style={{ width: 'min(680px, 90vw)' }}
    >
      <div className='flex flex-col gap-4'>
        <Alert type='info' content={text('packageImportHint')} />
        <Form layout='vertical'>
          <Form.Item label={text('name')}>
            <Input aria-label={text('name')} value={name} onChange={setName} maxLength={200} disabled={isImporting} />
          </Form.Item>
        </Form>
        <Descriptions
          column={2}
          data={[
            { label: text('version'), value: preview.manifest.version },
            { label: text('objects'), value: preview.objectCount },
            { label: text('relations'), value: preview.relationCount },
            { label: text('capabilities'), value: preview.capabilities.length },
          ]}
        />
        <Typography.Text>{preview.agent.name}</Typography.Text>
        <Typography.Paragraph>{preview.agent.description}</Typography.Paragraph>
        <Checkbox checked={isFork} onChange={setIsFork} disabled={isImporting}>
          {text('packageImportFork')}
        </Checkbox>
        {!!preview.missingBindings.length && <Alert type='warning' content={t('ontology.studio.packageBindingsRequired', { count: preview.missingBindings.length })} />}
      </div>
    </Modal>
  );
}

interface IStudioPackageImportProps {
  filePath: string;
  preview: IOntologyPackagePreview;
  api: NonNullable<IOntologyStudioApi['packageImport']>;
  onClose: () => void;
  onImported: (snapshot: IOntologyWorkbenchSnapshot) => void;
  onError: (error: unknown) => void;
}
