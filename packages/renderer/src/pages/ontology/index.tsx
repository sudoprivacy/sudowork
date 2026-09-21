import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import { OntologyWorkbench } from '@sudowork/ontology-ui';
import { ONTOLOGY_DOCUMENT_EXTENSIONS } from '@sudowork/ontology-common';
import type { IOntologyWorkbenchApi } from '@sudowork/ontology-ui/OntologyWorkbench';
import { OntologyAIBuilderPage } from '@sudowork/ontology-ai';
import type { IOntologyAIBuilderApi } from '@sudowork/ontology-ai';

type WorkbenchView = 'connections' | 'assets' | 'ai_builder' | 'ontology' | 'publish' | 'agent';

function unwrap<T>(res: { success: boolean; data?: T; msg?: string }, fallback: string): T {
  if (!res.success || res.data === undefined) throw new Error(res.msg || fallback);
  return res.data;
}

export default function OntologyPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Bumped by the floating bubble to signal the AI 构建 tab to auto-open the new-session modal.
  const [openNewSessionSignal, setOpenNewSessionSignal] = useState(0);
  const activateViewRef = useRef<(view: WorkbenchView) => void>(() => {});

  const api = useMemo<IOntologyWorkbenchApi>(
    () => ({
      listWorkbenches: async () => unwrap(await ipcBridge.ontology.listWorkbenches.invoke(), t('ontology.errors.loadFailed')),
      getWorkbench: async (input) => unwrap(await ipcBridge.ontology.getWorkbench.invoke(input), t('ontology.errors.loadFailed')),
      createWorkbench: async (input) => unwrap(await ipcBridge.ontology.createWorkbench.invoke(input), t('ontology.errors.operationFailed')),
      selectWorkbench: async (input) => unwrap(await ipcBridge.ontology.selectWorkbench.invoke(input), t('ontology.errors.loadFailed')),
      deleteWorkbench: async (input) => unwrap(await ipcBridge.ontology.deleteWorkbench.invoke(input), t('ontology.errors.operationFailed')),
      updateDraft: async (input) => unwrap(await ipcBridge.ontology.updateDraft.invoke(input), t('ontology.errors.saveFailed')),
      transitionPhase: async (input) => unwrap(await ipcBridge.ontology.transitionPhase.invoke(input), t('ontology.errors.operationFailed')),
      pickBuildFiles: async (method) => {
        const result = unwrap(
          await ipcBridge.dialog.showOpen.invoke({
            properties: method === 'document' ? ['openFile', 'multiSelections'] : ['openFile'],
            filters: [method === 'document' ? { name: t('ontology.documentBuilder.documentFiles'), extensions: [...ONTOLOGY_DOCUMENT_EXTENSIONS] } : { name: t('ontology.objectBuilder.templateFiles'), extensions: ['json', 'xls', 'xlsx', 'owl', 'rdf', 'ttl'] }],
          }),
          t('ontology.errors.importFailed')
        );
        return result.canceled ? [] : result.filePaths;
      },
      importFiles: async (input) => unwrap(await ipcBridge.ontology.importFiles.invoke(input), t('ontology.errors.importFailed')),
      probeConnector: async (input) => unwrap(await ipcBridge.ontology.probeConnector.invoke(input), t('ontology.errors.importFailed')),
      browseConnectorAssets: async (input) => unwrap(await ipcBridge.ontology.browseConnectorAssets.invoke(input), t('ontology.errors.operationFailed')),
      deleteConnector: async (input) => unwrap(await ipcBridge.ontology.deleteConnector.invoke(input), t('ontology.errors.operationFailed')),
      deleteAsset: async (input) => unwrap(await ipcBridge.ontology.deleteAsset.invoke(input), t('ontology.errors.operationFailed')),
      profileAsset: async (input) => unwrap(await ipcBridge.ontology.profileAsset.invoke(input), t('ontology.errors.operationFailed')),
      syncAssetSchema: async (input) => unwrap(await ipcBridge.ontology.syncAssetSchema.invoke(input), t('ontology.errors.operationFailed')),
      previewAsset: async (input) => unwrap(await ipcBridge.ontology.previewAsset.invoke(input), t('ontology.errors.operationFailed')),
      generateDraft: async (input) => unwrap(await ipcBridge.ontology.generateDraft.invoke(input), t('ontology.errors.generateFailed')),
      upsertObject: async (input) => unwrap(await ipcBridge.ontology.upsertObject.invoke(input), t('ontology.errors.operationFailed')),
      deleteObject: async (input) => unwrap(await ipcBridge.ontology.deleteObject.invoke(input), t('ontology.errors.operationFailed')),
      upsertAttribute: async (input) => unwrap(await ipcBridge.ontology.upsertAttribute.invoke(input), t('ontology.errors.operationFailed')),
      deleteAttribute: async (input) => unwrap(await ipcBridge.ontology.deleteAttribute.invoke(input), t('ontology.errors.operationFailed')),
      upsertRelation: async (input) => unwrap(await ipcBridge.ontology.upsertRelation.invoke(input), t('ontology.errors.operationFailed')),
      deleteRelation: async (input) => unwrap(await ipcBridge.ontology.deleteRelation.invoke(input), t('ontology.errors.operationFailed')),
      upsertMapping: async (input) => unwrap(await ipcBridge.ontology.upsertMapping.invoke(input), t('ontology.errors.operationFailed')),
      deleteMapping: async (input) => unwrap(await ipcBridge.ontology.deleteMapping.invoke(input), t('ontology.errors.operationFailed')),
      upsertQualityRule: async (input) => unwrap(await ipcBridge.ontology.upsertQualityRule.invoke(input), t('ontology.errors.operationFailed')),
      deleteQualityRule: async (input) => unwrap(await ipcBridge.ontology.deleteQualityRule.invoke(input), t('ontology.errors.operationFailed')),
      upsertLogicFunction: async (input) => unwrap(await ipcBridge.ontology.upsertLogicFunction.invoke(input), t('ontology.errors.operationFailed')),
      deleteLogicFunction: async (input) => unwrap(await ipcBridge.ontology.deleteLogicFunction.invoke(input), t('ontology.errors.operationFailed')),
      upsertAction: async (input) => unwrap(await ipcBridge.ontology.upsertAction.invoke(input), t('ontology.errors.operationFailed')),
      deleteAction: async (input) => unwrap(await ipcBridge.ontology.deleteAction.invoke(input), t('ontology.errors.operationFailed')),
      reviewTarget: async (input) => unwrap(await ipcBridge.ontology.reviewTarget.invoke(input), t('ontology.errors.reviewFailed')),
      approveAll: async () => unwrap(await ipcBridge.ontology.approveAll.invoke(), t('ontology.errors.reviewFailed')),
      runConsistencyCheck: async (input) => unwrap(await ipcBridge.ontology.runConsistencyCheck.invoke(input), t('ontology.errors.checkFailed')),
      publishCurrentDraft: async (input) => unwrap(await ipcBridge.ontology.publishCurrentDraft.invoke(input), t('ontology.errors.publishFailed')),
      approvePublishedVersion: async (input) => unwrap(await ipcBridge.ontology.approvePublishedVersion.invoke(input), t('ontology.errors.publishFailed')),
      rejectPublishedVersion: async (input) => unwrap(await ipcBridge.ontology.rejectPublishedVersion.invoke(input), t('ontology.errors.publishFailed')),
      rollbackToVersion: async (input) => unwrap(await ipcBridge.ontology.rollbackToVersion.invoke(input), t('ontology.errors.publishFailed')),
      createAgentBlueprint: async (input) => unwrap(await ipcBridge.ontology.createAgentBlueprint.invoke(input), t('ontology.errors.agentFailed')),
      registerAgentBlueprint: async (input) => unwrap(await ipcBridge.ontology.registerAgentBlueprint.invoke(input), t('ontology.errors.agentFailed')),
      deleteAgentBlueprint: async (input) => unwrap(await ipcBridge.ontology.deleteAgentBlueprint.invoke(input), t('ontology.errors.agentFailed')),
      resetWorkbench: async () => unwrap(await ipcBridge.ontology.resetWorkbench.invoke(), t('ontology.errors.resetFailed')),
      onWorkbenchChanged: (onChanged) => ipcBridge.ontology.workbenchChanged.on(onChanged),
    }),
    [t]
  );

  const aiBuilderApi = useMemo<Omit<IOntologyAIBuilderApi, 'openNewSessionSignal'>>(
    () => ({
      listWorkbenches: async () => unwrap(await ipcBridge.ontology.listWorkbenches.invoke(), t('ontology.errors.loadFailed')),
      createWorkbench: async (input) => unwrap(await ipcBridge.ontology.createWorkbench.invoke(input), t('ontology.errors.operationFailed')),
      selectWorkbench: async (workspaceId) => {
        await ipcBridge.ontology.selectWorkbench.invoke({ workspaceId });
      },
      navigateToConversation: (id) => {
        void navigate(`/conversation/${id}`);
      },
    }),
    [t, navigate]
  );

  const renderAiBuilder = useCallback((workspaceId: string | null) => <OntologyAIBuilderPage workspaceId={workspaceId} api={{ ...aiBuilderApi, openNewSessionSignal }} />, [aiBuilderApi, openNewSessionSignal]);

  const onBubbleClick = useCallback(() => {
    activateViewRef.current('ai_builder');
    setOpenNewSessionSignal((value) => value + 1);
  }, []);

  return (
    <>
      <OntologyWorkbench
        api={api}
        renderAiBuilder={renderAiBuilder}
        onExposeActivateView={(activate) => {
          activateViewRef.current = activate;
        }}
      />
      <FloatingBubble label={t('ontology.aiBuilder.bubbleTooltip')} onClick={onBubbleClick} />
    </>
  );
}

interface IFloatingBubbleProps {
  label: string;
  onClick: () => void;
}

/**
 * Simple sparkle bubble that opens the "AI 构建" tab and asks it to pop the
 * new-session modal. All state coordination happens in the parent page.
 */
function FloatingBubble({ label, onClick }: IFloatingBubbleProps) {
  return (
    <button
      type='button'
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        position: 'fixed',
        right: '24px',
        bottom: '80px',
        zIndex: 999,
        width: '56px',
        height: '56px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '9999px',
        border: 'none',
        cursor: 'pointer',
        background: 'linear-gradient(135deg, #ff7d00 0%, #ff5000 100%)',
        color: '#ffffff',
        boxShadow: '0 6px 20px rgba(255, 125, 0, 0.35), 0 2px 6px rgba(0, 0, 0, 0.1)',
        transition: 'transform 120ms ease',
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.transform = 'scale(1.06)';
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.transform = 'scale(1)';
      }}
    >
      <Sparkles size={24} color='#ffffff' strokeWidth={2.4} />
    </button>
  );
}
