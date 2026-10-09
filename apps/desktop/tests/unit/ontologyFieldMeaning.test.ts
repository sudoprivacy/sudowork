import { beforeEach, describe, expect, it, vi } from 'vitest';
import { describeOntologyFields, validateFieldMeanings } from '@process/services/ontology/ontologyFieldMeaning';
import { runOntologyModelPrompt } from '@process/services/ontology/ontologyDocumentExtractor';

vi.mock('@process/services/ontology/ontologyDocumentExtractor', () => ({ runOntologyModelPrompt: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

describe('ontology field meanings', () => {
  it.each([
    { fields: [] },
    { fields: [{ name: 'other', meaning: 'Meaning', isUncertain: false }] },
    { fields: [{ name: 'id', meaning: ' ', isUncertain: false }] },
    {
      fields: [
        { name: 'id', meaning: 'Meaning', isUncertain: false },
        { name: 'id', meaning: 'Duplicate', isUncertain: false },
      ],
    },
  ])('rejects incomplete or invalid field explanations: %j', (response) => {
    expect(() => validateFieldMeanings(JSON.stringify(response), ['id'])).toThrow('ontology.studio.dataErrors.meaningInvalid');
  });

  it('accepts complete explanations and preserves uncertainty', () => {
    const fields = [{ name: 'id', meaning: 'Identifier; its business scope needs confirmation.', isUncertain: true }];
    expect(validateFieldMeanings('```json\n' + JSON.stringify({ fields }) + '\n```', ['id'])).toEqual(fields);
  });

  it('covers every field across batches and sends only source metadata to the model', async () => {
    vi.mocked(runOntologyModelPrompt).mockImplementation(async (prompt) => {
      const input = JSON.parse(prompt.split('UNTRUSTED_METADATA_JSON:\n\n')[1]);
      return JSON.stringify({ fields: input.fields.map((field: { name: string }) => ({ name: field.name, meaning: `Business meaning for ${field.name}`, isUncertain: true })) });
    });
    const fields = Array.from({ length: 45 }, (_, index) => ({ name: `field_${index}`, dataType: 'text', description: `Source comment ${index}`, sampleValues: ['private-row-value'] }));
    const result = await describeOntologyFields({ tableName: 'orders', ontologyTitle: 'Order management', businessGoal: 'Understand orders', language: 'zh-CN', fields });
    expect(runOntologyModelPrompt).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(45);
    expect(result.every((field) => field.businessMeaning?.text && field.businessMeaning.language === 'zh-CN')).toBe(true);
    expect(result[44]).toEqual(expect.objectContaining({ description: 'Source comment 44', businessMeaning: expect.objectContaining({ text: 'Business meaning for field_44', isUncertain: true }) }));
    const prompts = vi
      .mocked(runOntologyModelPrompt)
      .mock.calls.map(([prompt]) => prompt)
      .join('\n');
    expect(prompts).toContain('Source comment 0');
    expect(prompts).not.toContain('private-row-value');
    expect(prompts).toContain('untrusted metadata');
  });
});
