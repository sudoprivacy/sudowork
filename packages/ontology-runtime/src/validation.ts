import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { IOntologyPackageCapability, IOntologyPackageResource, IOntologyWorkbenchSnapshot } from '@sudowork/ontology-common';

const identifier = z.string().min(1).max(4096);
export const ontologyDependencySchema = z.array(z.object({ runtime: z.enum(['node', 'python', 'system']), name: z.string().min(1).max(200), version: z.string().min(1).max(100) }).strict());
const parameter = z.object({ name: identifier, type: identifier, required: z.boolean() }).passthrough();
const artifact = z.object({ id: identifier, code: identifier, name: z.string(), configuration: z.record(z.unknown()), parameters: z.array(parameter), objectIds: z.array(identifier), status: z.enum(['draft', 'active', 'disabled']) }).passthrough();
const modelSchema = z
  .object({
    objects: z.array(z.object({ id: identifier, code: identifier, sourceAssetIds: z.array(identifier), attributes: z.array(z.object({ id: identifier, code: identifier }).passthrough()) }).passthrough()),
    relations: z.array(z.object({ id: identifier, code: identifier, fromObjectId: identifier, toObjectId: identifier }).passthrough()),
    mappings: z.array(z.object({ objectId: identifier, attributeId: identifier, assetId: identifier, fieldName: identifier }).passthrough()),
    qualityRules: z.array(z.object({ id: identifier, objectId: identifier, expression: z.string() }).passthrough()),
    logicFunctions: z.array(artifact.extend({ body: z.string(), runtime: z.enum(['sql', 'typescript', 'python']) })),
    actions: z.array(artifact.extend({ executor: z.enum(['sql', 'api', 'notification', 'custom_script', 'function']), outputSchema: z.array(z.unknown()) })),
    assets: z.array(z.object({ id: identifier, name: z.string(), fields: z.array(z.object({ name: z.string(), dataType: z.string() }).passthrough()), metadata: z.record(z.unknown()), path: z.undefined().optional() }).passthrough()),
    connectors: z.array(z.object({ id: identifier, name: z.string(), kind: z.string(), sourceType: z.string(), writable: z.literal(false), metadata: z.record(z.unknown()), probeStatus: z.string(), createdAt: z.number(), updatedAt: z.number() }).strict()),
  })
  .passthrough();

export function validateOntologyPackageModel(value: unknown, capabilities: IOntologyPackageCapability[], resources: IOntologyPackageResource[]): void {
  const model = modelSchema.parse(value) as unknown as IOntologyWorkbenchSnapshot;
  const assertUnique = (ids: string[]) => {
    if (new Set(ids).size !== ids.length) throw new Error('Duplicate package identity.');
  };
  for (const collection of [model.objects, model.relations, model.assets, model.connectors, model.logicFunctions, model.actions]) assertUnique(collection.map((item) => item.id));
  assertUnique(capabilities.map((item) => item.id));
  assertUnique(resources.map((item) => item.id));
  const assetIds = new Set(model.assets.map((item) => item.id));
  const objectIds = new Set(model.objects.map((item) => item.id));
  const resourceIds = new Set(resources.map((item) => item.id));
  if (
    model.objects.some((object) => object.sourceAssetIds.some((id) => !assetIds.has(id))) ||
    model.relations.some((relation) => !objectIds.has(relation.fromObjectId) || !objectIds.has(relation.toObjectId)) ||
    model.mappings.some((mapping) => !assetIds.has(mapping.assetId) || !model.objects.find((object) => object.id === mapping.objectId)?.attributes.some((attribute) => attribute.id === mapping.attributeId)) ||
    model.qualityRules.some((rule) => !objectIds.has(rule.objectId))
  )
    throw new Error('Package model contains unresolved references.');
  for (const resource of resources) {
    if (!Array.isArray(resource.assetIds) || !Array.isArray(resource.requiredFields) || resource.assetIds.some((id) => !assetIds.has(id))) throw new Error('Invalid resource contract.');
  }
  for (const connection of model.connectors) if (!resources.some((resource) => resource.id === connection.id && resource.provider === connection.sourceType)) throw new Error('Connection resource contract is missing.');
  for (const capability of capabilities) {
    const entries = capability.kind === 'logic' ? model.logicFunctions : capability.kind === 'action' ? model.actions : capability.kind === 'relation' ? model.relations : [];
    const target = entries.find((item) => item.id === capability.artifactId);
    if (!target || capability.id !== capability.kind + '.' + target.code || !Array.isArray(capability.resourceRefs) || capability.resourceRefs.some((id) => !resourceIds.has(id))) throw new Error('Invalid capability contract.');
    if (capability.isReadOnly !== (capability.kind !== 'action') || typeof capability.isEnabled !== 'boolean' || ('status' in target && capability.isEnabled !== (target.status === 'active'))) throw new Error('Capability permissions do not match its implementation.');
    if ('parameters' in target && !isDeepStrictEqual(target.parameters, capability.parameters)) throw new Error('Capability parameters do not match its implementation.');
    z.array(parameter).parse(capability.parameters);
  }
  for (const [kind, entries] of [
    ['logic', model.logicFunctions],
    ['action', model.actions],
  ] as const)
    for (const entry of entries) {
      if (!capabilities.some((capability) => capability.kind === kind && capability.artifactId === entry.id)) throw new Error('Editable implementation is missing from the capability catalog.');
      if (entry.objectIds.some((id) => !objectIds.has(id))) throw new Error('Capability object reference is missing.');
    }
}
