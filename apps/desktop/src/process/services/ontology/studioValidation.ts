import { z } from 'zod';

const id = z.string().min(1).max(4096);
const attribute = z.object({
  id,
  iri: z.string().optional(),
  code: id,
  name: id,
  dataType: id,
  required: z.boolean(),
  description: z.string().max(20_000).optional(),
  example: z.string().optional(),
  isIdentifier: z.boolean().optional(),
  constraints: z.object({ min: z.number().optional(), max: z.number().optional(), minLength: z.number().optional(), maxLength: z.number().optional(), pattern: z.string().optional(), enumValues: z.array(z.string()).optional(), refTarget: z.string().optional() }).optional(),
  mappedField: z.object({ assetId: id, fieldName: id }).optional(),
});
const object = z.object({
  id: id,
  iri: z.string().optional(),
  code: id,
  name: id,
  description: z.string().max(20_000),
  namespace: z.string().optional(),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  status: z.enum(['active', 'warning', 'error']),
  sourceAssetIds: z.array(id),
  attributes: z.array(attribute).max(300),
  reviewDecision: z.enum(['pending', 'approved', 'changes_requested', 'rejected']),
  updatedAt: z.number(),
});
const relation = z.object({
  id,
  iri: z.string().optional(),
  code: id,
  name: id,
  fromObjectId: id,
  toObjectId: id,
  cardinality: z.enum(['unspecified', 'one_to_one', 'one_to_many', 'many_to_one', 'many_to_many']),
  relationType: z.enum(['object_property', 'symmetric_property', 'transitive_property', 'functional_property']),
  semanticType: z.enum(['composition', 'event', 'inheritance', 'dependency', 'association']),
  isAcyclic: z.boolean(),
  description: z.string().optional(),
  reviewDecision: z.enum(['pending', 'approved', 'changes_requested', 'rejected']),
  updatedAt: z.number(),
  dataBinding: z
    .object({
      mode: z.enum(['semantic_only', 'direct', 'junction']),
      joinKeys: z.array(z.object({ fromAttributeId: id, toAttributeId: id, junctionFromFieldName: z.string().optional(), junctionToFieldName: z.string().optional() })),
      junctionAssetId: z.string().optional(),
      origin: z.enum(['inferred', 'manual']).optional(),
    })
    .optional(),
});

export const studioSaveSchema = z.object({ workspaceId: id, expectedRevision: z.number().int().nonnegative(), operationId: z.string().min(1).max(100), objects: z.array(object).max(2000), relations: z.array(relation).max(10_000) }).superRefine((input, ctx) => {
  const objectIds = new Set(input.objects.map((item) => item.id));
  const relationIds = new Set(input.relations.map((item) => item.id));
  const attributeIds = input.objects.flatMap((item) => item.attributes.map((attr) => attr.id));
  if (objectIds.size !== input.objects.length || relationIds.size !== input.relations.length || new Set(attributeIds).size !== attributeIds.length) ctx.addIssue({ code: 'custom', message: 'ontology.studio.errors.duplicateId' });
  if (input.relations.some((item) => !objectIds.has(item.fromObjectId) || !objectIds.has(item.toObjectId))) ctx.addIssue({ code: 'custom', message: 'ontology.studio.errors.invalidReference' });
  for (const item of input.objects) {
    if (new Set(item.attributes.map((attr) => attr.code)).size !== item.attributes.length) ctx.addIssue({ code: 'custom', message: 'ontology.studio.errors.duplicateId' });
  }
});
