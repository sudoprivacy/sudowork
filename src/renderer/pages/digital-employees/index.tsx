import { Button, Card, Checkbox, Drawer, Empty, Input, Message, Modal, Select, Spin, Switch, Tag, Tooltip } from '@arco-design/web-react';
import classNames from 'classnames';
import { Clock, Copy, Eye, FileText, Link2, ListTree, MessageCircle, Pencil, Play, Plus, RefreshCcw, Search, Trash2, X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import type { DigitalEmployeeResourceType, DigitalEmployeeSopStatus, DigitalEmployeeStatus, IDigitalEmployee, IDigitalEmployeeResource, IDigitalEmployeeResourceInput, IDigitalEmployeeSop, IDigitalEmployeeSopContent, IDigitalEmployeeSopNode } from '@/common/digitalEmployee';
import { ipcBridge } from '@/common';
import PageWrapper from '@renderer/components/base/PageWrapper';
import { emitter } from '@/renderer/utils/emitter';
import type { AcpBackendAll } from '@/types/acpTypes';
import type { ICronJob } from '@/common/ipcBridge';
import CronJobFormDrawer from '@/renderer/pages/cron/components/CronJobFormDrawer';
import { formatNextRunRelative, formatSchedule, unwrapCronResult } from '@/renderer/pages/cron/utils';

const TextArea = Input.TextArea;

interface IEditorState {
  name: string;
  roleName: string;
  description: string;
  personaPrompt: string;
  backend: AcpBackendAll;
  defaultMode: string;
  status: DigitalEmployeeStatus;
}

interface IResourceDraft {
  resourceType: DigitalEmployeeResourceType;
  resourceId: string;
  resourceName: string;
  configSummary: string;
  enabled: boolean;
}

interface IResourceOption {
  value: string;
  label: string;
  description?: string;
}

interface ISopNodeDraft {
  nodeId: string;
  name: string;
  instruction: string;
  optional: boolean;
}

interface ISopDraft {
  sopKey: string;
  name: string;
  businessDomain: string;
  description: string;
  status: DigitalEmployeeSopStatus;
  rawContent: string;
  triggerIntents: string;
  goals: string;
  requiredInfo: string;
  responseRules: string;
  nodes: ISopNodeDraft[];
}

const BINDABLE_RESOURCE_TYPES: DigitalEmployeeResourceType[] = ['skill', 'knowledge'];
const VISIBLE_RESOURCE_TYPES = new Set<DigitalEmployeeResourceType>(['assistant', 'skill', 'general_skill', 'knowledge']);
const COUNTABLE_RESOURCE_TYPES = new Set<DigitalEmployeeResourceType>(['assistant', 'skill', 'general_skill', 'knowledge', 'sop']);
const LEGACY_STAFFDECK_RESOURCE_CONFIG_KEYS = ['staffdeckKnowledgeBaseId', 'staffdeckGeneralSkillId', 'staffdeckToolId', 'staffdeckTool'];
const BACKEND_OPTIONS: AcpBackendAll[] = ['scode', 'claude', 'qwen', 'codex', 'gemini'];

function getResourceTypeLabelKey(resourceType: DigitalEmployeeResourceType): DigitalEmployeeResourceType {
  return resourceType === 'general_skill' ? 'skill' : resourceType;
}

function isUnsupportedLegacyResource(resource: IDigitalEmployeeResource): boolean {
  if (resource.resourceType === 'sop') return false;
  return resource.id.startsWith('der_staffdeck_') || LEGACY_STAFFDECK_RESOURCE_CONFIG_KEYS.some((key) => Boolean(resource.config[key]));
}

function isVisibleResource(resource: IDigitalEmployeeResource): boolean {
  return VISIBLE_RESOURCE_TYPES.has(resource.resourceType) && !isUnsupportedLegacyResource(resource);
}

function isCountableResource(resource: IDigitalEmployeeResource): boolean {
  return COUNTABLE_RESOURCE_TYPES.has(resource.resourceType) && !isUnsupportedLegacyResource(resource);
}

function isBuiltInEmployee(employee: IDigitalEmployee | null | undefined): boolean {
  return employee?.sourceType === 'staffdeck_seed';
}

function getEmptyEditorState(): IEditorState {
  return {
    name: '',
    roleName: '',
    description: '',
    personaPrompt: '',
    backend: 'scode',
    defaultMode: 'default',
    status: 'active',
  };
}

function getEmptyResourceDraft(): IResourceDraft {
  return {
    resourceType: 'skill',
    resourceId: '',
    resourceName: '',
    configSummary: '',
    enabled: true,
  };
}

function getEmptySopNode(index: number): ISopNodeDraft {
  return {
    nodeId: `node_${index + 1}`,
    name: '',
    instruction: '',
    optional: false,
  };
}

function getNewSopNode(nodes: ISopNodeDraft[]): ISopNodeDraft {
  return {
    ...getEmptySopNode(nodes.length),
    nodeId: `node_${Date.now()}_${nodes.length + 1}`,
  };
}

function getEmptySopDraft(businessDomain = ''): ISopDraft {
  return {
    sopKey: '',
    name: '',
    businessDomain,
    description: '',
    status: 'published',
    rawContent: '',
    triggerIntents: '',
    goals: '',
    requiredInfo: '',
    responseRules: '',
    nodes: [getEmptySopNode(0)],
  };
}

function getEmployeeInitials(employee: IDigitalEmployee): string {
  return (employee.name || employee.roleName || '?').slice(0, 2).toUpperCase();
}

function getDateTimeLabel(value: number | undefined): string {
  if (!value) return '';
  return new Date(value).toLocaleString();
}

function getCronJobConversationTarget(job: ICronJob): string | undefined {
  const isNewMode = (job.metadata.conversationMode ?? 'new') === 'new';
  if (isNewMode) return job.state.lastConversationId;
  return job.metadata.conversationId || job.state.lastConversationId;
}

function isLegacyResourceIdentifier(value: string): boolean {
  return /^(?:skill|genskill|kb|tool)_[a-z0-9]+$/i.test(value.trim());
}

function listToText(values: string[] | undefined): string {
  return values?.filter((value) => !isLegacyResourceIdentifier(value)).join('\n') || '';
}

function textToList(value: string): string[] {
  return value
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function sopContentToDraft(content: IDigitalEmployeeSopContent, status: DigitalEmployeeSopStatus, rawContent = ''): ISopDraft {
  return {
    sopKey: content.sopKey,
    name: content.name,
    businessDomain: content.businessDomain || '',
    description: content.description,
    status,
    rawContent,
    triggerIntents: listToText(content.triggerIntents),
    goals: listToText(content.goals),
    requiredInfo: listToText(content.requiredInfo),
    responseRules: listToText(content.responseRules),
    nodes: content.nodes.length
      ? content.nodes.map((node, index) => ({
          nodeId: node.nodeId || `node_${index + 1}`,
          name: node.name,
          instruction: node.instruction,
          optional: node.optional,
        }))
      : [getEmptySopNode(0)],
  };
}

function sopToDraft(sop: IDigitalEmployeeSop): ISopDraft {
  const rawContent = typeof sop.metadata.rawContent === 'string' ? sop.metadata.rawContent : sop.description;
  return sopContentToDraft(sop.content, sop.status, rawContent);
}

function buildSopContentFromDraft(draft: ISopDraft): IDigitalEmployeeSopContent {
  const nodes: IDigitalEmployeeSopNode[] = draft.nodes
    .filter((node) => node.name.trim() || node.instruction.trim())
    .map((node, index) => ({
      nodeId: node.nodeId || `node_${index + 1}`,
      type: 'task',
      name: node.name.trim() || `Step ${index + 1}`,
      instruction: node.instruction.trim() || node.name.trim() || `Step ${index + 1}`,
      optional: node.optional,
      expectedUserInfo: [] as string[],
      allowedActions: [] as string[],
      knowledgeScope: {},
      retryPolicy: {
        maxRetries: 1,
      },
      metadata: {},
    }));
  const finalNodes = nodes.length
    ? nodes
    : [
        {
          nodeId: 'node_1',
          type: 'task',
          name: draft.name.trim() || 'SOP',
          instruction: draft.description.trim() || draft.name.trim() || 'SOP',
          optional: false,
          expectedUserInfo: [] as string[],
          allowedActions: [] as string[],
          knowledgeScope: {},
          retryPolicy: { maxRetries: 1 },
          metadata: {},
        },
      ];

  return {
    sopKey: draft.sopKey.trim(),
    name: draft.name.trim(),
    version: '1.0.0',
    businessDomain: draft.businessDomain.trim() || undefined,
    description: draft.description.trim(),
    triggerIntents: textToList(draft.triggerIntents),
    userUtteranceExamples: [],
    goals: textToList(draft.goals),
    requiredInfo: textToList(draft.requiredInfo),
    slotFillingPolicy: {},
    responseRules: textToList(draft.responseRules),
    nodes: finalNodes,
    edges: finalNodes.slice(0, -1).map((node, index) => ({
      sourceNodeId: node.nodeId,
      nextNodeId: finalNodes[index + 1].nodeId,
      priority: 0,
      label: 'next',
    })),
    startNodeId: finalNodes[0].nodeId,
    terminalNodeIds: [finalNodes[finalNodes.length - 1].nodeId],
    interruptionPolicy: {
      missing_information: '向用户追问缺失字段后继续。',
      out_of_scope: '说明能力边界并建议转人工确认。',
    },
  };
}

export default function DigitalEmployeesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [employees, setEmployees] = useState<IDigitalEmployee[]>([]);
  const [searchText, setSearchText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isLaunchOpen, setIsLaunchOpen] = useState(false);
  const [editorEmployee, setEditorEmployee] = useState<IDigitalEmployee | null>(null);
  const [launchEmployee, setLaunchEmployee] = useState<IDigitalEmployee | null>(null);
  const [editorState, setEditorState] = useState<IEditorState>(getEmptyEditorState);
  const [resourceDraft, setResourceDraft] = useState<IResourceDraft>(getEmptyResourceDraft);
  const [editorSops, setEditorSops] = useState<IDigitalEmployeeSop[]>([]);
  const [isSopEditorOpen, setIsSopEditorOpen] = useState(false);
  const [sopEditor, setSopEditor] = useState<IDigitalEmployeeSop | null>(null);
  const [sopDraft, setSopDraft] = useState<ISopDraft>(getEmptySopDraft);
  const [isSopSaving, setIsSopSaving] = useState(false);
  const [isSopDistilling, setIsSopDistilling] = useState(false);
  const [editorCronJobs, setEditorCronJobs] = useState<ICronJob[]>([]);
  const [isCronDrawerOpen, setIsCronDrawerOpen] = useState(false);
  const [cronEditorJob, setCronEditorJob] = useState<ICronJob | null>(null);
  const [launchMessage, setLaunchMessage] = useState('');
  const [skillOptions, setSkillOptions] = useState<IResourceOption[]>([]);
  const [assistantOptions, setAssistantOptions] = useState<IResourceOption[]>([]);
  const [knowledgeOptions, setKnowledgeOptions] = useState<IResourceOption[]>([]);

  const filteredEmployees = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) return employees;
    return employees.filter((employee) => [employee.name, employee.roleName, employee.description].some((value) => value.toLowerCase().includes(query)));
  }, [employees, searchText]);

  const resourceOptions = useMemo(() => {
    if (resourceDraft.resourceType === 'skill') return skillOptions;
    if (resourceDraft.resourceType === 'assistant') return assistantOptions;
    if (resourceDraft.resourceType === 'knowledge') return knowledgeOptions;
    return [];
  }, [assistantOptions, knowledgeOptions, resourceDraft.resourceType, skillOptions]);

  const loadEmployees = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await ipcBridge.digitalEmployee.list.invoke();
      if (response.success && response.data) {
        setEmployees(response.data);
      } else {
        Message.error(response.msg || t('digitalEmployee.messages.loadFailed'));
      }
    } catch (error) {
      console.error('Failed to load digital employees:', error);
      Message.error(t('digitalEmployee.messages.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  const loadResourceOptions = useCallback(async () => {
    try {
      const [skillsResponse, assistantsResponse, knowledgeResponse] = await Promise.all([ipcBridge.skillHub.getInstalledSkills.invoke(), ipcBridge.assistantHub.getInstalledAssistants.invoke(), ipcBridge.localKnowledgeBase.listSpaces.invoke(undefined)]);
      if (skillsResponse.success && skillsResponse.data) {
        setSkillOptions(
          skillsResponse.data
            .filter((skill) => skill.enabled)
            .map((skill) => ({
              value: skill.name,
              label: skill.meta?.display_name || skill.meta?.name || skill.name,
              description: skill.meta?.description || skill.name,
            }))
        );
      }
      if (assistantsResponse.success && assistantsResponse.data) {
        setAssistantOptions(
          assistantsResponse.data
            .filter((assistant) => assistant.enabled)
            .map((assistant) => ({
              value: assistant.name,
              label: assistant.meta?.display_name || assistant.meta?.name || assistant.name,
              description: assistant.meta?.descriptionI18n?.['zh-CN'] || assistant.meta?.descriptionI18n?.['en-US'],
            }))
        );
      }
      if (knowledgeResponse.success && knowledgeResponse.data) {
        setKnowledgeOptions(
          knowledgeResponse.data.map((space) => ({
            value: space.id,
            label: space.name,
            description: space.description || space.name,
          }))
        );
      }
    } catch (error) {
      console.warn('Failed to load digital employee resource options:', error);
    }
  }, []);

  const loadEditorSops = useCallback(
    async (employeeId: string) => {
      const response = await ipcBridge.digitalEmployee.listSops.invoke({ employeeId });
      if (response.success && response.data) {
        setEditorSops(response.data);
      } else {
        Message.error(response.msg || t('digitalEmployee.messages.actionFailed'));
      }
    },
    [t]
  );

  const loadEditorCronJobs = useCallback(
    async (employeeId: string) => {
      try {
        const response = await ipcBridge.cron.listJobsByDigitalEmployee.invoke({ employeeId });
        setEditorCronJobs(unwrapCronResult(response) || []);
      } catch (error) {
        console.warn('Failed to load digital employee scheduled tasks:', error);
        Message.error(t('digitalEmployee.scheduledTasks.loadFailed', '定时任务加载失败'));
      }
    },
    [t]
  );

  const refreshEditorEmployee = useCallback(
    async (employeeId: string) => {
      const response = await ipcBridge.digitalEmployee.get.invoke({ employeeId });
      if (!response.success || !response.data) return;
      setEditorEmployee(response.data);
      setEmployees((currentEmployees) => currentEmployees.map((employee) => (employee.id === response.data?.id ? response.data : employee)));
      await Promise.all([loadEditorSops(employeeId), loadEditorCronJobs(employeeId)]);
    },
    [loadEditorCronJobs, loadEditorSops]
  );

  useEffect(() => {
    void loadEmployees();
    void loadResourceOptions();
  }, [loadEmployees, loadResourceOptions]);

  useEffect(() => {
    if (!editorEmployee) return;

    const employeeId = editorEmployee.id;
    const unsubscribeCreate = ipcBridge.cron.onJobCreated.on((job: ICronJob) => {
      if (job.metadata.digitalEmployeeId !== employeeId) return;
      setEditorCronJobs((jobs) => (jobs.some((item) => item.id === job.id) ? jobs : [job, ...jobs]));
    });
    const unsubscribeUpdate = ipcBridge.cron.onJobUpdated.on((job: ICronJob) => {
      if (job.metadata.digitalEmployeeId !== employeeId) return;
      setEditorCronJobs((jobs) => jobs.map((item) => (item.id === job.id ? job : item)));
    });
    const unsubscribeRemove = ipcBridge.cron.onJobRemoved.on(({ jobId }) => {
      setEditorCronJobs((jobs) => jobs.filter((item) => item.id !== jobId));
    });

    return () => {
      unsubscribeCreate();
      unsubscribeUpdate();
      unsubscribeRemove();
    };
  }, [editorEmployee]);

  const onOpenCreate = useCallback(() => {
    setEditorEmployee(null);
    setEditorState(getEmptyEditorState());
    setResourceDraft(getEmptyResourceDraft());
    setEditorSops([]);
    setEditorCronJobs([]);
    setIsEditorOpen(true);
  }, []);

  const onOpenEdit = useCallback(
    (employee: IDigitalEmployee) => {
      setEditorEmployee(employee);
      setEditorState({
        name: employee.name,
        roleName: employee.roleName,
        description: employee.description,
        personaPrompt: employee.personaPrompt,
        backend: employee.backend || 'scode',
        defaultMode: employee.defaultMode || 'default',
        status: employee.status,
      });
      setResourceDraft(getEmptyResourceDraft());
      setEditorSops([]);
      setEditorCronJobs([]);
      setIsEditorOpen(true);
      void Promise.all([loadEditorSops(employee.id), loadEditorCronJobs(employee.id)]);
    },
    [loadEditorCronJobs, loadEditorSops]
  );

  const onSaveEmployee = useCallback(async () => {
    const isEditingBuiltIn = isBuiltInEmployee(editorEmployee);
    const name = editorState.name.trim();
    const roleName = editorState.roleName.trim();
    if (!isEditingBuiltIn && (!name || !roleName)) {
      Message.warning(t('digitalEmployee.messages.requiredFields'));
      return;
    }

    setIsSaving(true);
    try {
      const response = editorEmployee
        ? await ipcBridge.digitalEmployee.update.invoke({
            employeeId: editorEmployee.id,
            updates: isEditingBuiltIn
              ? { status: editorState.status }
              : {
                  name,
                  roleName,
                  description: editorState.description.trim(),
                  personaPrompt: editorState.personaPrompt.trim(),
                  backend: editorState.backend,
                  defaultMode: editorState.defaultMode.trim() || 'default',
                  status: editorState.status,
                },
          })
        : await ipcBridge.digitalEmployee.create.invoke({
            name,
            roleName,
            description: editorState.description.trim(),
            personaPrompt: editorState.personaPrompt.trim(),
            backend: editorState.backend,
            defaultMode: editorState.defaultMode.trim() || 'default',
            status: editorState.status,
            sourceType: 'custom',
          });

      if (!response.success || !response.data) {
        Message.error(response.msg || t('digitalEmployee.messages.saveFailed'));
        return;
      }

      Message.success(editorEmployee ? t('digitalEmployee.messages.updateSuccess') : t('digitalEmployee.messages.createSuccess'));
      setEditorEmployee(response.data);
      setIsEditorOpen(false);
      await loadEmployees();
    } catch (error) {
      console.error('Failed to save digital employee:', error);
      Message.error(t('digitalEmployee.messages.saveFailed'));
    } finally {
      setIsSaving(false);
    }
  }, [editorEmployee, editorState, loadEmployees, t]);

  const onDeleteEmployee = useCallback(
    (employee: IDigitalEmployee) => {
      if (isBuiltInEmployee(employee)) return;

      Modal.confirm({
        title: t('digitalEmployee.delete.title'),
        content: t('digitalEmployee.delete.content', { name: employee.name }),
        okText: t('common.delete'),
        cancelText: t('common.cancel'),
        onOk: async () => {
          const response = await ipcBridge.digitalEmployee.remove.invoke({ employeeId: employee.id });
          if (!response.success) {
            Message.error(response.msg || t('digitalEmployee.messages.actionFailed'));
            return;
          }
          Message.success(t('digitalEmployee.messages.deleteSuccess'));
          await loadEmployees();
        },
      });
    },
    [loadEmployees, t]
  );

  const onDuplicateEmployee = useCallback(
    async (employee: IDigitalEmployee) => {
      try {
        const response = await ipcBridge.digitalEmployee.duplicate.invoke({ employeeId: employee.id });
        if (!response.success || !response.data) {
          Message.error(response.msg || t('digitalEmployee.messages.actionFailed'));
          return;
        }
        Message.success(t('digitalEmployee.messages.duplicateSuccess'));
        await loadEmployees();
      } catch (error) {
        console.error('Failed to duplicate digital employee:', error);
        Message.error(t('digitalEmployee.messages.actionFailed'));
      }
    },
    [loadEmployees, t]
  );

  const onOpenLaunch = useCallback(
    (employee: IDigitalEmployee) => {
      setLaunchEmployee(employee);
      setLaunchMessage(t('digitalEmployee.launch.defaultMessage', { name: employee.name, role: employee.roleName }));
      setIsLaunchOpen(true);
    },
    [t]
  );

  const onLaunchConversation = useCallback(async () => {
    if (!launchEmployee) return;
    const initialMessage = launchMessage.trim();
    if (!initialMessage) {
      Message.warning(t('digitalEmployee.messages.launchMessageRequired'));
      return;
    }

    setIsLaunching(true);
    try {
      const response = await ipcBridge.digitalEmployee.launchConversation.invoke({
        employeeId: launchEmployee.id,
        initialMessage,
      });
      if (!response.success || !response.data) {
        Message.error(response.msg || t('digitalEmployee.messages.actionFailed'));
        return;
      }

      sessionStorage.setItem(
        `acp_initial_message_${response.data.conversationId}`,
        JSON.stringify({
          input: initialMessage,
          skills: response.data.enabledSkills,
        })
      );
      setIsLaunchOpen(false);
      emitter.emit('chat.history.refresh');
      await navigate(`/conversation/${response.data.conversationId}`);
    } catch (error) {
      console.error('Failed to launch digital employee:', error);
      Message.error(t('digitalEmployee.messages.actionFailed'));
    } finally {
      setIsLaunching(false);
    }
  }, [launchEmployee, launchMessage, navigate, t]);

  const onAddResource = useCallback(async () => {
    if (!editorEmployee) return;
    if (isBuiltInEmployee(editorEmployee)) return;

    if (!BINDABLE_RESOURCE_TYPES.includes(resourceDraft.resourceType)) {
      Message.warning(t('digitalEmployee.messages.resourceRequired'));
      return;
    }
    const resourceId = resourceDraft.resourceId.trim();
    if (!resourceId) {
      Message.warning(t('digitalEmployee.messages.resourceRequired'));
      return;
    }

    const resource: IDigitalEmployeeResourceInput = {
      resourceType: resourceDraft.resourceType,
      resourceId,
      resourceName: resourceDraft.resourceName.trim() || resourceId,
      enabled: resourceDraft.enabled,
      config: resourceDraft.configSummary.trim() ? { summary: resourceDraft.configSummary.trim() } : {},
    };

    const response = await ipcBridge.digitalEmployee.bindResource.invoke({ employeeId: editorEmployee.id, resource });
    if (!response.success) {
      Message.error(response.msg || t('digitalEmployee.messages.actionFailed'));
      return;
    }

    Message.success(t('digitalEmployee.messages.resourceAdded'));
    setResourceDraft(getEmptyResourceDraft());
    await refreshEditorEmployee(editorEmployee.id);
  }, [editorEmployee, refreshEditorEmployee, resourceDraft, t]);

  const onRemoveResource = useCallback(
    async (resource: IDigitalEmployeeResource) => {
      if (isBuiltInEmployee(editorEmployee)) return;

      const response = await ipcBridge.digitalEmployee.unbindResource.invoke({ resourceId: resource.id });
      if (!response.success) {
        Message.error(response.msg || t('digitalEmployee.messages.actionFailed'));
        return;
      }
      Message.success(t('digitalEmployee.messages.resourceRemoved'));
      if (editorEmployee) {
        await refreshEditorEmployee(editorEmployee.id);
      }
    },
    [editorEmployee, refreshEditorEmployee, t]
  );

  const onResourcePresetChange = useCallback(
    (value: string) => {
      const option = resourceOptions.find((item) => item.value === value);
      setResourceDraft((current) => ({
        ...current,
        resourceId: value,
        resourceName: option?.label || value,
        configSummary: option?.description || current.configSummary,
      }));
    },
    [resourceOptions]
  );

  const onOpenCreateSop = useCallback(() => {
    if (!editorEmployee) return;
    if (isBuiltInEmployee(editorEmployee)) return;

    setSopEditor(null);
    setSopDraft(getEmptySopDraft(editorEmployee.roleName));
    setIsSopEditorOpen(true);
  }, [editorEmployee]);

  const onOpenEditSop = useCallback((sop: IDigitalEmployeeSop) => {
    setSopEditor(sop);
    setSopDraft(sopToDraft(sop));
    setIsSopEditorOpen(true);
  }, []);

  const onDistillSopDraft = useCallback(async () => {
    if (!editorEmployee) return;
    if (isBuiltInEmployee(editorEmployee)) return;

    const rawContent = sopDraft.rawContent.trim();
    if (!rawContent) {
      Message.warning(t('digitalEmployee.sop.distillWarning'));
      return;
    }

    setIsSopDistilling(true);
    try {
      const response = await ipcBridge.digitalEmployee.distillSop.invoke({
        employeeId: editorEmployee.id,
        title: sopDraft.name.trim() || t('digitalEmployee.sop.defaultName'),
        rawContent,
        businessDomain: sopDraft.businessDomain.trim() || editorEmployee.roleName,
      });
      if (!response.success || !response.data) {
        Message.error(response.msg || t('digitalEmployee.messages.actionFailed'));
        return;
      }
      setSopDraft((current) => ({
        ...sopContentToDraft(response.data!.draft, current.status, rawContent),
        sopKey: sopEditor ? current.sopKey : current.sopKey || response.data!.draft.sopKey,
        status: current.status,
      }));
      Message.success(t('digitalEmployee.sop.distillSuccess'));
    } catch (error) {
      console.error('Failed to distill SOP:', error);
      Message.error(t('digitalEmployee.messages.actionFailed'));
    } finally {
      setIsSopDistilling(false);
    }
  }, [editorEmployee, sopDraft.businessDomain, sopDraft.name, sopDraft.rawContent, sopEditor, t]);

  const onSaveSop = useCallback(async () => {
    if (!editorEmployee) return;
    if (isBuiltInEmployee(editorEmployee)) return;

    const name = sopDraft.name.trim();
    if (!name) {
      Message.warning(t('digitalEmployee.sop.nameRequired'));
      return;
    }

    setIsSopSaving(true);
    try {
      const content = buildSopContentFromDraft({
        ...sopDraft,
        name,
        sopKey: sopDraft.sopKey.trim() || name,
      });
      const payload = {
        name,
        sopKey: sopDraft.sopKey.trim() || undefined,
        businessDomain: sopDraft.businessDomain.trim(),
        description: sopDraft.description.trim(),
        status: sopDraft.status,
        content,
        metadata: {
          rawContent: sopDraft.rawContent.trim(),
        },
      };
      const response = sopEditor ? await ipcBridge.digitalEmployee.updateSop.invoke({ sopId: sopEditor.id, updates: payload }) : await ipcBridge.digitalEmployee.createSop.invoke({ employeeId: editorEmployee.id, sop: payload });

      if (!response.success || !response.data) {
        Message.error(response.msg || t('digitalEmployee.messages.actionFailed'));
        return;
      }

      Message.success(t('digitalEmployee.sop.saveSuccess'));
      setIsSopEditorOpen(false);
      await refreshEditorEmployee(editorEmployee.id);
    } catch (error) {
      console.error('Failed to save SOP:', error);
      Message.error(t('digitalEmployee.messages.actionFailed'));
    } finally {
      setIsSopSaving(false);
    }
  }, [editorEmployee, refreshEditorEmployee, sopDraft, sopEditor, t]);

  const onDeleteSop = useCallback(
    (sop: IDigitalEmployeeSop) => {
      if (isBuiltInEmployee(editorEmployee)) return;

      Modal.confirm({
        title: t('digitalEmployee.sop.deleteTitle'),
        content: t('digitalEmployee.sop.deleteContent', { name: sop.name }),
        okText: t('common.delete'),
        cancelText: t('common.cancel'),
        onOk: async () => {
          const response = await ipcBridge.digitalEmployee.removeSop.invoke({ sopId: sop.id });
          if (!response.success) {
            Message.error(response.msg || t('digitalEmployee.messages.actionFailed'));
            return;
          }
          Message.success(t('digitalEmployee.sop.deleteSuccess'));
          if (editorEmployee) {
            await refreshEditorEmployee(editorEmployee.id);
          }
        },
      });
    },
    [editorEmployee, refreshEditorEmployee, t]
  );

  const onOpenCreateCronJob = useCallback(() => {
    if (!editorEmployee) return;
    setCronEditorJob(null);
    setIsCronDrawerOpen(true);
  }, [editorEmployee]);

  const onOpenEditCronJob = useCallback((job: ICronJob) => {
    setCronEditorJob(job);
    setIsCronDrawerOpen(true);
  }, []);

  const onCronJobSaved = useCallback(async () => {
    if (!editorEmployee) return;
    await loadEditorCronJobs(editorEmployee.id);
  }, [editorEmployee, loadEditorCronJobs]);

  const onOpenCronConversation = useCallback(
    async (job: ICronJob) => {
      let targetConversationId = getCronJobConversationTarget(job);
      if (!targetConversationId) {
        const latestJob = await ipcBridge.cron.getJob.invoke({ jobId: job.id });
        if (latestJob) {
          setEditorCronJobs((jobs) => jobs.map((item) => (item.id === latestJob.id ? latestJob : item)));
          targetConversationId = getCronJobConversationTarget(latestJob);
        }
      }

      if (!targetConversationId) {
        Message.warning(t('digitalEmployee.scheduledTasks.noConversation', '暂无可查看的执行会话'));
        return;
      }

      emitter.emit('chat.history.refresh');
      setIsEditorOpen(false);
      void navigate(`/conversation/${targetConversationId}`);
      emitter.emit('conversation.remote.sync', targetConversationId);
      window.setTimeout(() => emitter.emit('conversation.remote.sync', targetConversationId), 1000);
      window.setTimeout(() => emitter.emit('conversation.remote.sync', targetConversationId), 3000);
    },
    [navigate, t]
  );

  const onDeleteCronJob = useCallback(
    (job: ICronJob) => {
      Modal.confirm({
        title: t('digitalEmployee.scheduledTasks.deleteTitle', '删除定时任务'),
        content: t('digitalEmployee.scheduledTasks.deleteContent', { name: job.name, defaultValue: '确认删除定时任务「{{name}}」？' }),
        okText: t('common.delete'),
        cancelText: t('common.cancel'),
        onOk: async () => {
          try {
            unwrapCronResult(await ipcBridge.cron.removeJob.invoke({ jobId: job.id }));
            setEditorCronJobs((jobs) => jobs.filter((item) => item.id !== job.id));
            Message.success(t('cron.deleteSuccess', '任务已删除'));
          } catch (error) {
            Message.error(error instanceof Error ? error.message : t('digitalEmployee.messages.actionFailed'));
          }
        },
      });
    },
    [t]
  );

  const editorReadOnly = isBuiltInEmployee(editorEmployee);
  const sopEditorReadOnly = editorReadOnly && Boolean(sopEditor);

  return (
    <PageWrapper className='bg-[var(--bg-subtle)] tracking-normal' contentClassName='max-w-[1180px]'>
      <div className='mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between'>
        <div className='min-w-0'>
          <h1 className='my-0 text-26px font-700 leading-8 text-foreground'>{t('digitalEmployee.title')}</h1>
          <p className='mb-0 mt-2 text-13px leading-5 text-secondary'>{t('digitalEmployee.subtitle')}</p>
        </div>

        <div className='flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:w-auto lg:justify-end'>
          <Input className='w-full sm:w-80 lg:w-88' prefix={<Search size={16} className='text-tertiary' />} allowClear value={searchText} placeholder={t('digitalEmployee.searchPlaceholder')} onChange={setSearchText} />
          <div className='flex items-center gap-2'>
            <Button className='border-light bg-base text-secondary hover:bg-faint hover:text-foreground' icon={<RefreshCcw size={16} />} onClick={() => void loadEmployees()}>
              {t('common.refresh')}
            </Button>
            <Button type='primary' icon={<Plus size={16} />} onClick={onOpenCreate}>
              {t('digitalEmployee.actions.create')}
            </Button>
          </div>
        </div>
      </div>

      <div className='flex flex-col gap-5'>
        <Spin loading={isLoading} className='w-full'>
          {filteredEmployees.length === 0 ? (
            <div className='h-80 f-center rounded-3 border border-dashed border-light bg-base'>
              <Empty description={t('digitalEmployee.empty')} />
            </div>
          ) : (
            <div className='grid grid-cols-1 gap-5 lg:grid-cols-3'>
              {filteredEmployees.map((employee) => (
                <EmployeeCard key={employee.id} employee={employee} onLaunch={onOpenLaunch} onEdit={onOpenEdit} onDuplicate={onDuplicateEmployee} onDelete={onDeleteEmployee} />
              ))}
            </div>
          )}
        </Spin>
      </div>

      <Drawer
        width={560}
        visible={isEditorOpen}
        title={editorEmployee ? t('digitalEmployee.editor.editTitle') : t('digitalEmployee.editor.createTitle')}
        onCancel={() => setIsEditorOpen(false)}
        footer={
          <div className='flex items-center justify-end gap-2'>
            <Button onClick={() => setIsEditorOpen(false)}>{t('common.cancel')}</Button>
            <Button type='primary' loading={isSaving} onClick={() => void onSaveEmployee()}>
              {t('common.save')}
            </Button>
          </div>
        }
      >
        <div className='flex flex-col gap-5'>
          <EditorFields state={editorState} readOnly={editorReadOnly} onChange={setEditorState} />
          {editorEmployee && <ScheduledTaskEditor jobs={editorCronJobs} onCreate={onOpenCreateCronJob} onEdit={onOpenEditCronJob} onOpenConversation={onOpenCronConversation} onDelete={onDeleteCronJob} />}
          {editorEmployee && <SopEditor sops={editorSops} readOnly={editorReadOnly} onCreate={onOpenCreateSop} onEdit={onOpenEditSop} onDelete={onDeleteSop} />}
          {editorEmployee && (
            <ResourceEditor employee={editorEmployee} draft={resourceDraft} readOnly={editorReadOnly} resourceOptions={resourceOptions} onDraftChange={setResourceDraft} onResourcePresetChange={onResourcePresetChange} onAddResource={onAddResource} onRemoveResource={onRemoveResource} />
          )}
        </div>
      </Drawer>

      <Modal
        visible={isSopEditorOpen}
        title={sopEditorReadOnly ? t('digitalEmployee.sop.view') : sopEditor ? t('digitalEmployee.sop.edit') : t('digitalEmployee.sop.create')}
        style={{ width: 760 }}
        confirmLoading={isSopSaving}
        okText={t('digitalEmployee.sop.save')}
        cancelText={t('common.cancel')}
        onOk={() => void onSaveSop()}
        onCancel={() => setIsSopEditorOpen(false)}
        footer={
          sopEditorReadOnly ? (
            <div className='flex justify-end'>
              <Button onClick={() => setIsSopEditorOpen(false)}>{t('common.close')}</Button>
            </div>
          ) : undefined
        }
      >
        <SopDraftEditor draft={sopDraft} readOnly={sopEditorReadOnly} isDistilling={isSopDistilling} onChange={sopEditorReadOnly ? () => undefined : setSopDraft} onDistill={onDistillSopDraft} />
      </Modal>

      <Modal visible={isLaunchOpen} title={t('digitalEmployee.launch.title')} confirmLoading={isLaunching} okText={t('digitalEmployee.actions.launch')} cancelText={t('common.cancel')} onOk={() => void onLaunchConversation()} onCancel={() => setIsLaunchOpen(false)}>
        <div className='flex flex-col gap-4'>
          {launchEmployee && (
            <div className='flex items-center gap-3'>
              <div className='size-11 rd-2 bg-fill-3 f-center text-16px font-600 text-foreground'>{getEmployeeInitials(launchEmployee)}</div>
              <div className='min-w-0'>
                <div className='text-15px font-600 text-foreground truncate'>{launchEmployee.name}</div>
                <div className='text-12px text-secondary truncate'>{launchEmployee.roleName}</div>
              </div>
            </div>
          )}
          <Field label={t('digitalEmployee.launch.message')}>
            <TextArea value={launchMessage} onChange={setLaunchMessage} autoSize={{ minRows: 4, maxRows: 8 }} />
          </Field>
        </div>
      </Modal>

      <CronJobFormDrawer visible={isCronDrawerOpen} editJob={cronEditorJob} sessionMode='local' digitalEmployee={editorEmployee} onClose={() => setIsCronDrawerOpen(false)} onSaved={() => void onCronJobSaved()} />
    </PageWrapper>
  );
}

function EditorFields({ state, readOnly, onChange }: IEditorFieldsProps) {
  const { t } = useTranslation();

  return (
    <div className='flex flex-col gap-4'>
      <div className='grid grid-cols-2 gap-3'>
        <Field label={t('digitalEmployee.fields.name')}>
          <Input value={state.name} disabled={readOnly} onChange={(value) => onChange({ ...state, name: value })} />
        </Field>
        <Field label={t('digitalEmployee.fields.roleName')}>
          <Input value={state.roleName} disabled={readOnly} onChange={(value) => onChange({ ...state, roleName: value })} />
        </Field>
      </div>
      <Field label={t('digitalEmployee.fields.description')}>
        <TextArea value={state.description} disabled={readOnly} onChange={(value) => onChange({ ...state, description: value })} autoSize={{ minRows: 3, maxRows: 6 }} />
      </Field>
      <Field label={t('digitalEmployee.fields.personaPrompt')}>
        <TextArea value={state.personaPrompt} disabled={readOnly} onChange={(value) => onChange({ ...state, personaPrompt: value })} autoSize={{ minRows: 5, maxRows: 10 }} />
      </Field>
      <div className='grid grid-cols-2 gap-3'>
        <Field label={t('digitalEmployee.fields.backend')}>
          <Select
            value={state.backend}
            disabled={readOnly}
            onChange={(value) => {
              const backend = value as AcpBackendAll;
              onChange({
                ...state,
                backend,
                defaultMode: backend === state.backend ? state.defaultMode : 'default',
              });
            }}
          >
            {BACKEND_OPTIONS.map((backend) => (
              <Select.Option key={backend} value={backend}>
                {t(`digitalEmployee.backend.${backend}`)}
              </Select.Option>
            ))}
          </Select>
        </Field>
        <Field label={t('digitalEmployee.fields.status')}>
          <div className='h-8 flex items-center justify-between rounded-[var(--border-radius-small)] bg-fill-2 px-[11px]'>
            <span className='text-14px text-foreground'>{t(`digitalEmployee.status.${state.status}`)}</span>
            <Switch checked={state.status === 'active'} onChange={(checked) => onChange({ ...state, status: checked ? 'active' : 'disabled' })} />
          </div>
        </Field>
      </div>
    </div>
  );
}

function ScheduledTaskEditor({ jobs, onCreate, onEdit, onOpenConversation, onDelete }: IScheduledTaskEditorProps) {
  const { t } = useTranslation();

  return (
    <div className='flex flex-col gap-3 pt-4 border-t border-border'>
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-2 text-14px font-600 text-foreground'>
          <Clock size={16} />
          <span>{t('digitalEmployee.scheduledTasks.title', '定时任务')}</span>
          <Tag size='small'>{jobs.length}</Tag>
        </div>
        <Button size='small' type='primary' icon={<Plus size={14} />} onClick={onCreate}>
          {t('digitalEmployee.scheduledTasks.create', '新建任务')}
        </Button>
      </div>

      <div className='flex flex-col gap-2'>
        {jobs.length === 0 ? (
          <div className='h-22 f-center border border-dashed border-border rd-2 text-secondary text-13px'>{t('digitalEmployee.scheduledTasks.empty', '暂无定时任务')}</div>
        ) : (
          jobs.map((job) => <ScheduledTaskRow key={job.id} job={job} onEdit={onEdit} onOpenConversation={onOpenConversation} onDelete={onDelete} />)
        )}
      </div>
    </div>
  );
}

function ScheduledTaskRow({ job, onEdit, onOpenConversation, onDelete }: IScheduledTaskRowProps) {
  const { t } = useTranslation();
  const isPaused = !job.enabled;
  const isError = job.state.lastStatus === 'error';
  const statusText = isPaused ? t('digitalEmployee.scheduledTasks.statusPaused', '已暂停') : isError ? t('digitalEmployee.scheduledTasks.statusError', '执行出错') : t('digitalEmployee.scheduledTasks.statusEnabled', '已启用');
  const statusColor = isPaused ? 'gray' : isError ? 'red' : 'green';
  const nextRun = job.enabled ? formatNextRunRelative(t, job.state.nextRunAtMs) : '';
  const scheduleText = formatSchedule(job);
  const targetConversationId = getCronJobConversationTarget(job);

  return (
    <div className='flex items-center gap-2 border border-border rd-2 px-2.5 py-2'>
      <Tag size='small' color={statusColor}>
        {statusText}
      </Tag>
      <div className='min-w-0 flex-1'>
        <div className='text-13px text-foreground truncate'>{job.name}</div>
        <div className='text-11px text-secondary truncate'>
          {[scheduleText, nextRun ? t('digitalEmployee.scheduledTasks.nextRun', { time: nextRun, defaultValue: '下次 {{time}}' }) : undefined, t('digitalEmployee.scheduledTasks.runCount', { count: job.state.runCount, defaultValue: '{{count}} 次执行' })].filter(Boolean).join(' / ')}
        </div>
      </div>
      <Tooltip content={targetConversationId ? t('cron.goToLastConversation', '查看最近执行会话') : t('digitalEmployee.scheduledTasks.noConversation', '暂无可查看的执行会话')}>
        <Button size='mini' type='text' icon={<MessageCircle size={14} />} disabled={!targetConversationId} onClick={() => void onOpenConversation(job)} />
      </Tooltip>
      <Tooltip content={t('common.edit')}>
        <Button size='mini' type='text' icon={<Pencil size={14} />} onClick={() => onEdit(job)} />
      </Tooltip>
      <Tooltip content={t('common.delete')}>
        <Button size='mini' type='text' status='danger' icon={<Trash2 size={14} />} onClick={() => onDelete(job)} />
      </Tooltip>
    </div>
  );
}

function getSopStatusColor(status: DigitalEmployeeSopStatus): string {
  if (status === 'published') return 'green';
  if (status === 'archived') return 'gray';
  return 'orange';
}

function SopEditor({ sops, readOnly, onCreate, onEdit, onDelete }: ISopEditorProps) {
  const { t } = useTranslation();

  return (
    <div className='flex flex-col gap-3 pt-4 border-t border-border'>
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-2 text-14px font-600 text-foreground'>
          <FileText size={16} />
          <span>{t('digitalEmployee.sop.title')}</span>
          <Tag size='small'>{sops.length}</Tag>
        </div>
        {!readOnly && (
          <Button size='small' type='primary' icon={<Plus size={14} />} onClick={onCreate}>
            {t('digitalEmployee.sop.create')}
          </Button>
        )}
      </div>

      <div className='flex flex-col gap-2'>
        {sops.length === 0 ? <div className='h-22 f-center border border-dashed border-border rd-2 text-secondary text-13px'>{t('digitalEmployee.sop.empty')}</div> : sops.map((sop) => <SopRow key={sop.id} sop={sop} readOnly={readOnly} onEdit={onEdit} onDelete={onDelete} />)}
      </div>
    </div>
  );
}

function SopRow({ sop, readOnly, onEdit, onDelete }: ISopRowProps) {
  const { t } = useTranslation();
  return (
    <div className='flex items-center gap-2 border border-border rd-2 px-2.5 py-2'>
      <Tag size='small' color={getSopStatusColor(sop.status)}>
        {t(`digitalEmployee.sop.status.${sop.status}`)}
      </Tag>
      <div className='min-w-0 flex-1'>
        <div className='text-13px text-foreground truncate'>{sop.name}</div>
        <div className='text-11px text-secondary truncate'>{[sop.businessDomain, t('digitalEmployee.sop.nodeCount', { count: sop.content.nodes.length })].filter(Boolean).join(' / ')}</div>
      </div>
      {readOnly ? (
        <Tooltip content={t('digitalEmployee.sop.view')}>
          <Button size='mini' type='text' icon={<Eye size={14} />} onClick={() => onEdit(sop)} />
        </Tooltip>
      ) : (
        <>
          <Tooltip content={t('common.edit')}>
            <Button size='mini' type='text' icon={<Pencil size={14} />} onClick={() => onEdit(sop)} />
          </Tooltip>
          <Tooltip content={t('common.delete')}>
            <Button size='mini' type='text' status='danger' icon={<Trash2 size={14} />} onClick={() => onDelete(sop)} />
          </Tooltip>
        </>
      )}
    </div>
  );
}

function SopDraftEditor({ draft, readOnly, isDistilling, onChange, onDistill }: ISopDraftEditorProps) {
  const { t } = useTranslation();

  const updateNode = (index: number, updates: Partial<ISopNodeDraft>) => {
    onChange({
      ...draft,
      nodes: draft.nodes.map((node, nodeIndex) => (nodeIndex === index ? { ...node, ...updates } : node)),
    });
  };

  const removeNode = (index: number) => {
    onChange({
      ...draft,
      nodes: draft.nodes.filter((_, nodeIndex) => nodeIndex !== index),
    });
  };

  return (
    <div className='flex flex-col gap-4'>
      <Field label={t('digitalEmployee.sop.name')}>
        <Input value={draft.name} readOnly={readOnly} onChange={(value) => onChange({ ...draft, name: value })} />
      </Field>

      <div className='grid grid-cols-2 gap-3'>
        <Field label={t('digitalEmployee.sop.businessDomain')}>
          <Input value={draft.businessDomain} readOnly={readOnly} onChange={(value) => onChange({ ...draft, businessDomain: value })} />
        </Field>
        <Field label={t('digitalEmployee.sop.statusLabel')}>
          <Select value={draft.status} disabled={readOnly} onChange={(value) => onChange({ ...draft, status: value as DigitalEmployeeSopStatus })}>
            <Select.Option value='published'>{t('digitalEmployee.sop.status.published')}</Select.Option>
            <Select.Option value='draft'>{t('digitalEmployee.sop.status.draft')}</Select.Option>
            <Select.Option value='archived'>{t('digitalEmployee.sop.status.archived')}</Select.Option>
          </Select>
        </Field>
      </div>

      <Field label={t('digitalEmployee.sop.description')}>
        <TextArea value={draft.description} readOnly={readOnly} onChange={(value) => onChange({ ...draft, description: value })} autoSize={{ minRows: 2, maxRows: 4 }} />
      </Field>

      <Field label={t('digitalEmployee.sop.rawContent')}>
        <TextArea value={draft.rawContent} readOnly={readOnly} placeholder={t('digitalEmployee.sop.rawPlaceholder')} onChange={(value) => onChange({ ...draft, rawContent: value })} autoSize={{ minRows: 5, maxRows: 10 }} />
      </Field>

      {!readOnly && (
        <div className='flex justify-end'>
          <Button icon={<ListTree size={14} />} loading={isDistilling} onClick={() => void onDistill()}>
            {t('digitalEmployee.sop.distill')}
          </Button>
        </div>
      )}

      <div className='grid grid-cols-2 gap-3'>
        <Field label={t('digitalEmployee.sop.triggerIntents')}>
          <TextArea value={draft.triggerIntents} readOnly={readOnly} onChange={(value) => onChange({ ...draft, triggerIntents: value })} autoSize={{ minRows: 2, maxRows: 4 }} />
        </Field>
        <Field label={t('digitalEmployee.sop.goals')}>
          <TextArea value={draft.goals} readOnly={readOnly} onChange={(value) => onChange({ ...draft, goals: value })} autoSize={{ minRows: 2, maxRows: 4 }} />
        </Field>
      </div>

      <div className='grid grid-cols-2 gap-3'>
        <Field label={t('digitalEmployee.sop.requiredInfo')}>
          <TextArea value={draft.requiredInfo} readOnly={readOnly} onChange={(value) => onChange({ ...draft, requiredInfo: value })} autoSize={{ minRows: 2, maxRows: 4 }} />
        </Field>
        <Field label={t('digitalEmployee.sop.responseRules')}>
          <TextArea value={draft.responseRules} readOnly={readOnly} onChange={(value) => onChange({ ...draft, responseRules: value })} autoSize={{ minRows: 2, maxRows: 4 }} />
        </Field>
      </div>

      <div className='flex flex-col gap-2'>
        <div className='flex items-center justify-between'>
          <div className='text-13px font-600 text-foreground'>{t('digitalEmployee.sop.nodes')}</div>
          {!readOnly && (
            <Button size='small' icon={<Plus size={14} />} onClick={() => onChange({ ...draft, nodes: [...draft.nodes, getNewSopNode(draft.nodes)] })}>
              {t('digitalEmployee.sop.addNode')}
            </Button>
          )}
        </div>
        {draft.nodes.map((node, index) => (
          <div key={`${node.nodeId}-${index}`} className='border border-border rd-2 p-2.5 flex flex-col gap-2'>
            <div className='flex items-center gap-2'>
              <Tag size='small'>{index + 1}</Tag>
              <Input value={node.name} readOnly={readOnly} placeholder={t('digitalEmployee.sop.nodeName')} onChange={(value) => updateNode(index, { name: value })} />
              <Checkbox className='whitespace-nowrap text-13px' checked={node.optional} disabled={readOnly} onChange={(checked) => updateNode(index, { optional: checked })}>
                {t('digitalEmployee.sop.optional')}
              </Checkbox>
              {!readOnly && (
                <Tooltip content={t('digitalEmployee.sop.removeNode')}>
                  <Button size='mini' type='text' status='danger' disabled={draft.nodes.length <= 1} icon={<X size={14} />} onClick={() => removeNode(index)} />
                </Tooltip>
              )}
            </div>
            <TextArea value={node.instruction} readOnly={readOnly} placeholder={t('digitalEmployee.sop.nodeInstruction')} onChange={(value) => updateNode(index, { instruction: value })} autoSize={{ minRows: 2, maxRows: 4 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function ResourceEditor({ employee, draft, readOnly, resourceOptions, onDraftChange, onResourcePresetChange, onAddResource, onRemoveResource }: IResourceEditorProps) {
  const { t } = useTranslation();
  const isPresetResource = draft.resourceType === 'skill' || draft.resourceType === 'assistant' || draft.resourceType === 'knowledge';
  const visibleResources = employee.resources.filter(isVisibleResource);

  return (
    <div className='flex flex-col gap-3 pt-4 border-t border-border'>
      <div className='flex items-center justify-between'>
        <div className='text-14px font-600 text-foreground'>{t('digitalEmployee.resources.title')}</div>
        <Tag size='small'>{visibleResources.length}</Tag>
      </div>

      <div className='flex flex-col gap-2'>
        {visibleResources.length === 0 ? (
          <div className='h-22 f-center border border-dashed border-border rd-2 text-secondary text-13px'>{t('digitalEmployee.resources.empty')}</div>
        ) : (
          visibleResources.map((resource) => <ResourceRow key={resource.id} resource={resource} readOnly={readOnly} onRemove={onRemoveResource} />)
        )}
      </div>

      {!readOnly && (
        <>
          <div className='grid grid-cols-[120px_minmax(0,1fr)] gap-2 pt-2'>
            <Select
              value={draft.resourceType}
              onChange={(value) =>
                onDraftChange({
                  ...getEmptyResourceDraft(),
                  resourceType: value as DigitalEmployeeResourceType,
                })
              }
            >
              {BINDABLE_RESOURCE_TYPES.map((type) => (
                <Select.Option key={type} value={type}>
                  {t(`digitalEmployee.resourceTypes.${type}`)}
                </Select.Option>
              ))}
            </Select>
            {isPresetResource ? (
              <Select showSearch allowClear value={draft.resourceId || undefined} placeholder={t('digitalEmployee.resources.selectPlaceholder')} onChange={(value) => onResourcePresetChange(typeof value === 'string' ? value : '')}>
                {resourceOptions.map((option) => (
                  <Select.Option key={option.value} value={option.value}>
                    {option.label}
                  </Select.Option>
                ))}
              </Select>
            ) : (
              <Input value={draft.resourceId} placeholder={t('digitalEmployee.resources.idPlaceholder')} onChange={(value) => onDraftChange({ ...draft, resourceId: value, resourceName: draft.resourceName || value })} />
            )}
          </div>
          {!isPresetResource && <Input value={draft.resourceName} placeholder={t('digitalEmployee.resources.namePlaceholder')} onChange={(value) => onDraftChange({ ...draft, resourceName: value })} />}
          <TextArea value={draft.configSummary} placeholder={t('digitalEmployee.resources.summaryPlaceholder')} autoSize={{ minRows: 2, maxRows: 4 }} onChange={(value) => onDraftChange({ ...draft, configSummary: value })} />
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-2 text-13px text-secondary'>
              <Switch size='small' checked={draft.enabled} onChange={(checked) => onDraftChange({ ...draft, enabled: checked })} />
              <span>{t('digitalEmployee.resources.enabled')}</span>
            </div>
            <Button type='primary' size='small' icon={<Link2 size={14} />} onClick={() => void onAddResource()}>
              {t('digitalEmployee.resources.add')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function ResourceRow({ resource, readOnly, onRemove }: IResourceRowProps) {
  const { t } = useTranslation();
  return (
    <div className='flex items-center gap-2 border border-border rd-2 px-2.5 py-2'>
      <Tag size='small' color={resource.enabled ? 'arcoblue' : 'gray'}>
        {t(`digitalEmployee.resourceTypes.${getResourceTypeLabelKey(resource.resourceType)}`)}
      </Tag>
      <div className='min-w-0 flex-1'>
        <div className='text-13px text-foreground truncate'>{resource.resourceName || resource.resourceId}</div>
        {!readOnly && <div className='text-11px text-secondary truncate'>{resource.resourceId}</div>}
      </div>
      {!readOnly && (
        <Tooltip content={t('digitalEmployee.resources.remove')}>
          <Button size='mini' type='text' status='danger' icon={<X size={14} />} onClick={() => void onRemove(resource)} />
        </Tooltip>
      )}
    </div>
  );
}

function EmployeeCard({ employee, onLaunch, onEdit, onDuplicate, onDelete }: IEmployeeCardProps) {
  const { t } = useTranslation();
  const isDisabled = employee.status === 'disabled';
  const isBuiltIn = isBuiltInEmployee(employee);
  const enabledResourceCount = employee.resources.filter((resource) => resource.enabled && isCountableResource(resource)).length;
  const lastWorkedAt = employee.lastWorkedAt ? getDateTimeLabel(employee.lastWorkedAt) : t('digitalEmployee.card.neverWorked');

  return (
    <Card
      className={classNames('group h-full overflow-hidden rd-3 border border-tiny bg-base shadow-[0_1px_2px_rgba(29,1,29,0.04)] transition-all duration-200 hover:border-[rgba(var(--ui-accent-orange-rgb),0.24)] hover:shadow-[0_8px_22px_rgba(29,1,29,0.07)]', isDisabled && 'opacity-70')}
      bordered={false}
    >
      <div className='flex h-full min-h-72 flex-col'>
        <div className='flex items-start justify-between gap-3'>
          <div className='flex min-w-0 items-start gap-3'>
            <div className='size-11 shrink-0 rd-2 bg-[var(--brand-light)] f-center text-15px font-700 text-[var(--brand)]'>{getEmployeeInitials(employee)}</div>
            <div className='min-w-0 flex-1'>
              <div className='flex min-w-0 items-center gap-2'>
                <div className='truncate text-17px font-600 leading-6 text-foreground'>{employee.name}</div>
                <StatusPill status={employee.status} />
              </div>
              <div className='mt-1 flex min-w-0 items-center gap-2 text-13px leading-5 text-secondary'>
                <span className='truncate'>{employee.roleName}</span>
                <span className='shrink-0 rd-full border border-tiny bg-faint px-2 py-0.5 text-11px leading-4 text-tertiary'>{t(`digitalEmployee.source.${employee.sourceType}`)}</span>
              </div>
            </div>
          </div>

          <div className='flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100'>
            <Tooltip content={t('common.edit')}>
              <Button size='mini' type='text' className='text-[var(--ui-accent-orange)] hover:bg-[rgba(var(--ui-accent-orange-rgb),0.08)]' icon={<Pencil size={14} />} onClick={() => onEdit(employee)} />
            </Tooltip>
            <Tooltip content={t('common.copy')}>
              <Button size='mini' type='text' className='text-[var(--ui-accent-orange)] hover:bg-[rgba(var(--ui-accent-orange-rgb),0.08)]' icon={<Copy size={14} />} onClick={() => void onDuplicate(employee)} />
            </Tooltip>
            {!isBuiltIn && (
              <Tooltip content={t('common.delete')}>
                <Button size='mini' type='text' status='danger' icon={<Trash2 size={14} />} onClick={() => onDelete(employee)} />
              </Tooltip>
            )}
          </div>
        </div>

        <div className='mt-5'>
          <div className='mb-1.5 text-12px font-500 leading-4 text-tertiary'>{t('digitalEmployee.card.primaryCapability')}</div>
          <div className='min-h-15 line-clamp-3 text-13px leading-5 text-secondary'>{employee.description || t('digitalEmployee.card.noDescription')}</div>
        </div>

        <div className='mt-5 flex flex-col gap-2 border-t border-tiny pt-3'>
          <CardInfoRow label={t('digitalEmployee.card.resources')} value={t('digitalEmployee.card.resourcesCount', { count: enabledResourceCount })} />
          <CardInfoRow label={t('digitalEmployee.card.workRecords')} value={t('digitalEmployee.card.workRecordsCount', { count: employee.workRecordCount })} />
          <CardInfoRow label={t('digitalEmployee.card.status')} value={t(`digitalEmployee.status.${employee.status}`)} />
        </div>

        <div className='mt-auto pt-4'>
          <Button type='primary' size='small' className='h-8.5 px-4' icon={<Play size={14} />} disabled={isDisabled} onClick={() => onLaunch(employee)}>
            {t('digitalEmployee.actions.launch')}
          </Button>
          <div className='mt-3 flex min-w-0 items-center gap-2 text-12px leading-4 text-tertiary'>
            <span className='shrink-0'>{t('digitalEmployee.card.lastWork')}</span>
            <span className='min-w-0 truncate text-secondary'>{lastWorkedAt}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

function StatusPill({ status }: IStatusPillProps) {
  const { t } = useTranslation();
  const isDisabled = status === 'disabled';

  return (
    <span className={classNames('inline-flex shrink-0 items-center gap-1.5 rd-full px-2 py-0.5 text-11px font-500 leading-4', isDisabled ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success')}>
      <span className={classNames('size-1.5 rd-full', isDisabled ? 'bg-danger' : 'bg-success')} />
      {t(`digitalEmployee.status.${status}`)}
    </span>
  );
}

function CardInfoRow({ label, value }: ICardInfoRowProps) {
  return (
    <div className='flex min-w-0 items-center justify-between gap-3 text-12px leading-4'>
      <span className='shrink-0 text-tertiary'>{label}</span>
      <span className='min-w-0 truncate font-600 text-foreground'>{value}</span>
    </div>
  );
}

function Field({ label, children }: IFieldProps) {
  return (
    <label className='flex flex-col gap-1.5 min-w-0'>
      <span className='text-12px text-secondary'>{label}</span>
      {children}
    </label>
  );
}

interface IEditorFieldsProps {
  state: IEditorState;
  readOnly: boolean;
  onChange: (state: IEditorState) => void;
}

interface IResourceEditorProps {
  employee: IDigitalEmployee;
  draft: IResourceDraft;
  readOnly: boolean;
  resourceOptions: IResourceOption[];
  onDraftChange: (draft: IResourceDraft) => void;
  onResourcePresetChange: (value: string) => void;
  onAddResource: () => Promise<void>;
  onRemoveResource: (resource: IDigitalEmployeeResource) => Promise<void>;
}

interface IScheduledTaskEditorProps {
  jobs: ICronJob[];
  onCreate: () => void;
  onEdit: (job: ICronJob) => void;
  onOpenConversation: (job: ICronJob) => Promise<void>;
  onDelete: (job: ICronJob) => void;
}

interface IScheduledTaskRowProps {
  job: ICronJob;
  onEdit: (job: ICronJob) => void;
  onOpenConversation: (job: ICronJob) => Promise<void>;
  onDelete: (job: ICronJob) => void;
}

interface ISopEditorProps {
  sops: IDigitalEmployeeSop[];
  readOnly: boolean;
  onCreate: () => void;
  onEdit: (sop: IDigitalEmployeeSop) => void;
  onDelete: (sop: IDigitalEmployeeSop) => void;
}

interface ISopRowProps {
  sop: IDigitalEmployeeSop;
  readOnly: boolean;
  onEdit: (sop: IDigitalEmployeeSop) => void;
  onDelete: (sop: IDigitalEmployeeSop) => void;
}

interface ISopDraftEditorProps {
  draft: ISopDraft;
  readOnly: boolean;
  isDistilling: boolean;
  onChange: (draft: ISopDraft) => void;
  onDistill: () => Promise<void>;
}

interface IResourceRowProps {
  resource: IDigitalEmployeeResource;
  readOnly: boolean;
  onRemove: (resource: IDigitalEmployeeResource) => Promise<void>;
}

interface IEmployeeCardProps {
  employee: IDigitalEmployee;
  onLaunch: (employee: IDigitalEmployee) => void;
  onEdit: (employee: IDigitalEmployee) => void;
  onDuplicate: (employee: IDigitalEmployee) => Promise<void>;
  onDelete: (employee: IDigitalEmployee) => void;
}

interface IStatusPillProps {
  status: DigitalEmployeeStatus;
}

interface ICardInfoRowProps {
  label: string;
  value: string;
}

interface IFieldProps {
  label: React.ReactNode;
  children: React.ReactNode;
}
