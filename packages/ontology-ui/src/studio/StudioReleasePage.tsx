import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Descriptions, Empty, Form, Input, Message, Modal, Space, Table, Tag, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { ontologyBlockingIssues } from '@sudowork/ontology-common';
import type { IOntologyConsistencyCheckResult, IOntologyAgentBlueprint, IOntologyPublishedVersion, IOntologySkillBlueprint, IOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import type { IOntologyStudioApi } from './api';
import styles from './studio.module.css';

export default function StudioReleasePage({ snapshot, api, onRefresh, onError, onExport, onReport, onViewChecks, onStartAgentConversation, isModelDirty = false }: IStudioReleasePageProps) {
  const { t } = useTranslation();
  const text = (key: string) => t(`ontology.studio.${key}`);
  const [isPublishing, setIsPublishing] = useState(false);
  const isPublishingRef = useRef(false);
  const [publishCheck, setPublishCheck] = useState<IOntologyConsistencyCheckResult>();
  const [openingAgentId, setOpeningAgentId] = useState<string>();
  const isOpeningAgentRef = useRef(false);
  const [registeringVersions, setRegisteringVersions] = useState<string[]>([]);
  const [publishingSkillIds, setPublishingSkillIds] = useState<string[]>([]);
  const pending = useRef(new Set<string>());
  const [detail, setDetail] = useState<string>();
  const [agentDetailId, setAgentDetailId] = useState<string>();
  const [creatingSkill, setCreatingSkill] = useState<IOntologySkillBlueprint>();
  const [editingSkill, setEditingSkill] = useState<IOntologySkillBlueprint>();
  const [agentForm] = Form.useForm<{ name: string }>();
  const [skillForm] = Form.useForm<{ name: string; description: string }>();
  const isCreating = !!creatingSkill && registeringVersions.includes(creatingSkill.id);
  const agentDetail = snapshot.agentBlueprints.find((item) => item.id === agentDetailId);
  useEffect(() => {
    void onRefresh().catch(onError);
  }, [onRefresh, onError]);
  useEffect(() => {
    setPublishCheck(undefined);
  }, [snapshot.revision]);
  const onSubmit = async () => {
    if (isPublishingRef.current || isModelDirty) return;
    isPublishingRef.current = true;
    setIsPublishing(true);
    try {
      const check = await api.runConsistencyCheck({
        workspaceId: snapshot.workspaceId,
      });
      setPublishCheck(check);
      onReport?.(check);
      if (ontologyBlockingIssues(check).length) return;
      await api.publishCurrentDraft({ workspaceId: snapshot.workspaceId });
      await onRefresh();
      Message.success(text('candidateCreated'));
    } catch (error) {
      if (error instanceof Error && error.message === 'ontology.studio.errors.publishBlocked') {
        try {
          const check = await api.runConsistencyCheck({
            workspaceId: snapshot.workspaceId,
          });
          setPublishCheck(check);
          onReport?.(check);
          if (!ontologyBlockingIssues(check).length) onError(error);
        } catch (checkError) {
          onError(checkError);
        }
      } else onError(error);
    } finally {
      isPublishingRef.current = false;
      setIsPublishing(false);
    }
  };
  const onRegister = async (skill: IOntologySkillBlueprint, name?: string) => {
    if (pending.current.has(skill.id)) return;
    pending.current.add(skill.id);
    setRegisteringVersions([...pending.current]);
    try {
      let blueprint = snapshot.agentBlueprints.find((item) => item.skillBlueprintId === skill.id);
      if (name !== undefined) {
        blueprint = (
          await api.createAgentBlueprint({
            workspaceId: snapshot.workspaceId,
            skillBlueprintId: skill.id,
            name,
          })
        ).blueprint;
        setCreatingSkill(undefined);
      }
      if (!blueprint) throw new Error(text('agentErrors.notFound'));
      await api.registerAgentBlueprint({
        blueprintId: blueprint.id,
        workspaceId: snapshot.workspaceId,
      });
      await onRefresh();
      Message.success(text('assistantCreated'));
    } catch (error) {
      onError(error);
      await onRefresh().catch(onError);
    } finally {
      pending.current.delete(skill.id);
      setRegisteringVersions([...pending.current]);
    }
  };
  const onOpenCreate = (skill: IOntologySkillBlueprint) => {
    const suffix = text('agentNameSuffix');
    agentForm.resetFields();
    agentForm.setFieldValue('name', `${snapshot.draft.title.slice(0, Math.max(1, 100 - suffix.length))}${suffix}`);
    setCreatingSkill(skill);
  };
  const onConfirmCreate = async () => {
    const values = await agentForm.validate();
    if (creatingSkill) await onRegister(creatingSkill, values.name.trim());
  };
  const onOpenSkill = (skill: IOntologySkillBlueprint) => {
    skillForm.setFieldsValue({
      name: skill.name,
      description: skill.description,
    });
    setEditingSkill(skill);
  };
  const onPublishSkill = async () => {
    if (!editingSkill || publishingSkillIds.includes(editingSkill.id)) return;
    const values = await skillForm.validate();
    setPublishingSkillIds((items) => [...items, editingSkill.id]);
    try {
      await api.publishSkillBlueprint({
        workspaceId: snapshot.workspaceId,
        skillBlueprintId: editingSkill.id,
        name: values.name.trim(),
        description: values.description.trim(),
      });
      setEditingSkill(undefined);
      await onRefresh();
      Message.success(text('skillPublished'));
    } catch (error) {
      onError(error);
    } finally {
      setPublishingSkillIds((items) => items.filter((id) => id !== editingSkill.id));
    }
  };
  const getStatus = (versionId: string, blueprint?: IOntologyAgentBlueprint) => {
    if ((blueprint && registeringVersions.includes(blueprint.skillBlueprintId)) || blueprint?.status === 'registering') return 'registering';
    if (!blueprint || blueprint.status === 'draft') return 'unregistered';
    return blueprint.status === 'published' ? 'registered' : blueprint.status;
  };
  const onNewAgentConversation = async (agent: IOntologyAgentBlueprint) => {
    if (!onStartAgentConversation || !agent.registeredAssistantId || isOpeningAgentRef.current) return;
    isOpeningAgentRef.current = true;
    setOpeningAgentId(agent.id);
    try {
      await onStartAgentConversation(agent.registeredAssistantId);
    } catch (error) {
      onError(error);
    } finally {
      isOpeningAgentRef.current = false;
      setOpeningAgentId(undefined);
    }
  };
  return (
    <section className={styles['ontology-page']}>
      <div className={styles['ontology-page-heading']}>
        <div>
          <Typography.Title heading={5}>{text('releaseTitle')}</Typography.Title>
          <Typography.Text type='secondary'>{text('releaseDescription')}</Typography.Text>
        </div>
        <Button type='primary' loading={isPublishing} disabled={isModelDirty} onClick={() => void onSubmit()}>
          {text('createCandidate')}
        </Button>
      </div>
      {isModelDirty && <Alert type='warning' content={text('saveBeforeChecks')} style={{ marginBottom: 16 }} />}
      {publishCheck && publishCheck.issues.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Alert
            type={ontologyBlockingIssues(publishCheck).length ? 'error' : 'warning'}
            title={t(`ontology.studio.${ontologyBlockingIssues(publishCheck).length ? 'candidateBlocked' : 'warningSummary'}`, {
              errors: ontologyBlockingIssues(publishCheck).length,
              warnings: publishCheck.issues.filter((issue) => issue.severity === 'warning').length,
            })}
            content={text(ontologyBlockingIssues(publishCheck).length ? 'blockingExplanation' : 'warningsDoNotBlock')}
          />
          {onReport && onViewChecks && (
            <Button type='text' onClick={onViewChecks}>
              {text('viewAndRepair')}
            </Button>
          )}
        </div>
      )}
      <Table
        rowKey='id'
        data={[...snapshot.publishedVersions].reverse()}
        noDataElement={<Empty description={text('emptyVersions')} />}
        columns={[
          {
            title: text('version'),
            render: (_value, version) => (
              <Button
                type='text'
                onClick={() =>
                  setDetail(
                    JSON.stringify(
                      {
                        diff: version.diff,
                        objects: version.snapshot.objects,
                        relations: version.snapshot.relations,
                      },
                      null,
                      2
                    )
                  )
                }
              >
                {version.version}
              </Button>
            ),
          },
          {
            title: text('status'),
            render: (_value, version) => <Tag color={version.status === 'published' ? 'green' : 'orange'}>{text(`statusLabels.${version.status}`)}</Tag>,
          },
          {
            title: text('versionSkill'),
            render: (_value, version) => snapshot.skillBlueprints.find((item) => item.ontologyVersionId === version.id)?.name || text('unknownValue'),
          },
          {
            title: text('skillPublicationStatus'),
            render: (_value, version) => {
              if (version.status !== 'published') return text('unknownValue');
              const skill = snapshot.skillBlueprints.find((item) => item.ontologyVersionId === version.id);
              return <Tag color={skill?.status === 'published' ? 'green' : skill?.status === 'failed' ? 'red' : undefined}>{text(`skillStatus.${skill?.status || 'missing'}`)}</Tag>;
            },
          },
          {
            title: text('operations'),
            render: (_value, version) => {
              const skill = snapshot.skillBlueprints.find((item) => item.ontologyVersionId === version.id);
              return (
                <Space wrap>
                  <Button type='text' onClick={() => onExport(version.id)}>
                    {text('export')}
                  </Button>
                  {version.status === 'submitted' && (
                    <>
                      <Button
                        type='primary'
                        onClick={() => {
                          void api
                            .approvePublishedVersion({
                              workspaceId: snapshot.workspaceId,
                              versionId: version.id,
                            })
                            .then(onRefresh)
                            .catch(onError);
                        }}
                      >
                        {text('approvePublish')}
                      </Button>
                      <Button
                        type='text'
                        status='danger'
                        onClick={() => {
                          void api
                            .rejectPublishedVersion({
                              workspaceId: snapshot.workspaceId,
                              versionId: version.id,
                              reason: text('needsChanges'),
                            })
                            .then(onRefresh)
                            .catch(onError);
                        }}
                      >
                        {text('reject')}
                      </Button>
                    </>
                  )}
                  {version.status === 'published' && skill && <Button onClick={() => onOpenSkill(skill)}>{text(skill.status === 'published' ? 'viewSkill' : 'publishSkill')}</Button>}
                </Space>
              );
            },
          },
        ]}
      />
      <section aria-label={text('ontologySkills')}>
        <Typography.Title heading={6}>{text('ontologySkills')}</Typography.Title>
        <Table
          rowKey='id'
          data={[...snapshot.skillBlueprints].reverse()}
          noDataElement={<Empty description={text('noOntologySkills')} />}
          columns={[
            { title: text('skillName'), dataIndex: 'name' },
            {
              title: text('associatedOntology'),
              render: () => snapshot.draft.title,
            },
            {
              title: text('ontologyVersion'),
              render: (_value, skill) => snapshot.publishedVersions.find((version) => version.id === skill.ontologyVersionId)?.version || text('unknownValue'),
            },
            {
              title: text('skillPublicationStatus'),
              render: (_value, skill) => (
                <div>
                  <Tag color={skill.status === 'published' ? 'green' : skill.status === 'failed' ? 'red' : undefined}>{text(`skillStatus.${skill.status}`)}</Tag>
                  {skill.status === 'failed' && skill.publicationError && (
                    <Typography.Paragraph type='secondary' style={{ marginBottom: 0 }}>
                      {skill.publicationError}
                    </Typography.Paragraph>
                  )}
                </div>
              ),
            },
            {
              title: text('operations'),
              render: (_value, skill) => (
                <Space>
                  <Button type='text' onClick={() => onOpenSkill(skill)}>
                    {text(skill.status === 'published' ? 'viewSkill' : 'publishSkill')}
                  </Button>
                  {skill.status === 'published' && !snapshot.agentBlueprints.some((agent) => agent.skillBlueprintId === skill.id) && <Button onClick={() => onOpenCreate(skill)}>{text('createAssistant')}</Button>}
                </Space>
              ),
            },
          ]}
        />
      </section>
      <section aria-label={text('registeredAssistants')}>
        <Typography.Title heading={6}>{text('registeredAssistants')}</Typography.Title>
        <Table
          rowKey='id'
          data={[...snapshot.agentBlueprints].reverse()}
          noDataElement={<Empty description={text('noVersionAgents')} />}
          columns={[
            { title: text('agentName'), dataIndex: 'name' },
            {
              title: text('associatedSkill'),
              render: (_value, agent) => snapshot.skillBlueprints.find((skill) => skill.id === agent.skillBlueprintId)?.name || text('unknownValue'),
            },
            {
              title: text('associatedOntology'),
              render: () => snapshot.draft.title,
            },
            {
              title: text('ontologyVersion'),
              render: (_value, agent) => snapshot.publishedVersions.find((version) => version.id === agent.ontologyVersionId)?.version || text('unknownValue'),
            },
            {
              title: text('agentRegistrationStatus'),
              render: (_value, agent) => {
                const status = getStatus(agent.ontologyVersionId, agent);
                return <Tag color={status === 'registered' ? 'green' : status === 'failed' ? 'red' : status === 'registering' ? 'orange' : undefined}>{text(`agentStatus.${status}`)}</Tag>;
              },
            },
            {
              title: text('operations'),
              width: 150,
              render: (_value, agent) => {
                const status = getStatus(agent.ontologyVersionId, agent);
                const skill = snapshot.skillBlueprints.find((item) => item.id === agent.skillBlueprintId && item.status === 'published');
                if (status === 'registering')
                  return (
                    <Button type='text' loading disabled>
                      {text('agentRegistering')}
                    </Button>
                  );
                if (status === 'registered' && agent.registeredAssistantId && skill)
                  return (
                    <Button type='text' icon={<Plus size={14} />} loading={openingAgentId === agent.id} disabled={!onStartAgentConversation || !!openingAgentId} onClick={() => void onNewAgentConversation(agent)}>
                      {text('agentNewConversation')}
                    </Button>
                  );
                if (skill && ['draft', 'failed', 'deleted'].includes(agent.status))
                  return (
                    <Button type='text' onClick={() => void onRegister(skill)}>
                      {text(agent.status === 'failed' ? 'retryAgentRegistration' : agent.status === 'deleted' ? 'restoreAgentRegistration' : 'createAssistant')}
                    </Button>
                  );
                return text('unknownValue');
              },
            },
          ]}
        />
      </section>
      <Modal
        visible={!!editingSkill}
        title={text(editingSkill?.status === 'published' ? 'viewSkill' : 'publishSkill')}
        onCancel={() => setEditingSkill(undefined)}
        onOk={editingSkill?.status === 'published' ? undefined : onPublishSkill}
        footer={editingSkill?.status === 'published' ? null : undefined}
        okText={text('publishSkill')}
        confirmLoading={!!editingSkill && publishingSkillIds.includes(editingSkill.id)}
        style={{ width: 'min(640px, 90vw)' }}
        unmountOnExit
      >
        <Form form={skillForm} layout='vertical'>
          <Form.Item
            field='name'
            label={text('skillName')}
            rules={[
              {
                required: true,
                match: /\S/,
                maxLength: 100,
                message: text('skillErrors.invalidName'),
              },
            ]}
          >
            <Input maxLength={100} disabled={editingSkill?.status === 'published'} />
          </Form.Item>
          <Form.Item
            field='description'
            label={text('skillDescription')}
            rules={[
              {
                required: true,
                match: /\S/,
                maxLength: 500,
                message: text('skillErrors.invalidDescription'),
              },
            ]}
          >
            <Input.TextArea maxLength={500} disabled={editingSkill?.status === 'published'} />
          </Form.Item>
          {editingSkill && (
            <Descriptions
              column={1}
              data={[
                {
                  label: text('ontologyVersion'),
                  value: snapshot.publishedVersions.find((version) => version.id === editingSkill.ontologyVersionId)?.version,
                },
                {
                  label: text('skillPublicationStatus'),
                  value: text(`skillStatus.${editingSkill.status}`),
                },
              ]}
            />
          )}
          {editingSkill && (
            <div style={{ marginTop: 16 }}>
              <Typography.Title heading={6}>{t('ontology.studio.skillCapabilitiesWithCount', { count: editingSkill.toolManifest.length })}</Typography.Title>
              <Table
                rowKey='name'
                size='small'
                pagination={false}
                data={editingSkill.toolManifest}
                noDataElement={<Empty description={text('noSkillCapabilities')} />}
                columns={[
                  { title: text('capabilityType'), render: (_value, tool) => <Tag>{text(`capabilityCategories.${tool.category}`)}</Tag> },
                  { title: text('capabilityName'), dataIndex: 'displayName' },
                  { title: text('capabilityDescription'), dataIndex: 'displayDescription' },
                ]}
              />
            </div>
          )}
        </Form>
      </Modal>
      <Modal
        visible={!!creatingSkill}
        title={text('createAssistant')}
        onCancel={() => setCreatingSkill(undefined)}
        onOk={onConfirmCreate}
        okText={text('createAssistant')}
        confirmLoading={isCreating}
        cancelButtonProps={{ disabled: isCreating }}
        closable={!isCreating}
        maskClosable={!isCreating}
        escToExit={!isCreating}
        style={{ width: 'min(520px, 90vw)' }}
        unmountOnExit
      >
        <Form form={agentForm} layout='vertical'>
          <Form.Item
            field='name'
            label={text('agentName')}
            rules={[
              {
                required: true,
                match: /\S/,
                maxLength: 100,
                message: text('agentErrors.invalidName'),
              },
            ]}
            extra={text('agentNameHint')}
          >
            <Input aria-label={text('agentName')} autoFocus maxLength={100} disabled={isCreating} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal visible={!!agentDetail} title={agentDetail?.name} footer={null} onCancel={() => setAgentDetailId(undefined)} style={{ width: 'min(520px, 90vw)' }}>
        {agentDetail && (
          <Descriptions
            column={1}
            data={[
              {
                label: text('associatedOntology'),
                value: snapshot.draft.title,
              },
              {
                label: text('associatedSkill'),
                value: snapshot.skillBlueprints.find((skill) => skill.id === agentDetail.skillBlueprintId)?.name,
              },
              {
                label: text('version'),
                value: snapshot.publishedVersions.find((version) => version.id === agentDetail.ontologyVersionId)?.version,
              },
              {
                label: text('agentRegistrationStatus'),
                value: text(`agentStatus.${getStatus(agentDetail.ontologyVersionId, agentDetail)}`),
              },
              {
                label: text('agentRegisteredAt'),
                value: agentDetail.registeredAt ? new Date(agentDetail.registeredAt).toLocaleString() : text('unknownValue'),
              },
            ]}
          />
        )}
      </Modal>
      <Modal visible={detail !== undefined} title={text('versionDiff')} footer={null} onCancel={() => setDetail(undefined)} style={{ width: 'min(900px, 90vw)' }}>
        <pre className={styles['ontology-code']}>{detail}</pre>
      </Modal>
    </section>
  );
}

interface IStudioReleasePageProps {
  onStartAgentConversation?: (assistantId: string) => void | Promise<void>;
  isModelDirty?: boolean;
  onReport?: (report: IOntologyConsistencyCheckResult) => void;
  onViewChecks?: () => void;
  snapshot: IOntologyWorkbenchSnapshot;
  api: IOntologyStudioApi;
  onRefresh: () => Promise<void>;
  onError: (error: unknown) => void;
  onExport: (versionId?: string) => void;
}
