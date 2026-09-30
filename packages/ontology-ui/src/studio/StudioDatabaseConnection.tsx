import { useState } from 'react';
import { Button, Form, Input, InputNumber, Modal, Select } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { IOntologyConnectorInput } from '@sudowork/ontology-common';
import type { IOntologyStudioApi } from './api';

export default function StudioDatabaseConnection({ workspaceId, api, onRefresh, onClose, onError }: IStudioDatabaseConnectionProps) {
  const { t } = useTranslation();
  const text = (key: string) => t(`ontology.studio.${key}`);
  const [sourceType, setSourceType] = useState<'postgresql' | 'mysql' | 'sqlite'>('postgresql');
  const [isConnecting, setIsConnecting] = useState(false);
  const [form] = Form.useForm();
  const isSqlite = sourceType === 'sqlite';
  const onPickSqlite = async () => {
    try {
      const filePath = await api.pickSqliteFile();
      if (filePath) form.setFieldValue('path', filePath);
    } catch (error) {
      onError(error);
    }
  };
  const onConnect = async () => {
    const values = await form.validate();
    setIsConnecting(true);
    try {
      const connector: IOntologyConnectorInput = {
        name: values.name.trim(),
        sourceType,
        kind: 'database',
        metadata: {},
        writable: false,
        ...(isSqlite
          ? { path: values.path.trim() }
          : {
              host: values.host.trim(),
              port: values.port,
              database: values.database.trim(),
              username: values.username.trim(),
              password: values.password,
              ...(sourceType === 'postgresql' ? { params: { schema: values.schema?.trim() || 'public' } } : {}),
            }),
      };
      const result = await api.probeConnector({ workspaceId, connector });
      if (result.connector.probeStatus === 'failed') throw new Error(result.connector.lastError || text('connectionFailed'));
      await onRefresh();
      onClose();
    } catch (error) {
      onError(error);
    } finally {
      setIsConnecting(false);
    }
  };
  return (
    <Modal visible title={text('addConnection')} onCancel={onClose} onOk={onConnect} confirmLoading={isConnecting} style={{ width: 'min(560px, 92vw)' }}>
      <Form form={form} layout='vertical' initialValues={{ sourceType: 'postgresql', port: 5432, schema: 'public' }}>
        <Form.Item field='name' label={text('name')} rules={[{ required: true, match: /\S/ }]}>
          <Input aria-label={text('name')} />
        </Form.Item>
        <Form.Item field='sourceType' label={text('kind')}>
          <Select
            aria-label={text('kind')}
            options={[
              { label: 'PostgreSQL', value: 'postgresql' },
              { label: 'MySQL', value: 'mysql' },
              { label: 'SQLite', value: 'sqlite' },
            ]}
            onChange={(value) => {
              setSourceType(value);
              form.setFieldValue('port', value === 'mysql' ? 3306 : value === 'postgresql' ? 5432 : undefined);
            }}
          />
        </Form.Item>
        {isSqlite ? (
          <Form.Item field='path' label={text('sqlitePath')} rules={[{ required: true, match: /\S/ }]} extra={text('sqliteHint')}>
            <Input
              aria-label={text('sqlitePath')}
              suffix={
                <Button type='text' size='small' disabled={isConnecting} onClick={() => void onPickSqlite()}>
                  {text('chooseFile')}
                </Button>
              }
            />
          </Form.Item>
        ) : (
          <>
            <Form.Item field='host' label={text('host')} rules={[{ required: true, match: /\S/ }]}>
              <Input aria-label={text('host')} />
            </Form.Item>
            <Form.Item field='port' label={text('port')} rules={[{ required: true }]}>
              <InputNumber aria-label={text('port')} min={1} max={65535} precision={0} />
            </Form.Item>
            <Form.Item field='database' label={text('database')} rules={[{ required: true, match: /\S/ }]}>
              <Input aria-label={text('database')} />
            </Form.Item>
            {sourceType === 'postgresql' && (
              <Form.Item field='schema' label={text('databaseSchema')}>
                <Input aria-label={text('databaseSchema')} />
              </Form.Item>
            )}
            <Form.Item field='username' label={text('username')} rules={[{ required: true, match: /\S/ }]}>
              <Input aria-label={text('username')} />
            </Form.Item>
            <Form.Item field='password' label={text('password')}>
              <Input.Password aria-label={text('password')} autoComplete='new-password' />
            </Form.Item>
          </>
        )}
      </Form>
    </Modal>
  );
}

interface IStudioDatabaseConnectionProps {
  workspaceId: string;
  api: IOntologyStudioApi;
  onRefresh: () => Promise<void>;
  onClose: () => void;
  onError: (error: unknown) => void;
}
