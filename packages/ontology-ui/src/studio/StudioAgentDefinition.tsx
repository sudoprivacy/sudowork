import { useState } from 'react';
import { Button, Card, Form, Input, Message, Modal, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { IOntologyAgentDefinition, IOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import type { IOntologyStudioApi } from './api';

export default function StudioAgentDefinition({ snapshot, onSave, onRefresh, onError, isDisabled }: IStudioAgentDefinitionProps) {
  const { t } = useTranslation();
  const text = (key: string) => t('ontology.studio.' + key);
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form] = Form.useForm<IOntologyAgentDefinition>();
  const onSubmit = async () => {
    const definition = await form.validate().catch((): undefined => undefined);
    if (!definition || isSaving) return;
    setIsSaving(true);
    try {
      await onSave({ workspaceId: snapshot.workspaceId, expectedRevision: snapshot.revision || 0, definition });
      await onRefresh();
      setIsOpen(false);
      Message.success(text('saved'));
    } catch (error) {
      onError(error);
    } finally {
      setIsSaving(false);
    }
  };
  return (
    <Card
      title={text('portableAgent')}
      className='mb-4'
      extra={
        <Button
          disabled={isDisabled}
          onClick={() => {
            form.setFieldsValue(snapshot.agentDefinition || { name: snapshot.draft.title, description: snapshot.draft.description, instructions: text('defaultAgentInstructions') });
            setIsOpen(true);
          }}
        >
          {text('edit')}
        </Button>
      }
    >
      <Typography.Paragraph>{text('portableAgentHint')}</Typography.Paragraph>
      {snapshot.agentDefinition && <Typography.Text>{snapshot.agentDefinition.name}</Typography.Text>}
      {snapshot.packageIdentity?.source && <Typography.Paragraph type='secondary'>{t('ontology.studio.packageSourceVersion', { version: snapshot.packageIdentity.source.version })}</Typography.Paragraph>}
      <Modal
        visible={isOpen}
        title={text('portableAgent')}
        onCancel={() => {
          if (!isSaving) setIsOpen(false);
        }}
        onOk={onSubmit}
        confirmLoading={isSaving}
        maskClosable={!isSaving}
        style={{ width: 'min(760px, 92vw)' }}
      >
        <Form form={form} layout='vertical'>
          <Form.Item field='name' label={text('name')} rules={[{ required: true }]}>
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item field='description' label={text('description')}>
            <Input.TextArea />
          </Form.Item>
          <Form.Item field='instructions' label={text('agentInstructions')} rules={[{ required: true }]}>
            <Input.TextArea autoSize={{ minRows: 8, maxRows: 20 }} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}

interface IStudioAgentDefinitionProps {
  snapshot: IOntologyWorkbenchSnapshot;
  onSave: NonNullable<IOntologyStudioApi['updateAgentDefinition']>;
  onRefresh: () => Promise<void>;
  onError: (error: unknown) => void;
  isDisabled: boolean;
}
