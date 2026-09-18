import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import { OntologyWorkbench } from '@sudowork/ontology-ui';
import type { IOntologyWorkbenchApi } from '@sudowork/ontology-ui/OntologyWorkbench';

function unwrap<T>(res: { success: boolean; data?: T; msg?: string }, fallback: string): T {
  if (!res.success || res.data === undefined) throw new Error(res.msg || fallback);
  return res.data;
}

export default function OntologyPage() {
  const { t } = useTranslation();
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
            filters: [method === 'document' ? { name: t('ontology.objectBuilder.documentFiles'), extensions: ['md', 'txt', 'pdf', 'doc', 'docx', 'ppt', 'pptx', 'csv', 'xls', 'xlsx'] } : { name: t('ontology.objectBuilder.templateFiles'), extensions: ['json', 'xls', 'xlsx', 'owl', 'rdf', 'ttl'] }],
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

  return <OntologyWorkbench api={api} />;
}
