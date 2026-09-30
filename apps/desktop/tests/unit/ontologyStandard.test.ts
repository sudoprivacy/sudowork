import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseStandardOntology, exportStandardOntology } from '@sudowork/ontology-engine';
import { OWL_NS, RDF_NS, RDFS_NS, XSD_NS, createSemanticDocument, reconcileSemanticModel, statementKey } from '@sudowork/ontology-common';
import type { IOntologyStudioModel, IOntologySemanticDocument } from '@sudowork/ontology-common';

const namespaces = `xmlns:rdf="${RDF_NS}" xmlns:rdfs="${RDFS_NS}" xmlns:owl="${OWL_NS}" xmlns:ex="https://example.org/"`;
const fixture = `<rdf:RDF ${namespaces} xml:base="https://example.org/">
<owl:Ontology rdf:about="https://example.org/ontology"/>
<owl:Class rdf:about="#Order"><rdfs:label xml:lang="zh">订单</rdfs:label><rdfs:label xml:lang="en">Order</rdfs:label><rdfs:subClassOf><owl:Restriction><owl:onProperty rdf:resource="#contains"/><owl:someValuesFrom rdf:resource="#Line"/></owl:Restriction></rdfs:subClassOf></owl:Class>
<owl:Class rdf:about="#Line"/>
<owl:ObjectProperty rdf:about="#contains"><rdfs:domain rdf:resource="#Order"/><rdfs:range rdf:resource="#Line"/><rdfs:label>包含</rdfs:label></owl:ObjectProperty>
<owl:DatatypeProperty rdf:about="#date"><rdfs:domain rdf:resource="#Order"/><rdfs:range rdf:resource="${XSD_NS}date"/><rdfs:label>交付日</rdfs:label></owl:DatatypeProperty>
<rdf:Description rdf:about="#order-1"><rdf:type rdf:resource="#Order"/><ex:note xml:lang="zh">保留原始断言 &amp; 注释</ex:note></rdf:Description>
</rdf:RDF>`;

function normalized(document: IOntologySemanticDocument) {
  return document.statements.map((item) => JSON.stringify({ ...item, subject: item.subject.type === 'blank' ? { ...item.subject, value: 'blank' } : item.subject, object: item.object.type === 'blank' ? { ...item.object, value: 'blank' } : item.object })).sort();
}

describe('standard ontology exchange', () => {
  it('parses namespaces, relative IRIs, labels, properties and restrictions', async () => {
    const result = await parseStandardOntology(fixture);
    expect(result.model.objects).toHaveLength(2);
    const order = result.model.objects.find((item) => item.name === '订单')!;
    expect(order.iri).toBe('https://example.org/#Order');
    expect(order.attributes[0].dataType).toBe('date');
    expect(result.model.relations[0].cardinality).toBe('unspecified');
    expect(result.document.statements.some((item) => item.object.value === `${OWL_NS}Restriction`)).toBe(true);
  });
  it('retains unexposed axioms and language variants after renaming an object', async () => {
    const result = await parseStandardOntology(fixture);
    const edited = structuredClone(result.model);
    edited.objects.find((item) => item.name === '订单')!.name = '销售订单';
    const document = reconcileSemanticModel(result.document, result.model, edited, 'workspace');
    expect(document.statements.some((item) => item.object.value === 'Order' && item.object.language === 'en')).toBe(true);
    expect(document.statements.some((item) => item.object.value === '销售订单')).toBe(true);
    const opaque = (doc: IOntologySemanticDocument) =>
      doc.statements
        .filter((item) => item.subject.type === 'blank' || item.object.type === 'blank')
        .map(statementKey)
        .sort();
    expect(opaque(document)).toEqual(opaque(result.document));
    expect(normalized((await parseStandardOntology(exportStandardOntology(document, 'rdfxml'))).document)).toEqual(normalized(document));
  });
  it('generates RDF/XML accepted by an independent RDF implementation', async () => {
    const result = await parseStandardOntology(fixture);
    const require = createRequire(path.resolve(__dirname, '../../../../packages/ontology-engine/package.json'));
    const rdf = require('rdflib');
    const store = rdf.graph();
    rdf.parse(exportStandardOntology(result.document, 'rdfxml'), store, 'https://example.org/', 'application/rdf+xml');
    expect(store.statements).toHaveLength(result.document.statements.length);
    const labels = store.statementsMatching(rdf.sym('https://example.org/#Order'), rdf.sym(`${RDFS_NS}label`), null);
    expect(labels.map((item: { object: { value: string } }) => item.object.value).sort()).toEqual(['Order', '订单'].sort());
  });
  it('uses full IRIs for identically named classes', async () => {
    const result = await parseStandardOntology(`<rdf:RDF ${namespaces}><owl:Class rdf:about="https://a.example/Customer"/><owl:Class rdf:about="https://b.example/Customer"/></rdf:RDF>`);
    expect(new Set(result.model.objects.map((item) => item.id)).size).toBe(2);
    expect(new Set(result.model.objects.map((item) => item.code)).size).toBe(2);
  });
  it('assigns repeatable scoped blank node identities for idempotent imports', async () => {
    expect((await parseStandardOntology(fixture)).document.statements).toEqual((await parseStandardOntology(fixture)).document.statements);
  });
  it('retains arbitrary assertions without declared classes', async () => {
    const parsed = await parseStandardOntology(`<rdf:RDF ${namespaces}><rdf:Description rdf:about="https://example.org/s"><ex:meaning>42</ex:meaning></rdf:Description></rdf:RDF>`);
    expect(parsed.model.objects).toHaveLength(0);
    expect((await parseStandardOntology(exportStandardOntology(parsed.document, 'rdfxml'))).document.statements).toEqual(parsed.document.statements);
  });
  it('roundtrips complex OWL/XML axioms through unrelated edits', async () => {
    const xml = `<Ontology xmlns="${OWL_NS}" ontologyIRI="https://example.org/ontology"><Prefix name="ex:" IRI="https://example.org/"/><Declaration><Class abbreviatedIRI="ex:Order"/></Declaration><Declaration><Class abbreviatedIRI="ex:Line"/></Declaration><Declaration><ObjectProperty abbreviatedIRI="ex:contains"/></Declaration><SubClassOf><Class abbreviatedIRI="ex:Order"/><ObjectMinCardinality cardinality="1"><ObjectProperty abbreviatedIRI="ex:contains"/><Class abbreviatedIRI="ex:Line"/></ObjectMinCardinality></SubClassOf><AnnotationAssertion><AnnotationProperty IRI="${RDFS_NS}label"/><IRI>https://example.org/Order</IRI><Literal xml:lang="zh">订单</Literal></AnnotationAssertion></Ontology>`;
    const parsed = await parseStandardOntology(xml);
    const next = structuredClone(parsed.model);
    next.objects.find((item) => item.name === '订单')!.name = '已改名订单';
    const document = reconcileSemanticModel(parsed.document, parsed.model, next, 'owl');
    const output = exportStandardOntology(document, 'owlxml');
    expect(output).toContain('ObjectMinCardinality');
    expect(output).toContain('已改名订单');
    expect(normalized((await parseStandardOntology(output)).document)).toEqual(normalized(document));
  });
  it('exports new models in both syntaxes without fabricating cardinality axioms', async () => {
    const model: IOntologyStudioModel = {
      objects: [{ id: 'customer', code: 'customer', name: '客户', description: '', tier: 1, status: 'active', sourceAssetIds: [], attributes: [{ id: 'name', code: 'name', name: '名称', dataType: 'string', required: false }], reviewDecision: 'pending', updatedAt: 1 }],
      relations: [],
    };
    const document = reconcileSemanticModel(createSemanticDocument('new'), { objects: [], relations: [] }, model, 'new');
    for (const format of ['rdfxml', 'owlxml'] as const) {
      const parsed = await parseStandardOntology(exportStandardOntology(document, format));
      expect(parsed.model.objects[0].name).toBe('客户');
      expect(parsed.model.objects[0].attributes[0].name).toBe('名称');
      expect(normalized(parsed.document)).toEqual(normalized(document));
    }
  });
  it('blocks deletion of an object referenced by a restriction', async () => {
    const parsed = await parseStandardOntology(fixture);
    const line = parsed.model.objects.find((item) => item.iri?.endsWith('#Line'))!;
    expect(() => reconcileSemanticModel(parsed.document, parsed.model, { objects: parsed.model.objects.filter((item) => item.id !== line.id), relations: [] }, 'test')).toThrow('referencedAxiom');
  });
  it('reports RDF structures that cannot be exported as OWL/XML instead of dropping them', async () => {
    const parsed = await parseStandardOntology(fixture);
    expect(() => exportStandardOntology(parsed.document, 'owlxml')).toThrow('owlXmlProjection');
    expect(exportStandardOntology(parsed.document, 'rdfxml')).toContain('Restriction');
  });
  it('rejects malformed XML and entity declarations before modifying a model', async () => {
    await expect(parseStandardOntology('<rdf:RDF><broken>')).rejects.toThrow('invalidXml');
    await expect(parseStandardOntology('<!DOCTYPE x SYSTEM "file:///private"><x/>')).rejects.toThrow('externalEntities');
  });
  it('distinguishes an unwrapped RDF/XML ontology node from OWL/XML', async () => {
    const parsed = await parseStandardOntology(`<owl:Ontology xmlns:owl="${OWL_NS}" xmlns:rdf="${RDF_NS}" xmlns:rdfs="${RDFS_NS}" rdf:about="https://example.org/ontology"><rdfs:label>Ontology</rdfs:label></owl:Ontology>`);
    expect(parsed.document.sourceFormat).toBe('rdfxml');
    expect(parsed.document.statements.some((item) => item.predicate === `${RDFS_NS}label` && item.object.value === 'Ontology')).toBe(true);
  });
  it('does not remove a shared property range by deleting only one projected relationship', async () => {
    const parsed = await parseStandardOntology(
      `<rdf:RDF ${namespaces}><owl:ObjectProperty rdf:about="https://example.org/rel"><rdfs:domain rdf:resource="https://example.org/A"/><rdfs:domain rdf:resource="https://example.org/B"/><rdfs:range rdf:resource="https://example.org/C"/></owl:ObjectProperty></rdf:RDF>`
    );
    expect(parsed.model.relations).toHaveLength(2);
    expect(() => reconcileSemanticModel(parsed.document, parsed.model, { objects: parsed.model.objects, relations: parsed.model.relations.slice(1) }, 'shared')).toThrow('sharedProperty');
  });

  it('preserves anonymous ontology identity and ontology annotations', async () => {
    const parsed = await parseStandardOntology(`<Ontology xmlns="${OWL_NS}"><Annotation><AnnotationProperty IRI="${RDFS_NS}label"/><Literal>Anonymous</Literal></Annotation></Ontology>`);
    expect(parsed.document.statements.find((item) => item.object.value === `${OWL_NS}Ontology`)?.subject.type).toBe('blank');
    const output = exportStandardOntology(parsed.document, 'owlxml');
    expect(output).not.toContain('ontologyIRI=');
    expect(normalized((await parseStandardOntology(output)).document)).toEqual(normalized(parsed.document));
  });
  it('resolves document-relative IRIs and keeps blank nodes scoped to their source document', async () => {
    const xml = `<rdf:RDF ${namespaces}><owl:Class rdf:about="#Order"><rdfs:subClassOf><owl:Restriction><owl:onProperty rdf:resource="#contains"/><owl:someValuesFrom rdf:resource="#Line"/></owl:Restriction></rdfs:subClassOf></owl:Class></rdf:RDF>`;
    const a = await parseStandardOntology(xml, 'file:///models/a.owl');
    const b = await parseStandardOntology(xml, 'file:///models/b.owl');
    expect(a.model.objects[0].iri).toBe('file:///models/a.owl#Order');
    expect(b.model.objects[0].iri).toBe('file:///models/b.owl#Order');
    const firstBlank = (document: IOntologySemanticDocument) => document.statements.find((item) => item.subject.type === 'blank')?.subject.value;
    expect(firstBlank(a.document)).not.toBe(firstBlank(b.document));
  });
});
