import { useRef, useState } from 'react';
import { Alert, Form, Input, Modal, Select } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { IOntologyActionDefinition, IOntologyActionDefinitionInput, IOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import type { IOntologyStudioApi } from './api';

export default function StudioActionEditor({ action, snapshot, api, isExecution = false, onClose, onRefresh, onError }: IStudioActionEditorProps) {
  const { t } = useTranslation();
  const text = (key: string) => t('ontology.studio.' + key);
  const [form] = Form.useForm();
  const [isBusy, setIsBusy] = useState(false);
  const isPending = useRef(false);
  const [argumentsText, setArgumentsText] = useState(JSON.stringify(Object.fromEntries((action?.parameters || []).map((parameter) => [parameter.name, parameter.type === 'object' ? {} : parameter.type === 'boolean' ? false : ['number', 'integer'].includes(parameter.type) ? 0 : ''])), null, 2));
  const [result, setResult] = useState('');
  const onSubmit = async () => {
    if (isPending.current) return;
    const values = isExecution ? {} : await form.validate().catch((): undefined => undefined);
    if (!values) return;
    isPending.current = true;
    setIsBusy(true);
    try {
      if (isExecution && action) {
        const args = JSON.parse(argumentsText);
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error(text('invalidActionDefinition'));
        const response = await api.executeAction({ workspaceId: snapshot.workspaceId, id: action.id, arguments: args });
        setResult(JSON.stringify(response.execution.output, null, 2));
        await onRefresh();
      } else {
        const configuration = JSON.parse(values.configurationText);
        const parameters = JSON.parse(values.parametersText);
        const outputSchema = JSON.parse(values.outputText);
        if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration) || !Array.isArray(parameters) || parameters.some((item) => !item || typeof item.name !== 'string' || typeof item.type !== 'string' || typeof item.required !== 'boolean') || !Array.isArray(outputSchema))
          throw new Error(text('invalidActionDefinition'));
        const input: IOntologyActionDefinitionInput = {
          id: action?.id,
          workspaceId: snapshot.workspaceId,
          code: values.code,
          name: values.name,
          displayName: values.name,
          description: values.description || '',
          displayDescription: values.description || '',
          executor: values.executor,
          status: values.status,
          objectIds: values.objectIds,
          configuration,
          parameters,
          outputSchema,
        };
        await api.upsertAction(input);
        await onRefresh();
        onClose();
      }
    } catch (error) {
      onError(error);
    } finally {
      isPending.current = false;
      setIsBusy(false);
    }
  };
  return (
    <Modal
      visible
      title={text(isExecution ? 'runAction' : 'editAction')}
      onOk={onSubmit}
      okText={text(isExecution ? 'runAction' : 'saveDraft')}
      onCancel={() => {
        if (!isPending.current) onClose();
      }}
      confirmLoading={isBusy}
      maskClosable={!isBusy}
      style={{ width: 'min(800px, 92vw)' }}
    >
      {isExecution ? (
        <div className='flex flex-col gap-3'>
          <Alert type='warning' content={text('actionExecutionHint')} />
          <Input.TextArea aria-label={text('arguments')} value={argumentsText} onChange={setArgumentsText} autoSize={{ minRows: 5, maxRows: 12 }} disabled={isBusy} />
          {result && <pre className='overflow-auto whitespace-pre-wrap'>{result}</pre>}
        </div>
      ) : (
        <Form
          form={form}
          layout='vertical'
          disabled={isBusy}
          initialValues={{
            name: action?.displayName || '',
            code: action?.code || '',
            description: action?.displayDescription || '',
            executor: action?.executor || 'api',
            status: action?.status || 'draft',
            objectIds: action?.objectIds || [],
            configurationText: JSON.stringify(action?.configuration || {}, null, 2),
            parametersText: JSON.stringify(action?.parameters || [], null, 2),
            outputText: JSON.stringify(action?.outputSchema || [], null, 2),
          }}
        >
          <Form.Item field='name' label={text('name')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item field='code' label={text('code')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item field='description' label={text('description')}>
            <Input.TextArea />
          </Form.Item>
          <Form.Item field='executor' label={text('executor')}>
            <Select options={['function', 'api', 'sql', 'notification', 'custom_script']} />
          </Form.Item>
          <Form.Item field='status' label={text('status')}>
            <Select options={['draft', 'active', 'disabled'].map((value) => ({ value, label: t('ontology.artifactStatus.' + value) }))} />
          </Form.Item>
          <Form.Item field='objectIds' label={text('objects')}>
            <Select mode='multiple' options={snapshot.objects.map((item) => ({ label: item.name, value: item.id }))} />
          </Form.Item>
          <Form.Item field='configurationText' label={text('actionConfiguration')}>
            <Input.TextArea autoSize={{ minRows: 5, maxRows: 16 }} />
          </Form.Item>
          <Form.Item field='parametersText' label={text('actionParameters')}>
            <Input.TextArea autoSize={{ minRows: 3, maxRows: 10 }} />
          </Form.Item>
          <Form.Item field='outputText' label={text('actionOutput')}>
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
          </Form.Item>
        </Form>
      )}
    </Modal>
  );
}

interface IStudioActionEditorProps {
  action?: IOntologyActionDefinition;
  snapshot: IOntologyWorkbenchSnapshot;
  api: IOntologyStudioApi;
  isExecution?: boolean;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onError: (error: unknown) => void;
}
