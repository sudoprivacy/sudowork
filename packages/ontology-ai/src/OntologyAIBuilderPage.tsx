import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Empty, Input, Message, Modal, Select, Spin, Tag, Typography } from '@arco-design/web-react';
import { MessageSquare, Plus, Sparkles, Trash2 } from 'lucide-react';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import type { IOntologyAiBuilderSession } from '@sudowork/host-bridge/ipcBridge';
import type { IOntologyWorkbenchSummary, IOntologyWorkbenchMutationResult } from '@sudowork/ontology-common';

export interface IOntologyAIBuilderApi {
  listWorkbenches: () => Promise<{ activeWorkspaceId: string; items: IOntologyWorkbenchSummary[] }>;
  createWorkbench: (input: { name: string; code?: string; description?: string; businessGoal?: string }) => Promise<IOntologyWorkbenchMutationResult>;
  selectWorkbench: (workspaceId: string) => Promise<void>;
  navigateToConversation: (conversationId: string) => void;
  /** Optional external trigger: when set to a positive number, the page opens the "new" modal. */
  openNewSessionSignal?: number;
}

export interface IOntologyAIBuilderPageProps {
  workspaceId: string | null;
  api: IOntologyAIBuilderApi;
}

/**
 * Content of the "AI 构建" tab inside the ontology workbench. Owns a session
 * list plus a "+ AI 构建" primary action that spawns a Sudowork chat scoped
 * to a workspace. Sessions themselves are just Sudowork conversations — this
 * page never talks to LLMs directly, so it inherits whatever model pool the
 * main chat surfaces (SudoRouter default, third-party providers, etc.).
 */
export default function OntologyAIBuilderPage({ workspaceId, api }: IOntologyAIBuilderPageProps) {
  const { t } = useTranslation();
  const [sessions, setSessions] = useState<IOntologyAiBuilderSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalVisible, setIsModalVisible] = useState(false);

  const loadSessions = useCallback(async () => {
    setIsLoading(true);
    try {
      // Deliberately unscoped: the AI 构建 list shows sessions from every
      // ontology (each card already tags its workspaceId), so switching the
      // active workspace doesn't hide history. Filtering by workspaceId hid
      // older sessions the moment a new ontology was created — see UI bug
      // reported on 2026-09-20.
      const res = await ipcBridge.ontologyAiBuilder.listSessions.invoke({});
      if (res.success && res.data) setSessions(res.data.items);
      else setSessions([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
    const off = ipcBridge.ontologyAiBuilder.sessionsChanged.on(() => {
      void loadSessions();
    });
    return off;
  }, [loadSessions]);

  useEffect(() => {
    if (api.openNewSessionSignal && api.openNewSessionSignal > 0) setIsModalVisible(true);
  }, [api.openNewSessionSignal]);

  const onDelete = useCallback(
    async (session: IOntologyAiBuilderSession) => {
      const res = await ipcBridge.ontologyAiBuilder.deleteSession.invoke({ id: session.id });
      if (!res.success) {
        Message.error(res.msg ?? t('ontology.aiBuilder.errors.deleteFailed'));
        return;
      }
      Message.success(t('ontology.aiBuilder.deleted'));
    },
    [t]
  );

  const onOpen = useCallback(
    (session: IOntologyAiBuilderSession) => {
      api.navigateToConversation(session.conversationId);
    },
    [api]
  );

  return (
    <div className='mx-auto flex min-h-full w-full max-w-[1500px] flex-col gap-4'>
      <div className='flex items-center justify-between border-b border-[var(--color-border-2)] pb-4'>
        <div>
          <div className='flex items-center gap-2'>
            <Sparkles size={22} className='text-[rgb(var(--primary-6))]' />
            <Typography.Title heading={4} className='!mb-0'>
              {t('ontology.aiBuilder.title')}
            </Typography.Title>
          </div>
          <Typography.Text type='secondary' className='mt-1 block'>
            {t('ontology.aiBuilder.description')}
          </Typography.Text>
        </div>
        <Button type='primary' icon={<Plus size={16} />} onClick={() => setIsModalVisible(true)}>
          {t('ontology.aiBuilder.new')}
        </Button>
      </div>

      {isLoading ? (
        <div className='flex flex-1 items-center justify-center'>
          <Spin />
        </div>
      ) : sessions.length === 0 ? (
        <div className='flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center'>
          <Empty description={t('ontology.aiBuilder.empty')} />
          <Button type='primary' icon={<Plus size={16} />} onClick={() => setIsModalVisible(true)}>
            {t('ontology.aiBuilder.new')}
          </Button>
        </div>
      ) : (
        <div className='flex flex-1 flex-col gap-3 overflow-y-auto'>
          {sessions.map((session) => (
            <SessionCard key={session.id} session={session} onOpen={() => onOpen(session)} onDelete={() => void onDelete(session)} />
          ))}
        </div>
      )}

      <NewSessionModal
        api={api}
        visible={isModalVisible}
        currentWorkspaceId={workspaceId}
        onCancel={() => setIsModalVisible(false)}
        onCreated={(session) => {
          setIsModalVisible(false);
          api.navigateToConversation(session.conversationId);
        }}
      />
    </div>
  );
}

interface ISessionCardProps {
  session: IOntologyAiBuilderSession;
  onOpen: () => void;
  onDelete: () => void;
}

function SessionCard({ session, onOpen, onDelete }: ISessionCardProps) {
  const { t } = useTranslation();
  return (
    <div className='flex items-center justify-between gap-4 rounded-lg border border-[var(--color-border-2)] bg-[var(--color-bg-1)] px-4 py-3 shadow-sm transition hover:border-[rgb(var(--primary-5))] hover:shadow'>
      <div className='flex min-w-0 flex-1 items-center gap-3'>
        <div className='flex size-9 shrink-0 items-center justify-center rounded-md bg-[rgb(var(--primary-1))] text-[rgb(var(--primary-6))]'>
          <MessageSquare size={16} />
        </div>
        <div className='min-w-0 flex-1'>
          <div className='flex items-center gap-2'>
            <Typography.Text bold className='truncate'>
              {session.title}
            </Typography.Text>
            <Tag size='small' color='arcoblue'>
              {session.workspaceId}
            </Tag>
          </div>
          <Typography.Text type='secondary' className='block truncate text-xs'>
            {t('ontology.aiBuilder.updatedAt', { time: formatShortDate(session.updatedAt) })}
          </Typography.Text>
        </div>
      </div>
      <div className='flex items-center gap-2'>
        <Button size='small' type='primary' onClick={onOpen}>
          {t('ontology.aiBuilder.open')}
        </Button>
        <Button size='small' icon={<Trash2 size={14} />} onClick={onDelete} status='danger' />
      </div>
    </div>
  );
}

interface INewSessionModalProps {
  api: IOntologyAIBuilderApi;
  visible: boolean;
  currentWorkspaceId: string | null;
  onCancel: () => void;
  onCreated: (session: IOntologyAiBuilderSession) => void;
}

function NewSessionModal({ api, visible, currentWorkspaceId, onCancel, onCreated }: INewSessionModalProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(currentWorkspaceId);
  const [workbenches, setWorkbenches] = useState<IOntologyWorkbenchSummary[]>([]);
  const [sessionCountByWorkspace, setSessionCountByWorkspace] = useState<Record<string, number>>({});
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [isNewCodeManuallyEdited, setIsNewCodeManuallyEdited] = useState(false);
  const [businessGoal, setBusinessGoal] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingWorkbenches, setIsLoadingWorkbenches] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setNewName('');
    setNewCode('');
    setIsNewCodeManuallyEdited(false);
    setBusinessGoal('');
    setSelectedWorkspaceId(currentWorkspaceId);
    setIsLoadingWorkbenches(true);
    // Load workbenches AND existing session counts in parallel so the Select
    // options can hint "已有 N 个会话" — that lets the user know clicking
    // "开始" will actually reuse the newest session, not spawn a fresh chat.
    void Promise.all([api.listWorkbenches(), ipcBridge.ontologyAiBuilder.listSessions.invoke({}).then((res) => (res.success && res.data ? res.data.items : []))])
      .then(([workbenchesRes, sessions]) => {
        setWorkbenches(workbenchesRes.items);
        const counts: Record<string, number> = {};
        for (const session of sessions) counts[session.workspaceId] = (counts[session.workspaceId] ?? 0) + 1;
        setSessionCountByWorkspace(counts);
        if (workbenchesRes.items.length === 0) setMode('new');
        else if (!currentWorkspaceId) setSelectedWorkspaceId(workbenchesRes.items[0].workspaceId);
      })
      .finally(() => setIsLoadingWorkbenches(false));
  }, [visible, api, currentWorkspaceId]);

  const existingCodeSet = useMemo(() => new Set(workbenches.map((item) => item.workspaceId.toLowerCase())), [workbenches]);
  const derivedCodeFromName = useMemo(() => slugifyOntologyCode(newName), [newName]);
  const effectiveNewCode = isNewCodeManuallyEdited ? newCode.trim() : derivedCodeFromName;
  const codeConflict = mode === 'new' && effectiveNewCode.length > 0 && existingCodeSet.has(effectiveNewCode.toLowerCase());
  const codeFormatValid = /^[a-z][a-z0-9_-]{1,63}$/.test(effectiveNewCode);
  const codeError = mode === 'new' && effectiveNewCode.length > 0 && !codeFormatValid ? t('ontology.aiBuilder.modal.newCodeInvalid') : codeConflict ? t('ontology.aiBuilder.modal.newCodeConflict') : null;

  const canSubmit = useMemo(() => {
    if (isSubmitting) return false;
    if (mode === 'existing') return Boolean(selectedWorkspaceId);
    return newName.trim().length > 0 && codeFormatValid && !codeConflict;
  }, [mode, selectedWorkspaceId, newName, isSubmitting, codeFormatValid, codeConflict]);

  const onSubmit = useCallback(async () => {
    setIsSubmitting(true);
    try {
      let workspaceId = mode === 'existing' ? selectedWorkspaceId : null;
      let ontologyTitle = mode === 'existing' ? (workbenches.find((item) => item.workspaceId === selectedWorkspaceId)?.name ?? '') : newName.trim();
      if (mode === 'new') {
        const created = await api.createWorkbench({
          name: newName.trim(),
          code: effectiveNewCode,
          businessGoal: businessGoal.trim() || undefined,
        });
        workspaceId = created.activeWorkspaceId;
        ontologyTitle = newName.trim();
      } else if (workspaceId) {
        await api.selectWorkbench(workspaceId).catch(() => {
          /* non-fatal: selection is a UX convenience */
        });
      }
      if (!workspaceId) {
        Message.error(t('ontology.aiBuilder.errors.noWorkspace'));
        return;
      }
      // If the picked ontology already has AI Builder sessions, reuse the
      // newest one instead of spawning yet another conversation. Only
      // applies to the "existing" branch — "new" always means "fresh".
      if (mode === 'existing') {
        const existingRes = await ipcBridge.ontologyAiBuilder.listSessions.invoke({ workspaceId });
        const existing = existingRes.success && existingRes.data ? [...existingRes.data.items].sort((a, b) => b.updatedAt - a.updatedAt)[0] : null;
        if (existing) {
          onCreated(existing);
          return;
        }
      }
      // Register the ontology-builder MCP BEFORE spawning the acp conversation.
      // Scode reads settings.json at process start, so if we registered after
      // conversation.create the freshly-spawned scode would miss the write
      // tools and the AI would report "ontology_* not found".
      const mcpRes = await ipcBridge.ontologyAiBuilder.ensureBuilderMcp.invoke();
      if (!mcpRes.success || !mcpRes.data) {
        Message.error(mcpRes.msg ?? t('ontology.aiBuilder.errors.createFailed'));
        return;
      }
      const initialPrompt = buildInitialPrompt(t, ontologyTitle || workspaceId, businessGoal.trim());
      const conversation = await ipcBridge.conversation.create.invoke({
        type: 'acp',
        name: t('ontology.aiBuilder.sessionTitle', { title: ontologyTitle || workspaceId }),
        model: {} as never,
        extra: {
          backend: 'scode',
          workspace: '',
          sessionModeParam: 'local',
          // Inject the ontology-builder MCP into session/new so scode actually
          // exposes ontology_* tools to this conversation. Without this the
          // AI just sees generic tools and the workbench stays empty.
          extraMcpConfigs: [mcpRes.data.mcpConfig],
          presetContext: buildPresetContext(t, ontologyTitle || workspaceId, workspaceId),
        },
      });
      if ('__error' in conversation) throw new Error(conversation.__error);
      if (!conversation || !conversation.id) {
        Message.error(t('ontology.aiBuilder.errors.createFailed'));
        return;
      }
      const initialMessage = { input: initialPrompt, files: undefined as string[] | undefined, skills: [] as string[] };
      sessionStorage.setItem(`acp_initial_message_${conversation.id}`, JSON.stringify(initialMessage));

      const registered = await ipcBridge.ontologyAiBuilder.createSession.invoke({
        workspaceId,
        conversationId: conversation.id,
        title: t('ontology.aiBuilder.sessionTitle', { title: ontologyTitle || workspaceId }),
      });
      if (!registered.success || !registered.data) {
        Message.error(registered.msg ?? t('ontology.aiBuilder.errors.createFailed'));
        return;
      }
      onCreated(registered.data);
    } catch (err) {
      Message.error(err instanceof Error ? err.message : t('ontology.aiBuilder.errors.createFailed'));
    } finally {
      setIsSubmitting(false);
    }
  }, [api, businessGoal, mode, newName, onCreated, selectedWorkspaceId, t, workbenches]);

  const willReuseExisting = mode === 'existing' && selectedWorkspaceId ? (sessionCountByWorkspace[selectedWorkspaceId] ?? 0) > 0 : false;

  return (
    <Modal
      visible={visible}
      title={t('ontology.aiBuilder.modal.title')}
      okText={t(willReuseExisting ? 'ontology.aiBuilder.modal.confirmOpen' : 'ontology.aiBuilder.modal.confirm')}
      cancelText={t('ontology.aiBuilder.modal.cancel')}
      okButtonProps={{ disabled: !canSubmit, loading: isSubmitting }}
      onOk={() => void onSubmit()}
      onCancel={onCancel}
      maskClosable={false}
      unmountOnExit
    >
      <div className='flex flex-col gap-4'>
        <div className='flex gap-2'>
          <Button type={mode === 'existing' ? 'primary' : 'outline'} size='small' onClick={() => setMode('existing')} disabled={workbenches.length === 0 && !isLoadingWorkbenches}>
            {t('ontology.aiBuilder.modal.existing')}
          </Button>
          <Button type={mode === 'new' ? 'primary' : 'outline'} size='small' onClick={() => setMode('new')}>
            {t('ontology.aiBuilder.modal.new')}
          </Button>
        </div>
        {mode === 'existing' ? (
          <div>
            <Typography.Text type='secondary' className='mb-2 block text-xs'>
              {t('ontology.aiBuilder.modal.existingHint')}
            </Typography.Text>
            <Select
              placeholder={t('ontology.aiBuilder.modal.selectPlaceholder')}
              value={selectedWorkspaceId ?? undefined}
              onChange={(value: string) => setSelectedWorkspaceId(value)}
              loading={isLoadingWorkbenches}
              options={workbenches.map((item) => {
                const count = sessionCountByWorkspace[item.workspaceId] ?? 0;
                return {
                  value: item.workspaceId,
                  label: count > 0 ? `${item.name} · ${item.workspaceId} · ${t('ontology.aiBuilder.modal.hasExistingSessions', { count })}` : `${item.name} · ${item.workspaceId}`,
                };
              })}
              style={{ width: '100%' }}
            />
          </div>
        ) : (
          <div className='flex flex-col gap-3'>
            <div>
              <Typography.Text type='secondary' className='mb-1 block text-xs'>
                {t('ontology.aiBuilder.modal.newName')}
              </Typography.Text>
              <Input value={newName} onChange={setNewName} placeholder={t('ontology.aiBuilder.modal.newNamePlaceholder')} />
            </div>
            <div>
              <Typography.Text type='secondary' className='mb-1 block text-xs'>
                {t('ontology.aiBuilder.modal.newCode')}
              </Typography.Text>
              <Input
                value={isNewCodeManuallyEdited ? newCode : derivedCodeFromName}
                onChange={(value) => {
                  setNewCode(value);
                  setIsNewCodeManuallyEdited(true);
                }}
                placeholder={t('ontology.aiBuilder.modal.newCodePlaceholder')}
                error={Boolean(codeError)}
              />
              {codeError ? (
                <Typography.Text className='mt-1 block text-xs' style={{ color: 'rgb(var(--danger-6))' }}>
                  {codeError}
                </Typography.Text>
              ) : (
                <Typography.Text type='secondary' className='mt-1 block text-xs'>
                  {t('ontology.aiBuilder.modal.newCodeHint')}
                </Typography.Text>
              )}
            </div>
            <div>
              <Typography.Text type='secondary' className='mb-1 block text-xs'>
                {t('ontology.aiBuilder.modal.businessGoal')}
              </Typography.Text>
              <Input.TextArea value={businessGoal} onChange={setBusinessGoal} placeholder={t('ontology.aiBuilder.modal.businessGoalPlaceholder')} autoSize={{ minRows: 3, maxRows: 6 }} />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function buildInitialPrompt(t: (key: string, opts?: Record<string, unknown>) => string, ontologyTitle: string, businessGoal: string): string {
  const base = t('ontology.aiBuilder.initialPrompt', { title: ontologyTitle });
  if (businessGoal) return `${base}\n\n${t('ontology.aiBuilder.initialPromptGoalLine', { goal: businessGoal })}`;
  return base;
}

function buildPresetContext(t: (key: string, opts?: Record<string, unknown>) => string, ontologyTitle: string, workspaceId: string): string {
  return t('ontology.aiBuilder.presetContext', { title: ontologyTitle, workspaceId });
}

function formatShortDate(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return '';
  }
}

/**
 * Derive an ASCII ontology code from a (possibly Chinese) name. Mirrors the
 * engine's toWorkspaceId/toCode rules so the preview shown to the user
 * matches what the backend will actually assign when the code field is left
 * blank. Chinese-only names collapse to '' — we then fall back to
 * `ontology_<timestamp>` so distinct ontologies never share the same id.
 */
function slugifyOntologyCode(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  const ascii = trimmed
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  if (ascii && /^[a-z]/.test(ascii)) return ascii;
  const suffix = Date.now().toString(36);
  return `ontology_${ascii ? ascii + '_' : ''}${suffix}`;
}
