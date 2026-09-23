import type { IOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import { ipcBridge } from '@/common';
import { ontologyService } from '@process/services/ontology/OntologyService';
import { mainError } from '@process/utils/mainLogger';

function ok<T>(data: T) {
  return { success: true, data: redactOntologySecrets(data) };
}

function fail(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return { success: false, msg };
}

function emitWorkbenchChanged(snapshot: IOntologyWorkbenchSnapshot): void {
  ipcBridge.ontology.workbenchChanged.emit(redactOntologySecrets(snapshot));
}

function redactOntologySecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => redactOntologySecrets(item)) as T;
  if (!value || typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  const isConnector = typeof record.sourceType === 'string' && typeof record.probeStatus === 'string';
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, item]) => {
      if (isConnector && (key === 'password' || key === 'credential' || key === 'headers')) return [];
      if (isConnector && key === 'credentialRef') return item ? [[key, 'stored']] : [];
      return [[key, redactOntologySecrets(item)]];
    })
  ) as T;
}

export function initOntologyBridge(): void {
  ipcBridge.ontology.listWorkbenches.provider(async () => {
    try {
      return ok(await ontologyService.listWorkbenches());
    } catch (err) {
      mainError('OntologyBridge', 'listWorkbenches failed:', err);
      return fail(err);
    }
  });

  ipcBridge.ontology.getWorkbench.provider(async (input) => {
    try {
      return ok(await ontologyService.getWorkbench(input));
    } catch (err) {
      mainError('OntologyBridge', 'getWorkbench failed:', err);
      return fail(err);
    }
  });

  ipcBridge.ontology.createWorkbench.provider(async (input) => {
    try {
      const result = await ontologyService.createWorkbench(input);
      emitWorkbenchChanged(result.snapshot);
      return ok(result);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.selectWorkbench.provider(async (input) => {
    try {
      const snapshot = await ontologyService.selectWorkbench(input);
      emitWorkbenchChanged(snapshot);
      return ok(snapshot);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.deleteWorkbench.provider(async (input) => {
    try {
      const result = await ontologyService.deleteWorkbench(input);
      emitWorkbenchChanged(result.snapshot);
      return ok(result);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.updateDraft.provider(async (input) => {
    try {
      const snapshot = await ontologyService.updateDraft(input);
      emitWorkbenchChanged(snapshot);
      return ok(snapshot);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.transitionPhase.provider(async (input) => {
    try {
      const snapshot = await ontologyService.transitionPhase(input);
      emitWorkbenchChanged(snapshot);
      return ok(snapshot);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.importFiles.provider(async (input) => {
    try {
      const result = await ontologyService.importFiles(input);
      emitWorkbenchChanged(result.snapshot);
      return ok(result);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.probeConnector.provider(async (input) => {
    try {
      const result = await ontologyService.probeConnector(input);
      emitWorkbenchChanged(result.snapshot);
      return ok(result);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.browseConnectorAssets.provider(async (input) => {
    try {
      return ok(await ontologyService.browseConnectorAssets(input));
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.deleteConnector.provider(async (input) => {
    try {
      const snapshot = await ontologyService.deleteConnector(input);
      emitWorkbenchChanged(snapshot);
      return ok(snapshot);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.deleteAsset.provider(async (input) => {
    try {
      const snapshot = await ontologyService.deleteAsset(input);
      emitWorkbenchChanged(snapshot);
      return ok(snapshot);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.profileAsset.provider(async (input) => {
    try {
      const snapshot = await ontologyService.profileAsset(input);
      emitWorkbenchChanged(snapshot);
      return ok(snapshot);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.syncAssetSchema.provider(async (input) => {
    try {
      const snapshot = await ontologyService.syncAssetSchema(input);
      emitWorkbenchChanged(snapshot);
      return ok(snapshot);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.previewAsset.provider(async (input) => {
    try {
      return ok(await ontologyService.previewAsset(input));
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.generateDraft.provider(async (input) => {
    try {
      const snapshot = await ontologyService.generateDraft(input);
      emitWorkbenchChanged(snapshot);
      return ok(snapshot);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.upsertObject.provider(async (input) => {
    try {
      const snapshot = await ontologyService.upsertObject(input);
      emitWorkbenchChanged(snapshot);
      return ok(snapshot);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.deleteObject.provider(async (input) => {
    try {
      const snapshot = await ontologyService.deleteObject(input);
      emitWorkbenchChanged(snapshot);
      return ok(snapshot);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.upsertAttribute.provider(async (input) => {
    try {
      const snapshot = await ontologyService.upsertAttribute(input);
      emitWorkbenchChanged(snapshot);
      return ok(snapshot);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.deleteAttribute.provider(async (input) => {
    try {
      const snapshot = await ontologyService.deleteAttribute(input);
      emitWorkbenchChanged(snapshot);
      return ok(snapshot);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.upsertRelation.provider(async (input) => {
    try {
      const snapshot = await ontologyService.upsertRelation(input);
      emitWorkbenchChanged(snapshot);
      return ok(snapshot);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.deleteRelation.provider(async (input) => {
    try {
      const snapshot = await ontologyService.deleteRelation(input);
      emitWorkbenchChanged(snapshot);
      return ok(snapshot);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.upsertMapping.provider(async (input) => {
    try {
      const snapshot = await ontologyService.upsertMapping(input);
      emitWorkbenchChanged(snapshot);
      return ok(snapshot);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.deleteMapping.provider(async (input) => {
    try {
      const snapshot = await ontologyService.deleteMapping(input);
      emitWorkbenchChanged(snapshot);
      return ok(snapshot);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.upsertQualityRule.provider(async (input) => {
    try {
      const snapshot = await ontologyService.upsertQualityRule(input);
      emitWorkbenchChanged(snapshot);
      return ok(snapshot);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.deleteQualityRule.provider(async (input) => {
    try {
      const snapshot = await ontologyService.deleteQualityRule(input);
      emitWorkbenchChanged(snapshot);
      return ok(snapshot);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.upsertLogicFunction.provider(async (input) => {
    try {
      const snapshot = await ontologyService.upsertLogicFunction(input);
      emitWorkbenchChanged(snapshot);
      return ok(snapshot);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.deleteLogicFunction.provider(async (input) => {
    try {
      const snapshot = await ontologyService.deleteLogicFunction(input);
      emitWorkbenchChanged(snapshot);
      return ok(snapshot);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.upsertAction.provider(async (input) => {
    try {
      const snapshot = await ontologyService.upsertAction(input);
      emitWorkbenchChanged(snapshot);
      return ok(snapshot);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.deleteAction.provider(async (input) => {
    try {
      const snapshot = await ontologyService.deleteAction(input);
      emitWorkbenchChanged(snapshot);
      return ok(snapshot);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.executeLogicFunction.provider(async (input) => {
    try {
      const result = await ontologyService.executeLogicFunction(input);
      emitWorkbenchChanged(result.snapshot);
      return ok(result);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.executeRelation.provider(async (input) => {
    try {
      return ok(await ontologyService.executeRelation(input));
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.executeAction.provider(async (input) => {
    try {
      const result = await ontologyService.executeAction(input);
      emitWorkbenchChanged(result.snapshot);
      return ok(result);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.reviewTarget.provider(async (input) => {
    try {
      const snapshot = await ontologyService.reviewTarget(input);
      emitWorkbenchChanged(snapshot);
      return ok(snapshot);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.approveAll.provider(async () => {
    try {
      const snapshot = await ontologyService.approveAll();
      emitWorkbenchChanged(snapshot);
      return ok(snapshot);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.runConsistencyCheck.provider(async (input) => {
    try {
      return ok(await ontologyService.runConsistencyCheck(input));
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.publishCurrentDraft.provider(async (input) => {
    try {
      const result = await ontologyService.publishCurrentDraft(input);
      emitWorkbenchChanged(result.snapshot);
      return ok(result);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.approvePublishedVersion.provider(async (input) => {
    try {
      const snapshot = await ontologyService.approvePublishedVersion(input);
      emitWorkbenchChanged(snapshot);
      return ok(snapshot);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.rejectPublishedVersion.provider(async (input) => {
    try {
      const snapshot = await ontologyService.rejectPublishedVersion(input);
      emitWorkbenchChanged(snapshot);
      return ok(snapshot);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.rollbackToVersion.provider(async (input) => {
    try {
      const snapshot = await ontologyService.rollbackToVersion(input);
      emitWorkbenchChanged(snapshot);
      return ok(snapshot);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.createAgentBlueprint.provider(async (input) => {
    try {
      const result = await ontologyService.createAgentBlueprint(input);
      emitWorkbenchChanged(result.snapshot);
      return ok(result);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.registerAgentBlueprint.provider(async (input) => {
    try {
      const result = await ontologyService.registerAgentBlueprint(input);
      emitWorkbenchChanged(result.snapshot);
      return ok(result);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.deleteAgentBlueprint.provider(async (input) => {
    try {
      const snapshot = await ontologyService.deleteAgentBlueprint(input);
      emitWorkbenchChanged(snapshot);
      return ok(snapshot);
    } catch (err) {
      return fail(err);
    }
  });

  ipcBridge.ontology.resetWorkbench.provider(async () => {
    try {
      const snapshot = await ontologyService.resetWorkbench();
      emitWorkbenchChanged(snapshot);
      return ok(snapshot);
    } catch (err) {
      return fail(err);
    }
  });
}
