import { randomUUID } from 'node:crypto';
import { recalculateOntologyStats } from '@sudowork/ontology-common';
import type { IOntologyVersionSnapshot, IOntologyWorkbenchSnapshot, IOntologyPackageOrigin } from '@sudowork/ontology-common';
import { loadOntologyArtifact } from './artifact.js';

export async function restoreOntologyAuthoring(directory: string, input: { workspaceId: string; name?: string; isFork?: boolean; now?: number }) {
  const loaded = await loadOntologyArtifact(directory, {}, true);
  const now = input.now ?? Date.now();
  const { manifest } = loaded;
  const snapshot: IOntologyWorkbenchSnapshot = structuredClone(loaded.snapshot);
  const origin: IOntologyPackageOrigin = { ontologyId: manifest.ontologyId, versionId: manifest.versionId, version: manifest.version, runtimeDigest: manifest.runtimeDigest };
  const versionSnapshot: IOntologyVersionSnapshot = {
    semanticDocument: structuredClone(snapshot.semanticDocument),
    objects: structuredClone(snapshot.objects),
    relations: structuredClone(snapshot.relations),
    mappings: structuredClone(snapshot.mappings),
    qualityRules: structuredClone(snapshot.qualityRules),
    logicFunctions: structuredClone(snapshot.logicFunctions),
    actions: structuredClone(snapshot.actions),
    serviceEndpoints: [],
    businessDocuments: structuredClone(snapshot.businessDocuments),
    agentDefinition: structuredClone(snapshot.agentDefinition),
    authoringDraft: structuredClone(snapshot.draft),
    packageIdentity: structuredClone(snapshot.packageIdentity),
    runtimeEnvironment: { assets: structuredClone(snapshot.assets), connectors: structuredClone(snapshot.connectors) },
  };
  snapshot.workspaceId = input.workspaceId;
  snapshot.createdAt = now;
  snapshot.updatedAt = now;
  snapshot.draft.title = input.name?.trim() || manifest.name;
  snapshot.packageIdentity = { ontologyId: input.isFork ? 'urn:sudowork:ontology:' + randomUUID() : manifest.ontologyId, source: origin };
  snapshot.agentBlueprints = [];
  snapshot.publishedVersions = input.isFork
    ? []
    : [
        {
          id: manifest.versionId,
          ontologyId: manifest.ontologyId,
          version: manifest.version,
          status: 'published',
          isActive: true,
          objectCount: snapshot.objects.length,
          relationCount: snapshot.relations.length,
          summary: snapshot.draft.description,
          diff: { addedObjectIds: [], changedObjectIds: [], removedObjectIds: [], addedRelationIds: [], changedRelationIds: [], removedRelationIds: [], riskLevel: 'low', summary: 'Imported published ontology.' },
          snapshot: versionSnapshot,
          runtimeDigest: manifest.runtimeDigest,
          submittedAt: now,
          publishedAt: now,
          createdAt: now,
        },
      ];
  snapshot.stats = recalculateOntologyStats(snapshot);
  return { ...loaded, snapshot };
}
