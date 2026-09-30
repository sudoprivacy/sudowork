import { createHash } from 'node:crypto';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
type XmlElement = Element;
import { RdfXmlParser } from 'rdfxml-streaming-parser';
import type { Quad, Term } from '@rdfjs/types';
import { OWL_NS, RDF_NS, RDFS_NS, XSD_NS, STUDIO_MAX_FILE_BYTES, iri, literal, uniqueStatements, statementKey, projectSemanticDocument } from '@sudowork/ontology-common';
import type { IOntologySemanticDocument, IOntologyStatement, IOntologyTerm, IOntologyStandardPreview, OntologyFileFormat } from '@sudowork/ontology-common';

const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const MAX_STATEMENTS = 100_000;
const type = `${RDF_NS}type`;

function children(element: XmlElement): XmlElement[] {
  return Array.from({ length: element.childNodes.length }, (_, i) => element.childNodes.item(i)).filter((node): node is XmlElement => node?.nodeType === 1);
}

function parseXml(content: string) {
  const errors: string[] = [];
  const document = new DOMParser({ errorHandler: { warning: (msg) => errors.push(msg), error: (msg) => errors.push(msg), fatalError: (msg) => errors.push(msg) } }).parseFromString(content, 'application/xml');
  if (errors.length || !document.documentElement) throw new Error(`ontology.studio.errors.invalidXml: ${errors[0] || 'Empty document'}`);
  return document;
}

function fromTerm(term: Term): IOntologyTerm {
  if (term.termType === 'NamedNode') return iri(term.value);
  if (term.termType === 'BlankNode') return { type: 'blank', value: term.value };
  if (term.termType === 'Literal') return literal(term.value, term.datatype.value, term.language);
  throw new Error('ontology.studio.errors.unsupportedTerm');
}

/** Parse a standard file without fetching imports or evaluating XML external entities. */
export async function parseStandardOntology(content: string, baseIri = 'urn:sudowork:import:', fileName = 'ontology.owl'): Promise<IOntologyStandardPreview> {
  if (Buffer.byteLength(content, 'utf8') > STUDIO_MAX_FILE_BYTES) throw new Error('ontology.studio.errors.fileTooLarge');
  if (/<!ENTITY|<!DOCTYPE/i.test(content)) throw new Error('ontology.studio.errors.externalEntities');
  const xml = parseXml(content);
  const root = xml.documentElement;
  const prefixes: Record<string, string> = { rdf: RDF_NS, rdfs: RDFS_NS, owl: OWL_NS, xsd: XSD_NS };
  for (let i = 0; i < root.attributes.length; i++) {
    const attr = root.attributes.item(i)!;
    if (attr.name.startsWith('xmlns:')) prefixes[attr.name.slice(6)] = attr.value;
  }
  const isOwlXml = root.namespaceURI === OWL_NS && root.localName === 'Ontology' && !['about', 'ID', 'nodeID'].some((attribute) => root.hasAttributeNS(RDF_NS, attribute)) && children(root).every((element) => element.namespaceURI === OWL_NS && /^[A-Z]/.test(element.localName));
  const document: IOntologySemanticDocument = { baseIri: root.getAttributeNS(XML_NS, 'base') || baseIri, prefixes, statements: [], imports: [], sourceFormat: isOwlXml ? 'owlxml' : 'rdfxml' };
  const blankScope = createHash('sha256').update(`${baseIri}\n${content}`).digest('hex').slice(0, 16);
  if (isOwlXml) parseOwlXml(root, document, blankScope);
  else {
    await new Promise<void>((resolve, reject) => {
      const parser = new RdfXmlParser({ baseIRI: document.baseIri, trackPosition: true });
      parser.on('data', (quad: Quad) => {
        if (document.statements.length >= MAX_STATEMENTS) {
          parser.destroy(new Error('ontology.studio.errors.fileTooLarge'));
          return;
        }
        try {
          document.statements.push({ subject: fromTerm(quad.subject), predicate: quad.predicate.value, object: fromTerm(quad.object) });
        } catch (error) {
          parser.destroy(error as Error);
        }
      });
      parser.on('error', reject);
      parser.on('end', resolve);
      parser.end(content);
    });
  }
  const fingerprint = createHash('sha256').update(content).digest('hex');
  if (!isOwlXml) {
    const blankIds = new Map<string, string>();
    const normalize = (term: IOntologyTerm) => {
      if (term.type !== 'blank') return term;
      if (!blankIds.has(term.value)) blankIds.set(term.value, `import_${blankScope}_${blankIds.size}`);
      return { ...term, value: blankIds.get(term.value)! };
    };
    document.statements = document.statements.map((item) => ({ ...item, subject: normalize(item.subject), object: normalize(item.object) }));
  }
  document.statements = uniqueStatements(document.statements);
  document.imports = document.statements.filter((item) => item.predicate === `${OWL_NS}imports` && item.object.type === 'iri').map((item) => item.object.value);
  const ontology = document.statements.find((item) => item.predicate === type && item.object.value === `${OWL_NS}Ontology` && item.subject.type === 'iri');
  if (ontology) document.baseIri = ontology.subject.value;
  const model = projectSemanticDocument(document);
  const knownSubjects = new Set([...model.objects.map((item) => item.iri), ...model.objects.flatMap((item) => item.attributes.map((attr) => attr.iri)), ...model.relations.map((item) => item.iri)]);
  return { document, model, fileName, fingerprint, statementCount: document.statements.length, preservedStatementCount: document.statements.filter((item) => !knownSubjects.has(item.subject.value)).length };
}

function parseOwlXml(root: XmlElement, document: IOntologySemanticDocument, scope: string): void {
  let blankIndex = 0;
  const blank = (): IOntologyTerm => ({ type: 'blank', value: `owl_${scope}_${++blankIndex}` });
  const add = (subject: IOntologyTerm, predicate: string, object: IOntologyTerm) => {
    if (!subject || !predicate || !object) throw new Error('ontology.studio.errors.unsupportedOwl');
    document.statements.push({ subject, predicate, object });
  };
  for (const el of children(root)) if (el.localName === 'Prefix') document.prefixes[(el.getAttribute('name') || '').replace(/:$/, '')] = el.getAttribute('IRI') || '';
  const resolve = (value: string) => {
    try {
      return new URL(value, document.baseIri).href;
    } catch {
      if (/^[a-z][a-z\d+.-]*:/i.test(value)) return value;
      throw new Error(`ontology.studio.errors.invalidIri: ${value}`);
    }
  };
  const abbreviated = (value: string) => {
    const at = value.indexOf(':');
    const prefix = document.prefixes[value.slice(0, at)];
    if (!prefix) throw new Error(`ontology.studio.errors.invalidIri: ${value}`);
    return prefix + value.slice(at + 1);
  };
  const ontology = root.hasAttribute('ontologyIRI') ? iri(resolve(root.getAttribute('ontologyIRI')!)) : blank();
  if (ontology.type === 'iri') document.baseIri = ontology.value;
  add(ontology, type, iri(`${OWL_NS}Ontology`));
  if (root.getAttribute('versionIRI')) add(ontology, `${OWL_NS}versionIRI`, iri(resolve(root.getAttribute('versionIRI')!)));
  const list = (items: IOntologyTerm[]): IOntologyTerm => {
    if (!items.length) return iri(`${RDF_NS}nil`);
    const head = blank();
    let cursor = head;
    items.forEach((item, i) => {
      add(cursor, `${RDF_NS}first`, item);
      const next = i === items.length - 1 ? iri(`${RDF_NS}nil`) : blank();
      add(cursor, `${RDF_NS}rest`, next);
      cursor = next;
    });
    return head;
  };
  const expression = (el: XmlElement): IOntologyTerm => {
    if (!el || el.namespaceURI !== OWL_NS) throw new Error('ontology.studio.errors.unsupportedOwl');
    const name = el.localName;
    if (el.hasAttribute('IRI')) return iri(resolve(el.getAttribute('IRI')!));
    if (el.hasAttribute('abbreviatedIRI')) return iri(abbreviated(el.getAttribute('abbreviatedIRI')!));
    if (name === 'IRI') return iri(resolve(el.textContent || ''));
    if (name === 'AbbreviatedIRI') return iri(abbreviated(el.textContent || ''));
    if (name === 'AnonymousIndividual') return { type: 'blank', value: `${scope}_${el.getAttribute('nodeID')}` };
    if (name === 'Literal') return literal(el.textContent || '', el.getAttribute('datatypeIRI') ? resolve(el.getAttribute('datatypeIRI')!) : `${XSD_NS}string`, el.getAttributeNS(XML_NS, 'lang') || '');
    const args = children(el).map(expression);
    const subject = blank();
    const collections: Record<string, string> = { ObjectIntersectionOf: 'intersectionOf', ObjectUnionOf: 'unionOf', ObjectOneOf: 'oneOf', DataIntersectionOf: 'intersectionOf', DataUnionOf: 'unionOf', DataOneOf: 'oneOf' };
    if (collections[name]) {
      add(subject, type, iri(`${name.startsWith('Data') ? RDFS_NS : OWL_NS}${name.startsWith('Data') ? 'Datatype' : 'Class'}`));
      add(subject, `${OWL_NS}${collections[name]}`, list(args));
      return subject;
    }
    if (name === 'ObjectComplementOf' || name === 'DataComplementOf') {
      add(subject, type, iri(name === 'ObjectComplementOf' ? `${OWL_NS}Class` : `${RDFS_NS}Datatype`));
      add(subject, `${OWL_NS}${name.startsWith('Data') ? 'datatypeComplementOf' : 'complementOf'}`, args[0]);
      return subject;
    }
    if (name === 'ObjectInverseOf') {
      add(subject, `${OWL_NS}inverseOf`, args[0]);
      return subject;
    }
    if (name === 'FacetRestriction') {
      add(subject, resolve(el.getAttribute('facet')!), args[0]);
      return subject;
    }
    if (name === 'DatatypeRestriction') {
      add(subject, type, iri(`${RDFS_NS}Datatype`));
      add(subject, `${OWL_NS}onDatatype`, args[0]);
      add(subject, `${OWL_NS}withRestrictions`, list(args.slice(1)));
      return subject;
    }
    const restriction = name.match(/^(Object|Data)(SomeValuesFrom|AllValuesFrom|HasValue|HasSelf|MinCardinality|MaxCardinality|ExactCardinality)$/);
    if (restriction && args[0]) {
      add(subject, type, iri(`${OWL_NS}Restriction`));
      add(subject, `${OWL_NS}onProperty`, args[0]);
      const cardinalities: Record<string, string> = { MinCardinality: 'min', MaxCardinality: 'max', ExactCardinality: '' };
      if (restriction[2] in cardinalities) {
        const prefix = cardinalities[restriction[2]];
        const isQualified = args.length > 1;
        if (!/^\d+$/.test(el.getAttribute('cardinality') || '')) throw new Error('ontology.studio.errors.unsupportedOwl');
        const cardinality = `${prefix}${isQualified ? (prefix ? 'QualifiedCardinality' : 'qualifiedCardinality') : prefix ? 'Cardinality' : 'cardinality'}`;
        add(subject, `${OWL_NS}${cardinality}`, literal(el.getAttribute('cardinality') || '0', `${XSD_NS}nonNegativeInteger`));
        if (isQualified) add(subject, `${OWL_NS}${restriction[1] === 'Object' ? 'onClass' : 'onDataRange'}`, args[1]);
      } else {
        const predicate = restriction[2][0].toLowerCase() + restriction[2].slice(1);
        add(subject, `${OWL_NS}${predicate}`, restriction[2] === 'HasSelf' ? literal('true', `${XSD_NS}boolean`) : args[1]);
      }
      return subject;
    }
    throw new Error(`ontology.studio.errors.unsupportedOwl: ${name}`);
  };
  const annotation = (el: XmlElement, subject: IOntologyTerm) => {
    const parts = children(el).filter((item) => item.localName !== 'Annotation');
    const predicate = expression(parts[0]);
    const object = expression(parts[1]);
    add(subject, predicate.value, object);
    const nested = children(el).filter((item) => item.localName === 'Annotation');
    if (nested.length) {
      const node = blank();
      add(node, type, iri(`${OWL_NS}Annotation`));
      add(node, `${OWL_NS}annotatedSource`, subject);
      add(node, `${OWL_NS}annotatedProperty`, predicate);
      add(node, `${OWL_NS}annotatedTarget`, object);
      nested.forEach((item) => annotation(item, node));
    }
  };
  const declarations: Record<string, string> = { Class: 'Class', ObjectProperty: 'ObjectProperty', DataProperty: 'DatatypeProperty', AnnotationProperty: 'AnnotationProperty', NamedIndividual: 'NamedIndividual', Datatype: 'Datatype' };
  const binary: Record<string, string> = {
    SubClassOf: `${RDFS_NS}subClassOf`,
    SubObjectPropertyOf: `${RDFS_NS}subPropertyOf`,
    SubDataPropertyOf: `${RDFS_NS}subPropertyOf`,
    SubAnnotationPropertyOf: `${RDFS_NS}subPropertyOf`,
    ObjectPropertyDomain: `${RDFS_NS}domain`,
    ObjectPropertyRange: `${RDFS_NS}range`,
    DataPropertyDomain: `${RDFS_NS}domain`,
    DataPropertyRange: `${RDFS_NS}range`,
    AnnotationPropertyDomain: `${RDFS_NS}domain`,
    AnnotationPropertyRange: `${RDFS_NS}range`,
    InverseObjectProperties: `${OWL_NS}inverseOf`,
    DatatypeDefinition: `${OWL_NS}equivalentClass`,
  };
  const characteristic: Record<string, string> = {
    FunctionalObjectProperty: 'FunctionalProperty',
    FunctionalDataProperty: 'FunctionalProperty',
    InverseFunctionalObjectProperty: 'InverseFunctionalProperty',
    ReflexiveObjectProperty: 'ReflexiveProperty',
    IrreflexiveObjectProperty: 'IrreflexiveProperty',
    SymmetricObjectProperty: 'SymmetricProperty',
    AsymmetricObjectProperty: 'AsymmetricProperty',
    TransitiveObjectProperty: 'TransitiveProperty',
  };
  const equivalent: Record<string, string> = { EquivalentClasses: 'equivalentClass', EquivalentObjectProperties: 'equivalentProperty', EquivalentDataProperties: 'equivalentProperty', SameIndividual: 'sameAs' };
  document.owlAxioms = [];
  for (const axiom of children(root)) {
    const name = axiom.localName;
    if (name === 'Prefix') continue;
    const start = document.statements.length;
    const operands = children(axiom).filter((item) => item.localName !== 'Annotation');
    if (name === 'Import') add(ontology, `${OWL_NS}imports`, iri(resolve(axiom.textContent || '')));
    else if (name === 'Annotation') annotation(axiom, ontology);
    else if (name === 'Declaration') {
      const entity = operands[0];
      if (!entity || !declarations[entity.localName]) throw new Error('ontology.studio.errors.unsupportedOwl');
      add(expression(entity), type, iri(`${entity.localName === 'Datatype' ? RDFS_NS : OWL_NS}${declarations[entity.localName]}`));
    } else if (name === 'AnnotationAssertion') {
      const args = operands.map(expression);
      add(args[1], args[0].value, args[2]);
    } else if (name === 'SubObjectPropertyOf' && operands[0]?.localName === 'ObjectPropertyChain') add(expression(operands[1]), `${OWL_NS}propertyChainAxiom`, list(children(operands[0]).map(expression)));
    else if (binary[name]) {
      const args = operands.map(expression);
      add(args[0], binary[name], args[1]);
    } else if (characteristic[name]) add(expression(operands[0]), type, iri(`${OWL_NS}${characteristic[name]}`));
    else if (equivalent[name]) {
      const args = operands.map(expression);
      for (let i = 1; i < args.length; i++) add(args[0], `${OWL_NS}${equivalent[name]}`, args[i]);
    } else if (['DisjointClasses', 'DisjointObjectProperties', 'DisjointDataProperties', 'DifferentIndividuals'].includes(name)) {
      const args = operands.map(expression);
      if (args.length === 2) add(args[0], `${OWL_NS}${name === 'DisjointClasses' ? 'disjointWith' : name === 'DifferentIndividuals' ? 'differentFrom' : 'propertyDisjointWith'}`, args[1]);
      else {
        const node = blank();
        add(node, type, iri(`${OWL_NS}${name === 'DisjointClasses' ? 'AllDisjointClasses' : name === 'DifferentIndividuals' ? 'AllDifferent' : 'AllDisjointProperties'}`));
        add(node, `${OWL_NS}${name === 'DifferentIndividuals' ? 'distinctMembers' : 'members'}`, list(args));
      }
    } else if (name === 'DisjointUnion') {
      const args = operands.map(expression);
      add(args[0], `${OWL_NS}disjointUnionOf`, list(args.slice(1)));
    } else if (name === 'HasKey') {
      const args = operands.map(expression);
      add(args[0], `${OWL_NS}hasKey`, list(args.slice(1)));
    } else if (name === 'ClassAssertion') {
      const args = operands.map(expression);
      add(args[1], type, args[0]);
    } else if (name === 'ObjectPropertyAssertion' || name === 'DataPropertyAssertion') {
      const args = operands.map(expression);
      if (args[0].type !== 'iri') throw new Error('ontology.studio.errors.unsupportedOwl');
      add(args[1], args[0].value, args[2]);
    } else if (name === 'NegativeObjectPropertyAssertion' || name === 'NegativeDataPropertyAssertion') {
      const args = operands.map(expression);
      const node = blank();
      add(node, type, iri(`${OWL_NS}NegativePropertyAssertion`));
      add(node, `${OWL_NS}sourceIndividual`, args[1]);
      add(node, `${OWL_NS}assertionProperty`, args[0]);
      add(node, `${OWL_NS}${name === 'NegativeDataPropertyAssertion' ? 'targetValue' : 'targetIndividual'}`, args[2]);
    } else throw new Error(`ontology.studio.errors.unsupportedOwl: ${name}`);
    const main = document.statements.at(-1)!;
    const annotations = name === 'Annotation' ? [] : children(axiom).filter((item) => item.localName === 'Annotation');
    if (annotations.length) {
      if (equivalent[name] && operands.length > 2) throw new Error('ontology.studio.errors.unsupportedOwl');
      const node = blank();
      add(node, type, iri(`${OWL_NS}Axiom`));
      add(node, `${OWL_NS}annotatedSource`, main.subject);
      add(node, `${OWL_NS}annotatedProperty`, iri(main.predicate));
      add(node, `${OWL_NS}annotatedTarget`, main.object);
      annotations.forEach((ann) => annotation(ann, node));
    }
    // Normalize relative and abbreviated IRIs in preserved syntax before moving it to another document.
    const normalize = (el: XmlElement) => {
      for (const attr of ['IRI', 'datatypeIRI', 'facet']) if (el.hasAttribute(attr)) el.setAttribute(attr, resolve(el.getAttribute(attr)!));
      if (el.hasAttribute('abbreviatedIRI')) {
        el.setAttribute('IRI', abbreviated(el.getAttribute('abbreviatedIRI')!));
        el.removeAttribute('abbreviatedIRI');
      }
      if (el.localName === 'IRI') el.textContent = resolve(el.textContent || '');
      children(el).forEach(normalize);
    };
    normalize(axiom);
    document.owlAxioms.push({ xml: new XMLSerializer().serializeToString(axiom), statementKeys: document.statements.slice(start).map(statementKey) });
    if (document.statements.length > MAX_STATEMENTS) throw new Error('ontology.studio.errors.fileTooLarge');
  }
}

function xmlEscape(value: string): string {
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if ((code < 32 && ![9, 10, 13].includes(code)) || (code >= 0xd800 && code <= 0xdfff) || code === 0xfffe || code === 0xffff) throw new Error('ontology.studio.errors.invalidXml');
  }
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Serialize every retained statement, including opaque axioms and instance assertions. */
export function serializeRdfXml(document: IOntologySemanticDocument): string {
  const prefixes = new Map<string, string>([[RDF_NS, 'rdf']]);
  const predicateNames = new Map<string, string>();
  for (const item of document.statements) {
    const match = item.predicate.match(/^(.*?)([\p{L}_][\p{L}\p{N}_.-]*)$/u);
    if (!match) throw new Error(`ontology.studio.errors.invalidQName: ${item.predicate}`);
    if (!prefixes.has(match[1])) prefixes.set(match[1], `ns${prefixes.size}`);
    predicateNames.set(item.predicate, `${prefixes.get(match[1])}:${match[2]}`);
  }
  const blankIds = new Map<string, string>();
  const blankId = (value: string) => {
    if (!blankIds.has(value)) blankIds.set(value, `b${blankIds.size}`);
    return blankIds.get(value)!;
  };
  const grouped = new Map<string, IOntologyStatement[]>();
  for (const item of document.statements) {
    const key = `${item.subject.type}:${item.subject.value}`;
    grouped.set(key, [...(grouped.get(key) || []), item]);
  }
  const body = [...grouped.values()]
    .map((items) => {
      const subject = items[0].subject;
      if (subject.type === 'literal') throw new Error('ontology.studio.errors.unsupportedTerm');
      const subjectAttr = subject.type === 'blank' ? `rdf:nodeID="${blankId(subject.value)}"` : `rdf:about="${xmlEscape(subject.value)}"`;
      return `  <rdf:Description ${subjectAttr}>\n${items
        .map((item) => {
          const name = predicateNames.get(item.predicate)!;
          const object = item.object;
          if (object.type === 'iri') return `    <${name} rdf:resource="${xmlEscape(object.value)}"/>`;
          if (object.type === 'blank') return `    <${name} rdf:nodeID="${blankId(object.value)}"/>`;
          const attr = object.language ? ` xml:lang="${xmlEscape(object.language)}"` : object.datatype ? ` rdf:datatype="${xmlEscape(object.datatype)}"` : '';
          return `    <${name}${attr}>${xmlEscape(object.value)}</${name}>`;
        })
        .join('\n')}\n  </rdf:Description>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rdf:RDF ${[...prefixes].map(([namespace, prefix]) => `xmlns:${prefix}="${xmlEscape(namespace)}"`).join(' ')}>\n${body}\n</rdf:RDF>\n`;
}

/** Preserve imported complex OWL axioms and serialize new named-class/property edits. */
export function serializeOwlXml(document: IOntologySemanticDocument): string {
  const keys = new Set(document.statements.map(statementKey));
  const consumed = new Set<string>();
  const output: string[] = [];
  const ontologies = document.statements.filter((item) => item.predicate === type && item.object.value === `${OWL_NS}Ontology`);
  if (ontologies.length > 1) throw new Error('ontology.studio.errors.owlXmlProjection');
  const ontology = ontologies[0]?.subject || iri(document.baseIri);
  const node = (kind: string, value: IOntologyTerm) => {
    if (value.type === 'literal') return `<Literal${value.language ? ` xml:lang="${xmlEscape(value.language)}"` : ` datatypeIRI="${xmlEscape(value.datatype || `${XSD_NS}string`)}"`}>${xmlEscape(value.value)}</Literal>`;
    if (value.type === 'blank') {
      if (kind !== 'NamedIndividual') throw new Error('ontology.studio.errors.owlXmlProjection');
      return `<AnonymousIndividual nodeID="${xmlEscape(value.value)}"/>`;
    }
    return kind === 'IRI' ? `<IRI>${xmlEscape(value.value)}</IRI>` : `<${kind} IRI="${xmlEscape(value.value)}"/>`;
  };
  for (const axiom of document.owlAxioms || [])
    if (axiom.statementKeys.every((key) => keys.has(key))) {
      output.push(axiom.xml);
      axiom.statementKeys.forEach((key) => consumed.add(key));
    }
  const propertyKind = (subject: string) =>
    document.statements.some((item) => item.subject.value === subject && item.predicate === type && item.object.value === `${OWL_NS}DatatypeProperty`)
      ? 'DataProperty'
      : document.statements.some((item) => item.subject.value === subject && item.predicate === type && item.object.value === `${OWL_NS}AnnotationProperty`)
        ? 'AnnotationProperty'
        : 'ObjectProperty';
  const declarations: Record<string, string> = {
    [`${OWL_NS}Class`]: 'Class',
    [`${RDFS_NS}Class`]: 'Class',
    [`${OWL_NS}ObjectProperty`]: 'ObjectProperty',
    [`${OWL_NS}DatatypeProperty`]: 'DataProperty',
    [`${OWL_NS}AnnotationProperty`]: 'AnnotationProperty',
    [`${OWL_NS}NamedIndividual`]: 'NamedIndividual',
    [`${RDFS_NS}Datatype`]: 'Datatype',
  };
  const characteristics = ['FunctionalProperty', 'InverseFunctionalProperty', 'ReflexiveProperty', 'IrreflexiveProperty', 'SymmetricProperty', 'AsymmetricProperty', 'TransitiveProperty'];
  for (const item of document.statements) {
    if (consumed.has(statementKey(item))) continue;
    const { subject, predicate, object } = item;
    if (predicate === type && object.value === `${OWL_NS}Ontology`) continue;
    if (predicate === `${OWL_NS}versionIRI` && subject.value === document.baseIri) continue;
    if (predicate === `${OWL_NS}imports` && subject.value === ontology.value) {
      output.push(`<Import>${xmlEscape(object.value)}</Import>`);
      continue;
    }
    if (subject.value === ontology.value && predicate !== type && !predicate.startsWith(OWL_NS) && !predicate.startsWith(RDF_NS)) {
      output.push(`<Annotation>${node('AnnotationProperty', iri(predicate))}${node(object.type === 'literal' ? 'Literal' : 'IRI', object)}</Annotation>`);
      continue;
    }
    if (subject.type === 'blank') throw new Error('ontology.studio.errors.owlXmlProjection');
    if (predicate === type && declarations[object.value]) {
      output.push(`<Declaration>${node(declarations[object.value], subject)}</Declaration>`);
      continue;
    }
    if (predicate === type && characteristics.some((kind) => object.value === `${OWL_NS}${kind}`)) {
      const kind = object.value.slice(OWL_NS.length).replace('Property', propertyKind(subject.value));
      output.push(`<${kind}>${node(propertyKind(subject.value), subject)}</${kind}>`);
      continue;
    }
    if ([`${RDFS_NS}subClassOf`, `${OWL_NS}equivalentClass`, `${OWL_NS}disjointWith`].includes(predicate)) {
      const kind = predicate === `${RDFS_NS}subClassOf` ? 'SubClassOf' : predicate === `${OWL_NS}equivalentClass` ? 'EquivalentClasses' : 'DisjointClasses';
      output.push(`<${kind}>${node('Class', subject)}${node('Class', object)}</${kind}>`);
      continue;
    }
    if ([`${RDFS_NS}domain`, `${RDFS_NS}range`, `${RDFS_NS}subPropertyOf`].includes(predicate)) {
      const prop = propertyKind(subject.value);
      const isSub = predicate === `${RDFS_NS}subPropertyOf`;
      const isRange = predicate === `${RDFS_NS}range`;
      const kind = isSub ? `Sub${prop}Of` : `${prop}${isRange ? 'Range' : 'Domain'}`;
      output.push(`<${kind}>${node(prop, subject)}${node(isSub ? prop : prop === 'AnnotationProperty' ? 'IRI' : isRange && prop === 'DataProperty' ? 'Datatype' : 'Class', object)}</${kind}>`);
      continue;
    }
    if (predicate === type && !object.value.startsWith(OWL_NS) && !object.value.startsWith(RDF_NS)) {
      output.push(`<ClassAssertion>${node('Class', object)}${node('NamedIndividual', subject)}</ClassAssertion>`);
      continue;
    }
    if (predicate.startsWith(OWL_NS) || predicate.startsWith(RDF_NS)) throw new Error('ontology.studio.errors.owlXmlProjection');
    output.push(`<AnnotationAssertion>${node('AnnotationProperty', iri(predicate))}${node('IRI', subject)}${node(object.type === 'literal' ? 'Literal' : 'IRI', object)}</AnnotationAssertion>`);
  }
  const version = document.statements.find((item) => item.subject.value === document.baseIri && item.predicate === `${OWL_NS}versionIRI`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Ontology xmlns="${OWL_NS}" ${ontology.type === 'iri' ? `ontologyIRI="${xmlEscape(ontology.value)}"` : ''}${version ? ` versionIRI="${xmlEscape(version.object.value)}"` : ''}>\n${Object.entries(document.prefixes)
    .map(([name, namespace]) => `<Prefix name="${xmlEscape(name)}:" IRI="${xmlEscape(namespace)}"/>`)
    .join('\n')}\n${output.join('\n')}\n</Ontology>\n`;
}

export function exportStandardOntology(document: IOntologySemanticDocument, format: OntologyFileFormat): string {
  return format === 'owlxml' ? serializeOwlXml(document) : serializeRdfXml(document);
}
