import type { IOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';
import { redactOntologySecrets } from '@process/services/ontology/ontologySnapshot';
import { ipcBridge } from '@/common';
import { ontologyService } from '@process/services/ontology/OntologyService';
import { mainError } from '@process/utils/mainLogger';
import { SudographCompilerError } from '@process/services/ontology/SudographModelClient';
import { getLocalBrowserSessions } from '@process/services/browserPanel/localBrowserSessionHost';

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

export function initOntologyBridge(): void {
  ipcBridge.ontology.previewRuntimePackage.provider(async (input) => {
    try {
      return ok(await ontologyService.previewRuntimePackage(input));
    } catch (error) {
      return fail(error);
    }
  });
  ipcBridge.ontology.importRuntimePackage.provider(async (input) => {
    try {
      const snapshot = await ontologyService.importRuntimePackage(input);
      ipcBridge.ontology.projectsChanged.emit({ workspaceId: snapshot.workspaceId });
      emitWorkbenchChanged(snapshot);
      return ok(snapshot);
    } catch (error) {
      return fail(error);
    }
  });
  ipcBridge.ontology.getRuntimeEnvironment.provider(async (input) => {
    try {
      return ok(await ontologyService.getRuntimeEnvironment(input));
    } catch (error) {
      return fail(error);
    }
  });
  ipcBridge.ontology.configureRuntimeEnvironment.provider(async (input) => {
    try {
      const result = await ontologyService.configureRuntimeEnvironment(input);
      emitWorkbenchChanged(await ontologyService.getWorkbench(input));
      return ok(result);
    } catch (error) {
      return fail(error);
    }
  });
  ipcBridge.ontology.verifyRuntimeEnvironment.provider(async (input) => {
    try {
      return ok(await ontologyService.verifyRuntimeEnvironment(input));
    } catch (error) {
      return fail(error);
    }
  });
  ipcBridge.ontology.updateAgentDefinition.provider(async (input) => {
    try {
      const snapshot = await ontologyService.updateAgentDefinition(input);
      emitWorkbenchChanged(snapshot);
      return ok(snapshot);
    } catch (error) {
      return fail(error);
    }
  });
  ipcBridge.ontology.planRuntimePackage.provider(async (input) => {
    try {
      return ok(await ontologyService.planRuntimePackage(input));
    } catch (error) {
      return fail(error);
    }
  });
  ipcBridge.ontology.exportRuntimePackage.provider(async (input) => {
    try {
      return ok(await ontologyService.exportRuntimePackage(input, (event) => ipcBridge.ontology.packageExportProgress.emit(event)));
    } catch (error) {
      return fail(error);
    }
  });
  ipcBridge.ontology.cancelRuntimePackageExport.provider(async ({ requestId }) => {
    ontologyService.cancelRuntimePackageExport(requestId);
    return ok(undefined);
  });
  ontologyService.onAgentRegistrationChanged(emitWorkbenchChanged);
  ipcBridge.ontology.openReview.provider(async (input) => {
    let launch: Awaited<ReturnType<typeof ontologyService.createStudioReviewSession>> | undefined;
    try {
      launch = await ontologyService.createStudioReviewSession(input);
      return ok(await getLocalBrowserSessions().openAuthorizedPage(input.conversationId, launch));
    } catch (error) {
      await launch?.revoke();
      mainError('Ontology review', 'Could not open the bound review.', error instanceof Error ? error.stack : String(error));
      return fail(error);
    }
  });
  ipcBridge.ontology.listProjects.provider(async () => {
    try {
      return ok(await ontologyService.listStudioProjects());
    } catch (err) {
      return fail(err);
    }
  });
  ipcBridge.ontology.getProject.provider(async (input) => {
    try {
      return ok(await ontologyService.getStudioProject(input));
    } catch (err) {
      return fail(err);
    }
  });
  ipcBridge.ontology.resumeSource.provider(async (input) => {
    try {
      return ok(await ontologyService.resumeStudioSource(input));
    } catch (err) {
      return fail(err);
    }
  });
  ipcBridge.ontology.connectSource.provider(async (input) => {
    try {
      const project = await ontologyService.connectStudioSource(input);
      ipcBridge.ontology.projectsChanged.emit({ workspaceId: project.workspaceId });
      return ok(project);
    } catch (err) {
      if (err instanceof SudographCompilerError) return { success: false, msg: `[${err.code}] ${err.message}\n${typeof err.recovery === 'string' ? err.recovery : JSON.stringify(err.recovery)}` };
      return fail(err);
    }
  });
  ipcBridge.ontology.saveStudioModel.provider(async (input) => {
    try {
      const snapshot = await ontologyService.saveStudioModel(input);
      emitWorkbenchChanged(snapshot);
      return ok(snapshot);
    } catch (error) {
      return fail(error);
    }
  });
  ipcBridge.ontology.previewStandardFile.provider(async (input) => {
    try {
      return ok(await ontologyService.previewStandardFile(input));
    } catch (error) {
      return fail(error);
    }
  });
  ipcBridge.ontology.importStandardFile.provider(async (input) => {
    try {
      const snapshot = await ontologyService.importStandardFile(input);
      emitWorkbenchChanged(snapshot);
      return ok(snapshot);
    } catch (error) {
      return fail(error);
    }
  });
  ipcBridge.ontology.exportStandardFile.provider(async (input) => {
    try {
      return ok(await ontologyService.exportStandardFile(input));
    } catch (error) {
      return fail(error);
    }
  });
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
      ipcBridge.ontology.projectsChanged.emit({ workspaceId: input.workspaceId });
      if (result.activeWorkspaceId) emitWorkbenchChanged(result.snapshot);
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

  ipcBridge.ontology.describeAssetFields.provider(async (input) => {
    try {
      const snapshot = await ontologyService.describeAssetFields(input);
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
