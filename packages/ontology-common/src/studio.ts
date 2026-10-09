import type { IOntologyAttributeDraft, IOntologyObjectDraft, IOntologyRelationDraft, IOntologyWorkbenchSnapshot } from './index.js';

export const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#';
export const RDFS_NS = 'http://www.w3.org/2000/01/rdf-schema#';
export const OWL_NS = 'http://www.w3.org/2002/07/owl#';
export const XSD_NS = 'http://www.w3.org/2001/XMLSchema#';
export const STUDIO_HISTORY_LIMIT = 50;
export const STUDIO_MAX_FILE_BYTES = 5 * 1024 * 1024;

export type OntologyFileFormat = 'rdfxml' | 'owlxml';
export type OntologyStudioPage = 'model' | 'data' | 'capabilities' | 'checks' | 'release';

export interface IOntologyTerm {
  type: 'iri' | 'blank' | 'literal';
  value: string;
  language?: string;
  datatype?: string;
}

export interface IOntologyStatement {
  subject: IOntologyTerm;
  predicate: string;
  object: IOntologyTerm;
}

/** Lossless standard document; the graph editor exposes a projection of these statements. */
export interface IOntologySemanticDocument {
  baseIri: string;
  prefixes: Record<string, string>;
  statements: IOntologyStatement[];
  imports: string[];
  sourceFormat?: OntologyFileFormat;
  owlAxioms?: Array<{ xml: string; statementKeys: string[] }>;
}

export interface IOntologyStudioModel {
  objects: IOntologyObjectDraft[];
  relations: IOntologyRelationDraft[];
}

export interface IOntologyStudioSaveInput extends IOntologyStudioModel {
  workspaceId: string;
  expectedRevision: number;
  operationId: string;
}

export interface IOntologyStandardPreview {
  document: IOntologySemanticDocument;
  model: IOntologyStudioModel;
  fileName: string;
  fingerprint: string;
  statementCount: number;
  preservedStatementCount: number;
}

export interface IOntologyStandardImportInput {
  workspaceId: string;
  expectedRevision: number;
  operationId: string;
  filePath: string;
  fingerprint: string;
}

export interface IOntologyStandardExportInput {
  workspaceId: string;
  versionId?: string;
  format: OntologyFileFormat;
  model?: IOntologyStudioModel;
  expectedRevision?: number;
}

export interface IOntologyGraphLayout {
  positions: Record<string, { x: number; y: number }>;
}

export function iri(value: string): IOntologyTerm {
  return { type: 'iri', value };
}

export function literal(value: string, datatype = `${XSD_NS}string`, language = ''): IOntologyTerm {
  return { type: 'literal', value, ...(language ? { language } : { datatype }) };
}

export function statement(subject: string, predicate: string, object: IOntologyTerm): IOntologyStatement {
  return { subject: iri(subject), predicate, object };
}

export function statementKey(item: IOntologyStatement): string {
  return JSON.stringify([item.subject.type, item.subject.value, item.predicate, item.object.type, item.object.value, item.object.language || '', item.object.datatype || '']);
}

export function uniqueStatements(items: IOntologyStatement[]): IOntologyStatement[] {
  return [...new Map(items.map((item) => [statementKey(item), item])).values()];
}

export function localIriName(value: string): string {
  const name = value.split(/[#/]/).at(-1) || value;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

export function modelIri(workspaceId: string, id: string): string {
  return `urn:sudowork:ontology:${encodeURIComponent(workspaceId)}:${encodeURIComponent(id)}`;
}

export function createSemanticDocument(workspaceId: string): IOntologySemanticDocument {
  const baseIri = modelIri(workspaceId, 'ontology');
  return { baseIri, prefixes: { rdf: RDF_NS, rdfs: RDFS_NS, owl: OWL_NS, xsd: XSD_NS }, imports: [], statements: [statement(baseIri, `${RDF_NS}type`, iri(`${OWL_NS}Ontology`))] };
}

function termId(kind: string, value: string): string {
  return `${kind}:${value}`;
}

/** Project named classes and properties without inventing closed-world cardinality constraints. */
export function projectSemanticDocument(document: IOntologySemanticDocument, previous: IOntologyStudioModel = { objects: [], relations: [] }): IOntologyStudioModel {
  const index = new Map<string, Map<string, IOntologyStatement[]>>();
  for (const item of document.statements) {
    if (!index.has(item.subject.value)) index.set(item.subject.value, new Map());
    const predicates = index.get(item.subject.value)!;
    predicates.set(item.predicate, [...(predicates.get(item.predicate) || []), item]);
  }
  const values = (_document: IOntologySemanticDocument, subject: string, predicate: string) => (index.get(subject)?.get(predicate) || []).filter((item) => item.object.type === 'iri').map((item) => item.object.value);
  const documentText = (_document: IOntologySemanticDocument, subject: string, predicate: string) => {
    const items = (index.get(subject)?.get(predicate) || []).filter((item) => item.object.type === 'literal');
    return (items.find((item) => item.object.language === 'zh' || item.object.language === 'zh-CN') || items.find((item) => !item.object.language) || items[0])?.object.value || '';
  };
  const uniqueCode = (name: string, reserved: Set<string>) => {
    let code = name;
    let suffix = 1;
    while (reserved.has(code)) code = `${name}_${++suffix}`;
    reserved.add(code);
    return code;
  };
  const classes = new Set<string>();
  const properties = new Set<string>();
  const dataProperties = new Set<string>();
  for (const item of document.statements) {
    if (item.predicate === `${RDF_NS}type` && item.subject.type === 'iri' && item.object.type === 'iri') {
      if ([`${OWL_NS}Class`, `${RDFS_NS}Class`].includes(item.object.value)) classes.add(item.subject.value);
      if (item.object.value === `${OWL_NS}ObjectProperty`) properties.add(item.subject.value);
      if (item.object.value === `${OWL_NS}DatatypeProperty`) dataProperties.add(item.subject.value);
    }
    if (item.predicate === `${RDFS_NS}subClassOf`) {
      if (item.subject.type === 'iri') classes.add(item.subject.value);
      if (item.object.type === 'iri') classes.add(item.object.value);
    }
  }
  for (const property of [...properties, ...dataProperties]) values(document, property, `${RDFS_NS}domain`).forEach((value) => classes.add(value));
  for (const property of properties) values(document, property, `${RDFS_NS}range`).forEach((value) => classes.add(value));
  const previousObjectByIri = new Map(previous.objects.filter((item) => item.iri).map((item) => [item.iri!, item]));
  const reservedCodes = new Set(previous.objects.map((item) => item.code));
  const propertiesByClass = new Map<string, string[]>();
  for (const property of dataProperties) for (const domain of values(document, property, `${RDFS_NS}domain`)) propertiesByClass.set(domain, [...(propertiesByClass.get(domain) || []), property]);
  const objects: IOntologyObjectDraft[] = [...classes].sort().map((classIri) => {
    const prior = previousObjectByIri.get(classIri);
    const name = localIriName(classIri);
    const attributeCodes = new Set(prior?.attributes.map((item) => item.code) || []);
    const attributes: IOntologyAttributeDraft[] = (propertiesByClass.get(classIri) || []).map((property) => {
      const old = prior?.attributes.find((attribute) => attribute.iri === property);
      const datatype = values(document, property, `${RDFS_NS}range`)[0];
      return {
        ...old,
        id: old?.id || termId('attribute', `${classIri}|${property}`),
        iri: property,
        code: old?.code || uniqueCode(localIriName(property), attributeCodes),
        name: documentText(document, property, `${RDFS_NS}label`) || localIriName(property),
        dataType: (index.get(property)?.get(`${RDFS_NS}range`) || []).length > 1 ? 'complex' : datatype ? localIriName(datatype) : index.get(property)?.has(`${RDFS_NS}range`) ? 'complex' : 'unspecified',
        required: old?.required || false,
        description: documentText(document, property, `${RDFS_NS}comment`),
      };
    });
    return {
      ...prior,
      id: prior?.id || termId('class', classIri),
      iri: classIri,
      code: prior?.code || uniqueCode(name, reservedCodes),
      name: documentText(document, classIri, `${RDFS_NS}label`) || name,
      description: documentText(document, classIri, `${RDFS_NS}comment`),
      namespace: classIri.slice(0, classIri.length - localIriName(classIri).length),
      tier: prior?.tier || 1,
      status: prior?.status || 'active',
      sourceAssetIds: prior?.sourceAssetIds || [],
      attributes,
      reviewDecision: prior?.reviewDecision || 'pending',
      updatedAt: prior?.updatedAt || Date.now(),
    };
  });
  const byIri = new Map(objects.map((object) => [object.iri!, object]));
  const relations: IOntologyRelationDraft[] = [];
  const addRelation = (relationIri: string, from: string, to: string, isInheritance: boolean) => {
    const fromObject = byIri.get(from);
    const toObject = byIri.get(to);
    if (!fromObject || !toObject) return;
    const prior = previous.relations.find((item) => item.iri === relationIri && item.fromObjectId === fromObject.id && item.toObjectId === toObject.id);
    const types = values(document, relationIri, `${RDF_NS}type`);
    relations.push({
      ...prior,
      id: prior?.id || termId('relation', `${relationIri}|${from}|${to}`),
      iri: relationIri,
      code: prior?.code || (isInheritance ? `subclass_${relations.length + 1}` : `${localIriName(relationIri)}_${relations.length + 1}`),
      name: isInheritance ? 'subClassOf' : documentText(document, relationIri, `${RDFS_NS}label`) || localIriName(relationIri),
      fromObjectId: fromObject.id,
      toObjectId: toObject.id,
      cardinality: prior?.cardinality || 'unspecified',
      relationType: types.includes(`${OWL_NS}SymmetricProperty`) ? 'symmetric_property' : types.includes(`${OWL_NS}TransitiveProperty`) ? 'transitive_property' : types.includes(`${OWL_NS}FunctionalProperty`) ? 'functional_property' : 'object_property',
      semanticType: isInheritance ? 'inheritance' : prior?.semanticType || 'association',
      isAcyclic: prior?.isAcyclic || false,
      description: isInheritance ? '' : documentText(document, relationIri, `${RDFS_NS}comment`),
      reviewDecision: prior?.reviewDecision || 'pending',
      updatedAt: prior?.updatedAt || Date.now(),
    });
  };
  for (const property of properties) {
    const domains = values(document, property, `${RDFS_NS}domain`);
    const ranges = values(document, property, `${RDFS_NS}range`);
    for (const domain of domains) for (const range of ranges) addRelation(property, domain, range, false);
  }
  for (const item of document.statements) {
    if (item.predicate === `${RDFS_NS}subClassOf` && item.subject.type === 'iri' && item.object.type === 'iri') addRelation(`${RDFS_NS}subClassOf`, item.subject.value, item.object.value, true);
  }
  return { objects, relations };
}

function datatypeIri(type: string): string {
  if (/^[a-z][a-z\d+.-]*:/i.test(type)) return type;
  const aliases: Record<string, string> = { number: 'decimal', datetime: 'dateTime', enum: 'string', uuid: 'string', json: 'string' };
  return `${XSD_NS}${aliases[type] || type}`;
}

/** Apply edits to known statements only; untouched language variants and opaque axioms survive. */
export function reconcileSemanticModel(document: IOntologySemanticDocument, before: IOntologyStudioModel, after: IOntologyStudioModel, workspaceId: string): IOntologySemanticDocument {
  const next = structuredClone(document);
  const removed = new Set<string>();
  const getObjectIri = (object: IOntologyObjectDraft) => object.iri || modelIri(workspaceId, object.id);
  const getAttributeIri = (attribute: IOntologyAttributeDraft) => attribute.iri || modelIri(workspaceId, attribute.id);
  const getRelationIri = (relation: IOntologyRelationDraft) => (relation.iri && relation.iri !== `${RDFS_NS}subClassOf` ? relation.iri : modelIri(workspaceId, relation.id));
  const remove = (predicate: (item: IOntologyStatement) => boolean) => {
    next.statements = next.statements.filter((item) => !predicate(item));
  };
  const add = (subject: string, predicate: string, object: IOntologyTerm) => next.statements.push(statement(subject, predicate, object));
  const setText = (subject: string, predicate: string, value: string) => {
    const candidates = next.statements.filter((item) => item.subject.value === subject && item.predicate === predicate && item.object.type === 'literal');
    const chosen = candidates.find((item) => item.object.language === 'zh' || item.object.language === 'zh-CN') || candidates.find((item) => !item.object.language) || candidates[0];
    if (chosen) remove((item) => item === chosen);
    if (value) add(subject, predicate, literal(value, chosen?.object.datatype, chosen?.object.language));
  };
  const oldObjects = new Map(before.objects.map((item) => [item.id, item]));
  for (const object of after.objects) {
    const prior = oldObjects.get(object.id);
    object.iri = getObjectIri(object);
    if (!prior) add(object.iri, `${RDF_NS}type`, iri(`${OWL_NS}Class`));
    if (!prior || prior.name !== object.name) setText(object.iri, `${RDFS_NS}label`, object.name);
    if (!prior || prior.description !== object.description) setText(object.iri, `${RDFS_NS}comment`, object.description);
    for (const attribute of object.attributes) {
      const old = prior?.attributes.find((item) => item.id === attribute.id);
      attribute.iri = getAttributeIri(attribute);
      if (!old) {
        add(attribute.iri, `${RDF_NS}type`, iri(`${OWL_NS}DatatypeProperty`));
        add(attribute.iri, `${RDFS_NS}domain`, iri(object.iri));
      }
      if (!old || old.name !== attribute.name) setText(attribute.iri, `${RDFS_NS}label`, attribute.name);
      if (!old || old.description !== attribute.description) setText(attribute.iri, `${RDFS_NS}comment`, attribute.description || '');
      if (!old || old.dataType !== attribute.dataType) {
        if (old && next.statements.some((item) => item.subject.value === attribute.iri && item.predicate === `${RDFS_NS}range` && item.object.type === 'blank')) throw new Error('ontology.studio.errors.referencedAxiom');
        remove((item) => item.subject.value === attribute.iri && item.predicate === `${RDFS_NS}range`);
        add(attribute.iri, `${RDFS_NS}range`, iri(datatypeIri(attribute.dataType)));
      }
    }
    for (const old of prior?.attributes || []) {
      if (!object.attributes.some((item) => item.id === old.id)) {
        const property = getAttributeIri(old);
        remove((item) => item.subject.value === property && item.predicate === `${RDFS_NS}domain` && item.object.value === object.iri);
        if (!after.objects.some((item) => item.attributes.some((attr) => getAttributeIri(attr) === property))) removed.add(property);
      }
    }
  }
  for (const relation of before.relations) {
    if (!relation.iri || relation.semanticType === 'inheritance') continue;
    const shared = before.relations.filter((item) => item.iri === relation.iri);
    if (shared.length < 2) continue;
    const remaining = after.relations.filter((item) => item.iri === relation.iri);
    if (!remaining.length) continue;
    const edited = remaining.find((item) => item.id === relation.id);
    if (!edited || edited.fromObjectId !== relation.fromObjectId || edited.toObjectId !== relation.toObjectId || edited.semanticType !== relation.semanticType) throw new Error('ontology.studio.errors.sharedProperty');
  }
  const oldRelations = new Map(before.relations.map((item) => [item.id, item]));
  const endpoints = new Map([...before.objects, ...after.objects].map((object) => [object.id, getObjectIri(object)]));
  const removeRelation = (relation: IOntologyRelationDraft) => {
    const subject = getRelationIri(relation);
    if (relation.semanticType === 'inheritance') remove((item) => item.subject.value === endpoints.get(relation.fromObjectId) && item.predicate === `${RDFS_NS}subClassOf` && item.object.value === endpoints.get(relation.toObjectId));
    else {
      remove((item) => item.subject.value === subject && ((item.predicate === `${RDFS_NS}domain` && item.object.value === endpoints.get(relation.fromObjectId)) || (item.predicate === `${RDFS_NS}range` && item.object.value === endpoints.get(relation.toObjectId))));
    }
  };
  for (const relation of after.relations) {
    const old = oldRelations.get(relation.id);
    relation.iri = relation.semanticType === 'inheritance' ? `${RDFS_NS}subClassOf` : getRelationIri(relation);
    if (old && JSON.stringify(old) === JSON.stringify(relation)) continue;
    if (old) removeRelation(old);
    const from = endpoints.get(relation.fromObjectId);
    const to = endpoints.get(relation.toObjectId);
    if (!from || !to) throw new Error('ontology.studio.errors.invalidReference');
    if (relation.semanticType === 'inheritance') add(from, `${RDFS_NS}subClassOf`, iri(to));
    else {
      add(relation.iri, `${RDF_NS}type`, iri(`${OWL_NS}ObjectProperty`));
      add(relation.iri, `${RDFS_NS}domain`, iri(from));
      add(relation.iri, `${RDFS_NS}range`, iri(to));
      if (!old || old.name !== relation.name) setText(relation.iri, `${RDFS_NS}label`, relation.name);
      if (!old || old.description !== relation.description) setText(relation.iri, `${RDFS_NS}comment`, relation.description || '');
      if (!old || old.relationType !== relation.relationType) {
        const types: Record<string, string> = { symmetric_property: 'SymmetricProperty', transitive_property: 'TransitiveProperty', functional_property: 'FunctionalProperty' };
        remove((item) => item.subject.value === relation.iri && item.predicate === `${RDF_NS}type` && Object.values(types).some((type) => item.object.value === `${OWL_NS}${type}`));
        if (types[relation.relationType]) add(relation.iri, `${RDF_NS}type`, iri(`${OWL_NS}${types[relation.relationType]}`));
      }
    }
  }
  for (const relation of before.relations) {
    if (!after.relations.some((item) => item.id === relation.id)) {
      removeRelation(relation);
      if (relation.semanticType !== 'inheritance' && !after.relations.some((item) => getRelationIri(item) === getRelationIri(relation))) removed.add(getRelationIri(relation));
    }
  }
  for (const object of before.objects) {
    if (!after.objects.some((item) => item.id === object.id)) {
      removed.add(getObjectIri(object));
      object.attributes.forEach((item) => {
        if (!after.objects.some((other) => other.attributes.some((attr) => getAttributeIri(attr) === getAttributeIri(item)))) removed.add(getAttributeIri(item));
      });
    }
  }
  for (const subject of removed) {
    const knownPredicates = new Set([`${RDF_NS}type`, `${RDFS_NS}label`, `${RDFS_NS}comment`, `${RDFS_NS}domain`, `${RDFS_NS}range`]);
    remove((item) => item.subject.value === subject && knownPredicates.has(item.predicate));
    if (next.statements.some((item) => item.subject.value === subject || (item.object.type !== 'literal' && item.object.value === subject))) throw new Error('ontology.studio.errors.referencedAxiom');
  }
  next.statements = uniqueStatements(next.statements);
  return next;
}

export function studioRevision(snapshot: IOntologyWorkbenchSnapshot): number {
  return snapshot.revision || 0;
}
