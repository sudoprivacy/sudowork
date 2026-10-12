import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Card, Empty, Form, Input, Modal, Select, Space, Spin, Steps, Switch, Tag, Typography, Upload } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import type { IBridgeResponse } from '@sudowork/host-bridge/ipcBridge';
import type { ExternalAgentAdmin, ExternalPilotPolicy, ExternalProviderMember, OnboardExternalAgent } from '@sudowork/contracts/external-provider';

const api = ipcBridge.externalProviders;
const initialDraft = (): OnboardExternalAgent => ({ request_id: crypto.randomUUID(), endpoint: '', api_key: '', name: '', app_id: '', workspace_id: '', source_definition: '', decoder: 'reply_actions_v1', allowed_user_ids: [], review_days: 7, review_note: '' });
async function data<T>(promise: Promise<IBridgeResponse<T>>): Promise<T> {
  const result = await promise;
  if (!result.success || result.data === undefined) throw new Error(result.msg || 'EXTERNAL_TASK_REQUEST_FAILED');
  return result.data;
}

export default function ExternalAgentManagement({ isPlatformAdmin, isCredentialStorageAvailable, onChanged }: IExternalAgentManagementProps) {
  const { t } = useTranslation();
  const tr = (key: string) => t(`agent.external.manage.${key}`);
  const [agents, setAgents] = useState<ExternalAgentAdmin[]>([]);
  const [members, setMembers] = useState<ExternalProviderMember[]>([]);
  const [policy, setPolicy] = useState<ExternalPilotPolicy>({ enabled: false, endpoints: [], revision: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [errorCode, setErrorCode] = useState('');
  const [isPolicyOpen, setIsPolicyOpen] = useState(false);
  const [isPolicyEnabled, setIsPolicyEnabled] = useState(false);
  const [endpointsText, setEndpointsText] = useState('');
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<OnboardExternalAgent>(initialDraft);
  const [fileName, setFileName] = useState('');
  const [editing, setEditing] = useState<ExternalAgentAdmin | null>(null);
  const [rotating, setRotating] = useState<ExternalAgentAdmin | null>(null);
  const [newKey, setNewKey] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmation, setConfirmation] = useState<{ agent: ExternalAgentAdmin; action: 'approve' | 'disable' | 'archive' } | null>(null);
  const [reviewDays, setReviewDays] = useState(7);
  const isBusyRef = useRef(false);
  const isMounted = useRef(true);
  const operationId = useRef(0);
  const onReload = useCallback(async () => {
    const [rows, people, settings] = await Promise.all([data(api.adminAgents.invoke()), data(api.members.invoke()), data(api.policy.invoke())]);
    if (!isMounted.current) return;
    setAgents(rows);
    setMembers(people);
    setPolicy(settings);
  }, []);
  useEffect(() => {
    isMounted.current = true;
    void onReload()
      .catch((error: Error) => setErrorCode(error.message))
      .finally(() => setIsLoading(false));
    return () => {
      isMounted.current = false;
      operationId.current += 1;
    };
  }, [onReload]);

  async function onRun(operation: () => Promise<void>) {
    if (isBusyRef.current) return;
    isBusyRef.current = true;
    setIsBusy(true);
    setErrorCode('');
    setNotice('');
    try {
      await operation();
    } catch (error) {
      if (isMounted.current) setErrorCode(error instanceof Error ? error.message : 'EXTERNAL_TASK_REQUEST_FAILED');
    } finally {
      isBusyRef.current = false;
      if (isMounted.current) setIsBusy(false);
    }
  }
  async function onRefresh() {
    await onReload();
    await onChanged();
  }
  function onCloseWizard() {
    if (isBusyRef.current) return;
    operationId.current += 1;
    setIsWizardOpen(false);
    setDraft(initialDraft());
    setFileName('');
    setErrorCode('');
  }
  function onCreate() {
    setDraft({ ...initialDraft(), endpoint: policy.endpoints[0] ?? '' });
    setFileName('');
    setStep(0);
    setErrorCode('');
    setIsWizardOpen(true);
  }
  function onEdit(agent: ExternalAgentAdmin) {
    setDraft({ ...initialDraft(), ...agent, api_key: '', source_definition: '', request_id: crypto.randomUUID(), review_days: 7 });
    setErrorCode('');
    setEditing(agent);
  }
  async function onFile(file: File) {
    const generation = ++operationId.current;
    if (file.size > 256000) {
      setErrorCode('DEFINITION_TOO_LARGE');
      return;
    }
    let source: string;
    try {
      source = await file.text();
    } catch {
      setErrorCode('DEFINITION_READ_FAILED');
      return;
    }
    if (generation !== operationId.current || !isMounted.current) return;
    setDraft((current) => ({ ...current, source_definition: source }));
    setFileName(file.name);
  }
  const isDefinitionReady = Boolean(draft.name.trim() && draft.app_id.trim() && draft.workspace_id.trim() && draft.source_definition && draft.allowed_user_ids.length && draft.review_note.trim());
  const isMetadataReady = Boolean(draft.name.trim() && draft.allowed_user_ids.length && draft.review_note.trim());
  const errorMessage = errorCode ? t(`agent.external.manage.errors.${errorCode}`, { defaultValue: tr('failed') }) : '';
  const metadataFields = (
    <>
      <Form.Item label={tr('name')} required>
        <Input aria-label={tr('name')} value={draft.name} maxLength={200} onChange={(name) => setDraft({ ...draft, name })} />
      </Form.Item>
      <Form.Item label={tr('users')} required>
        <Select aria-label={tr('users')} mode='multiple' placeholder={tr('selectUsers')} value={draft.allowed_user_ids} onChange={(allowed_user_ids) => setDraft({ ...draft, allowed_user_ids })} options={members.map((member) => ({ label: member.name, value: member.id }))} />
      </Form.Item>
      <Form.Item label={tr('decoder')}>
        <Select
          aria-label={tr('decoder')}
          value={draft.decoder}
          onChange={(decoder) => setDraft({ ...draft, decoder })}
          options={[
            { label: tr('replyDecoder'), value: 'reply_actions_v1' },
            { label: tr('textDecoder'), value: 'text' },
          ]}
        />
      </Form.Item>
      <Form.Item label={tr('reviewNote')} required>
        <Input.TextArea aria-label={tr('reviewNote')} value={draft.review_note} maxLength={1024} placeholder={tr('reviewPlaceholder')} onChange={(review_note) => setDraft({ ...draft, review_note })} />
      </Form.Item>
    </>
  );
  function onReview(agent: ExternalAgentAdmin, isApproved: boolean) {
    setReviewDays(7);
    setErrorCode('');
    setConfirmation({ agent, action: isApproved ? 'approve' : 'disable' });
  }

  return (
    <div>
      <Card
        className='mb-4'
        title={tr('scope')}
        extra={
          isPlatformAdmin && (
            <Button
              disabled={isBusy}
              onClick={() => {
                setIsPolicyEnabled(policy.enabled);
                setEndpointsText(policy.endpoints.join('\n'));
                setIsPolicyOpen(true);
              }}
            >
              {tr('configureScope')}
            </Button>
          )
        }
      >
        <Space direction='vertical' className='w-full'>
          <Space>
            <Tag color={policy.enabled ? 'green' : 'gray'}>{tr(policy.enabled ? 'scopeEnabled' : 'scopeDisabled')}</Tag>
            <Typography.Text type='secondary'>{tr('scopeHint')}</Typography.Text>
          </Space>
          <div className='break-all'>{policy.endpoints.join(' · ') || tr('noEndpoints')}</div>
          {!isCredentialStorageAvailable && <Alert type='error' content={tr('noSecretService')} />}
          {!policy.enabled && <Alert type='info' content={tr(isPlatformAdmin ? 'enableHint' : 'askPlatformAdmin')} />}
        </Space>
      </Card>
      <div className='flex justify-between items-center mb-4 gap-3'>
        <Typography.Title heading={5} style={{ margin: 0 }}>
          {tr('inventory')}
        </Typography.Title>
        <Space>
          <Button disabled={isBusy} onClick={() => void onRun(onRefresh)}>
            {tr('refresh')}
          </Button>
          <Button type='primary' disabled={isBusy || !policy.enabled || !isCredentialStorageAvailable} onClick={onCreate}>
            {tr('add')}
          </Button>
        </Space>
      </div>
      {errorMessage && !isWizardOpen && !editing && !rotating && !isPolicyOpen && !confirmation && <Alert type='error' content={errorMessage} className='mb-4' />}
      {notice && <Alert type='success' content={notice} className='mb-4' />}
      <Spin loading={isLoading} className='w-full'>
        <Space direction='vertical' className='w-full' size='medium'>
          {agents.map((agent) => (
            <Card key={agent.id} title={agent.name} extra={<Tag color={agent.approved && agent.review_expires_at > Date.now() ? 'green' : 'orange'}>{tr(agent.approved ? (agent.review_expires_at > Date.now() ? 'published' : 'expired') : 'draft')}</Tag>}>
              <Typography.Paragraph className='break-all'>{agent.endpoint}</Typography.Paragraph>
              <Typography.Paragraph type='secondary'>
                {tr('allowedUsers')}
                {agent.allowed_user_ids.map((id) => members.find((member) => member.id === id)?.name ?? id).join('、')}
              </Typography.Paragraph>
              <Typography.Paragraph type='secondary'>{tr('credentialSaved')}</Typography.Paragraph>
              <Space wrap>
                <Button
                  disabled={isBusy}
                  onClick={() =>
                    void onRun(async () => {
                      await data(api.testAgent.invoke({ agentId: agent.id }));
                      setNotice(tr('connected'));
                    })
                  }
                >
                  {tr('test')}
                </Button>
                <Button disabled={isBusy} onClick={() => onEdit(agent)}>
                  {tr('edit')}
                </Button>
                <Button type={agent.approved ? 'secondary' : 'primary'} disabled={isBusy || (!agent.approved && !policy.enabled)} onClick={() => onReview(agent, !agent.approved)}>
                  {tr(agent.approved ? 'disable' : 'approve')}
                </Button>
                <Button
                  disabled={isBusy || !isCredentialStorageAvailable}
                  onClick={() => {
                    setNewKey('');
                    setRotating(agent);
                    setErrorCode('');
                  }}
                >
                  {tr('rotate')}
                </Button>
                <Button
                  status='danger'
                  disabled={isBusy}
                  onClick={() => {
                    setErrorCode('');
                    setConfirmation({ agent, action: 'archive' });
                  }}
                >
                  {tr('archive')}
                </Button>
              </Space>
            </Card>
          ))}
          {!isLoading && !agents.length && <Empty description={tr('empty')} />}
        </Space>
      </Spin>
      <Modal
        unmountOnExit
        title={tr(confirmation?.action === 'approve' ? 'approveTitle' : confirmation?.action === 'disable' ? 'disableTitle' : 'archive')}
        visible={Boolean(confirmation)}
        okText={tr(confirmation?.action ?? 'approve')}
        cancelText={tr('cancel')}
        confirmLoading={isBusy}
        maskClosable={!isBusy}
        closable={!isBusy}
        onCancel={() => {
          if (!isBusy) {
            setConfirmation(null);
            setErrorCode('');
          }
        }}
        onOk={() =>
          void onRun(async () => {
            if (!confirmation) return;
            const { agent, action } = confirmation;
            if (action === 'archive') await data(api.archive.invoke({ agentId: agent.id, revision: agent.revision }));
            else await data(api.review.invoke({ agentId: agent.id, approved: action === 'approve', revision: agent.revision, ...(action === 'approve' ? { review_days: reviewDays } : {}) }));
            setConfirmation(null);
            await onRefresh();
          })
        }
      >
        {errorMessage && <Alert type='error' content={errorMessage} className='mb-4' />}
        <Typography.Text bold>{confirmation?.agent.name}</Typography.Text>
        <Typography.Paragraph>{tr(confirmation?.action === 'approve' ? 'approveHint' : confirmation?.action === 'disable' ? 'disableHint' : 'archiveHint')}</Typography.Paragraph>
        {confirmation?.action === 'approve' && (
          <>
            <Typography.Paragraph>{confirmation.agent.review_note}</Typography.Paragraph>
            <Typography.Paragraph className='break-all'>
              {tr('appId')}: {confirmation.agent.app_id}
            </Typography.Paragraph>
            <Typography.Paragraph className='break-all'>
              {tr('definitionDigest')}: {confirmation.agent.source_digest}
            </Typography.Paragraph>
            <Form.Item label={tr('validity')}>
              <Select aria-label={tr('validity')} value={reviewDays} onChange={setReviewDays} options={[1, 3, 7].map((days) => ({ value: days, label: t('agent.external.manage.days', { count: days }) }))} />
            </Form.Item>
          </>
        )}
      </Modal>
      <Modal
        unmountOnExit
        title={tr('configureScope')}
        okText={tr('save')}
        cancelText={tr('cancel')}
        visible={isPolicyOpen}
        maskClosable={!isBusy}
        closable={!isBusy}
        confirmLoading={isBusy}
        onCancel={() => {
          if (!isBusy) {
            setIsPolicyOpen(false);
            setErrorCode('');
          }
        }}
        onOk={() =>
          void onRun(async () => {
            await data(
              api.savePolicy.invoke({
                enabled: isPolicyEnabled,
                endpoints: endpointsText
                  .split('\n')
                  .map((line) => line.trim())
                  .filter(Boolean),
                revision: policy.revision,
              })
            );
            await onRefresh();
            setIsPolicyOpen(false);
          })
        }
      >
        {errorMessage && <Alert type='error' content={errorMessage} className='mb-4' />}
        <Form layout='vertical'>
          <Form.Item label={tr('enable')}>
            <Switch aria-label={tr('enable')} checked={isPolicyEnabled} onChange={setIsPolicyEnabled} />
          </Form.Item>
          <Form.Item label={tr('endpoints')} extra={tr('endpointHint')}>
            <Input.TextArea aria-label={tr('endpoints')} value={endpointsText} onChange={setEndpointsText} placeholder='http://10.0.1.158:8089/v1' />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        unmountOnExit
        title={tr('add')}
        visible={isWizardOpen}
        style={{ width: 660 }}
        maskClosable={!isBusy}
        closable={!isBusy}
        onCancel={onCloseWizard}
        footer={
          <Space>
            <Button disabled={isBusy} onClick={onCloseWizard}>
              {tr('cancel')}
            </Button>
            {step === 1 && (
              <Button disabled={isBusy} onClick={() => setStep(0)}>
                {tr('back')}
              </Button>
            )}
            <Button
              type='primary'
              loading={isBusy}
              disabled={step === 0 ? !draft.endpoint || !draft.api_key : !isDefinitionReady}
              onClick={() =>
                void onRun(async () => {
                  if (step === 0) {
                    const result = await data(api.inspect.invoke({ endpoint: draft.endpoint, api_key: draft.api_key }));
                    setDraft((current) => ({ ...current, name: current.name || result.name }));
                    setStep(1);
                  } else {
                    await data(api.onboard.invoke(draft));
                    setIsWizardOpen(false);
                    setDraft(initialDraft());
                    setFileName('');
                    await onRefresh();
                    setNotice(tr('draftCreated'));
                  }
                })
              }
            >
              {tr(step === 0 ? 'testAndNext' : 'saveDraft')}
            </Button>
          </Space>
        }
      >
        <Steps current={step + 1} className='mb-5'>
          <Steps.Step title={tr('connect')} />
          <Steps.Step title={tr('definition')} />
        </Steps>
        {errorMessage && <Alert type='error' content={errorMessage} className='mb-4' />}
        <Form layout='vertical'>
          {step === 0 ? (
            <>
              <Form.Item label={tr('endpoint')} required>
                <Select aria-label={tr('endpoint')} value={draft.endpoint} onChange={(endpoint) => setDraft({ ...draft, endpoint })} options={policy.endpoints.map((endpoint) => ({ label: endpoint, value: endpoint }))} />
              </Form.Item>
              <Form.Item label={tr('apiKey')} required extra={tr('apiKeyHint')}>
                <Input.Password aria-label={tr('apiKey')} autoComplete='new-password' value={draft.api_key} onChange={(api_key) => setDraft({ ...draft, api_key })} />
              </Form.Item>
            </>
          ) : (
            <>
              <Alert type='success' content={tr('connected')} className='mb-4' />
              <Form.Item label={tr('appId')} required extra={tr('appIdHint')}>
                <Input aria-label={tr('appId')} value={draft.app_id} onChange={(app_id) => setDraft({ ...draft, app_id })} />
              </Form.Item>
              <Form.Item label={tr('workspaceId')} required>
                <Input aria-label={tr('workspaceId')} value={draft.workspace_id} onChange={(workspace_id) => setDraft({ ...draft, workspace_id })} />
              </Form.Item>
              <Form.Item label={tr('definitionFile')} required extra={tr('definitionHint')}>
                <Upload
                  accept='.yml,.yaml,.json'
                  autoUpload={false}
                  showUploadList={false}
                  beforeUpload={(file) => {
                    void onFile(file);
                    return false;
                  }}
                >
                  <Button>{tr('upload')}</Button>
                </Upload>
                {fileName && <Typography.Text className='ml-3'>{fileName}</Typography.Text>}
              </Form.Item>
              {metadataFields}
            </>
          )}
        </Form>
      </Modal>
      <Modal
        unmountOnExit
        title={tr('edit')}
        visible={Boolean(editing)}
        style={{ width: 660 }}
        confirmLoading={isBusy}
        okText={tr('saveDraft')}
        okButtonProps={{ disabled: !isMetadataReady }}
        maskClosable={!isBusy}
        closable={!isBusy}
        onCancel={() => {
          if (!isBusy) {
            setEditing(null);
            setDraft(initialDraft());
            setErrorCode('');
          }
        }}
        onOk={() =>
          void onRun(async () => {
            if (!editing) return;
            await data(api.update.invoke({ agentId: editing.id, input: { revision: editing.revision, name: draft.name, decoder: draft.decoder, allowed_user_ids: draft.allowed_user_ids, review_days: draft.review_days, review_note: draft.review_note } }));
            setEditing(null);
            setDraft(initialDraft());
            await onRefresh();
          })
        }
      >
        <Alert type='info' content={tr('editHint')} className='mb-4' />
        {errorMessage && <Alert type='error' content={errorMessage} className='mb-4' />}
        <Form layout='vertical'>{metadataFields}</Form>
      </Modal>
      <Modal
        unmountOnExit
        title={tr('rotate')}
        okText={tr('save')}
        cancelText={tr('cancel')}
        visible={Boolean(rotating)}
        confirmLoading={isBusy}
        okButtonProps={{ disabled: !newKey.trim() }}
        maskClosable={!isBusy}
        closable={!isBusy}
        onCancel={() => {
          if (!isBusy) {
            setRotating(null);
            setNewKey('');
            setErrorCode('');
          }
        }}
        onOk={() =>
          void onRun(async () => {
            if (!rotating) return;
            await data(api.rotate.invoke({ agentId: rotating.id, revision: rotating.revision, api_key: newKey }));
            setRotating(null);
            setNewKey('');
            await onRefresh();
            setNotice(tr('rotationDone'));
          })
        }
      >
        <Alert type='info' content={tr('rotationHint')} className='mb-4' />
        {errorMessage && <Alert type='error' content={errorMessage} className='mb-4' />}
        <Input.Password aria-label={tr('newKey')} placeholder={tr('newKey')} autoComplete='new-password' value={newKey} onChange={setNewKey} />
      </Modal>
    </div>
  );
}

interface IExternalAgentManagementProps {
  isPlatformAdmin: boolean;
  isCredentialStorageAvailable: boolean;
  onChanged: () => Promise<void>;
}
