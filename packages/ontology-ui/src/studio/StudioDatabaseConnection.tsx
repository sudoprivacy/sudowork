import { useRef, useState } from 'react';
import { Button, Form, Input, InputNumber, Modal, Select } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { IOntologyConnectorInput } from '@sudowork/ontology-common';
import type { IOntologyStudioApi } from './api';

const defaultProviders = ['postgresql', 'mysql', 'sqlite'] as const;

export default function StudioDatabaseConnection({ workspaceId, api, onRefresh, onClose, onError, providers = defaultProviders, onSubmit, initialConnector }: IStudioDatabaseConnectionProps) {
  const { t } = useTranslation();
  const text = (key: string) => t(`ontology.studio.${key}`);
  const requiredMessage = (field: string) => t('ontology.studio.requiredField', { field });
  const [sourceType, setSourceType] = useState<'postgresql' | 'mysql' | 'sqlite'>(providers[0]);
  const [isConnecting, setIsConnecting] = useState(false);
  const isConnectingRef = useRef(false);
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
    if (isConnectingRef.current) return;
    const values = await form.validate().catch((): undefined => undefined);
    if (!values) return;
    if (isConnectingRef.current) return;
    isConnectingRef.current = true;
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
      if (onSubmit) await onSubmit(connector);
      else {
        const result = await api.probeConnector({ workspaceId, connector });
        if (result.connector.probeStatus === 'failed') throw new Error(result.connector.lastError || text('connectionFailed'));
      }
      await onRefresh();
      onClose();
    } catch (error) {
      onError(error);
    } finally {
      isConnectingRef.current = false;
      setIsConnecting(false);
    }
  };
  return (
    <Modal
      visible
      title={text('addConnection')}
      onCancel={() => {
        if (!isConnectingRef.current) onClose();
      }}
      onOk={onConnect}
      confirmLoading={isConnecting}
      cancelButtonProps={{ disabled: isConnecting }}
      maskClosable={!isConnecting}
      escToExit={!isConnecting}
      style={{ width: 'min(560px, 92vw)' }}
    >
      <Form
        form={form}
        layout='vertical'
        disabled={isConnecting}
        initialValues={{
          sourceType: providers[0],
          port: 5432,
          schema: 'public',
          ...(initialConnector
            ? {
                name: initialConnector.name,
                host: initialConnector.host,
                port: initialConnector.port || (providers[0] === 'mysql' ? 3306 : 5432),
                database: initialConnector.database,
                username: initialConnector.username,
                path: initialConnector.path,
                schema: initialConnector.params?.schema || 'public',
              }
            : {}),
        }}
      >
        <Form.Item
          field='name'
          label={text('name')}
          rules={[
            {
              required: true,
              match: /\S/,
              message: requiredMessage(text('name')),
            },
          ]}
        >
          <Input aria-label={text('name')} />
        </Form.Item>
        <Form.Item field='sourceType' label={text('kind')}>
          <Select
            aria-label={text('kind')}
            options={[
              { label: 'PostgreSQL', value: 'postgresql' },
              { label: 'MySQL', value: 'mysql' },
              { label: 'SQLite', value: 'sqlite' },
            ].filter((option) => providers.includes(option.value as typeof sourceType))}
            onChange={(value) => {
              setSourceType(value);
              form.setFieldValue('port', value === 'mysql' ? 3306 : value === 'postgresql' ? 5432 : undefined);
            }}
          />
        </Form.Item>
        {isSqlite ? (
          <Form.Item
            field='path'
            label={text('sqlitePath')}
            rules={[
              {
                required: true,
                match: /\S/,
                message: requiredMessage(text('sqlitePath')),
              },
            ]}
            extra={text('sqliteHint')}
          >
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
            <Form.Item
              field='host'
              label={text('host')}
              rules={[
                {
                  required: true,
                  match: /\S/,
                  message: requiredMessage(text('host')),
                },
              ]}
            >
              <Input aria-label={text('host')} />
            </Form.Item>
            <Form.Item field='port' label={text('port')} rules={[{ required: true, message: requiredMessage(text('port')) }]}>
              <InputNumber aria-label={text('port')} min={1} max={65535} precision={0} />
            </Form.Item>
            <Form.Item
              field='database'
              label={text('database')}
              rules={[
                {
                  required: true,
                  match: /\S/,
                  message: requiredMessage(text('database')),
                },
              ]}
            >
              <Input aria-label={text('database')} />
            </Form.Item>
            {sourceType === 'postgresql' && (
              <Form.Item field='schema' label={text('databaseSchema')}>
                <Input aria-label={text('databaseSchema')} />
              </Form.Item>
            )}
            <Form.Item
              field='username'
              label={text('username')}
              rules={[
                {
                  required: true,
                  match: /\S/,
                  message: requiredMessage(text('username')),
                },
              ]}
            >
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
  initialConnector?: Partial<IOntologyConnectorInput>;
  providers?: readonly ('postgresql' | 'mysql' | 'sqlite')[];
  onSubmit?: (connector: IOntologyConnectorInput) => Promise<void>;
  workspaceId: string;
  api: IOntologyStudioApi;
  onRefresh: () => Promise<void>;
  onClose: () => void;
  onError: (error: unknown) => void;
}
