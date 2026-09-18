import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx-republish';
import { afterEach, describe, expect, it } from 'vitest';
import { parseOntologyTemplateFile } from '@process/services/ontology/ontologyTemplateParser';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('parseOntologyTemplateFile', () => {
  it('normalizes JSON objects, properties, and relations', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'ontology-template-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'customer-domain.json');
    await writeFile(
      filePath,
      JSON.stringify({
        object_types: [
          {
            name: 'Customer',
            display_name: '客户',
            tier: 1,
            properties: [{ name: 'customer_id', display_name: '客户编号', type: 'string', required: true }],
          },
          {
            name: 'Order',
            display_name: '订单',
            properties: [{ name: 'order_id', type: 'integer' }],
          },
        ],
        relations: [{ name: 'customer_orders', display_name: '客户订单', source: 'Customer', target: 'Order', cardinality: '1:N' }],
      }),
      'utf8'
    );

    await expect(parseOntologyTemplateFile(filePath)).resolves.toEqual({
      objects: [
        {
          code: 'Customer',
          name: '客户',
          description: '',
          namespace: '',
          tier: 1,
          status: 'active',
          attributes: [{ code: 'customer_id', name: '客户编号', dataType: 'string', required: true, description: '' }],
        },
        {
          code: 'Order',
          name: '订单',
          description: '',
          namespace: '',
          tier: 3,
          status: 'active',
          attributes: [{ code: 'order_id', name: 'order_id', dataType: 'integer', required: false, description: '' }],
        },
      ],
      relations: [
        {
          code: 'customer_orders',
          name: '客户订单',
          from: 'Customer',
          to: 'Order',
          cardinality: 'one_to_many',
          description: '',
        },
      ],
    });
  });

  it('rejects JSON files without ontology object definitions', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'ontology-template-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'not-an-ontology.json');
    await writeFile(filePath, JSON.stringify({ rows: [{ id: 1 }] }), 'utf8');

    await expect(parseOntologyTemplateFile(filePath)).resolves.toBeNull();
  });

  it('parses OWL classes and object-property domain and range', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'ontology-template-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'customer-domain.owl');
    await writeFile(
      filePath,
      `<?xml version="1.0"?>
      <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:owl="http://www.w3.org/2002/07/owl#" xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#">
        <owl:Class rdf:about="http://example.test/ontology#Customer" />
        <owl:Class rdf:about="http://example.test/ontology#Order" />
        <owl:ObjectProperty rdf:about="http://example.test/ontology#customer_orders">
          <rdfs:domain rdf:resource="http://example.test/ontology#Customer" />
          <rdfs:range rdf:resource="http://example.test/ontology#Order" />
        </owl:ObjectProperty>
      </rdf:RDF>`,
      'utf8'
    );

    const parsed = await parseOntologyTemplateFile(filePath);
    expect(parsed?.objects.map((object) => object.code)).toEqual(['Customer', 'Order']);
    expect(parsed?.relations).toEqual([expect.objectContaining({ code: 'customer_orders', from: 'Customer', to: 'Order' })]);
  });

  it('parses object, attribute, and relation sheets from an Excel template', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'ontology-template-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'customer-domain.xlsx');
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet([
        { code: 'Customer', name_cn: '客户', tier: 1 },
        { code: 'Order', name_cn: '订单', tier: 2 },
      ]),
      'Objects'
    );
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ object: 'Customer', code: 'customer_id', name_cn: '客户编号', data_type: 'string', required: true }]), 'Attributes');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ code: 'customer_orders', name_cn: '客户订单', from: 'Customer', to: 'Order', cardinality: '1:N' }]), 'Relations');
    await writeFile(filePath, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));

    const parsed = await parseOntologyTemplateFile(filePath);
    expect(parsed?.objects).toHaveLength(2);
    expect(parsed?.objects[0].attributes[0]).toMatchObject({ code: 'customer_id', required: true });
    expect(parsed?.relations[0]).toMatchObject({ code: 'customer_orders', cardinality: 'one_to_many' });
  });
});
