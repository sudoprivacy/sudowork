import { describe, expect, it } from 'vitest';
import { getModelDisplayLabel, isDefaultModel } from '@renderer/utils/agentUiDisplay';

describe('model display labels', () => {
  it('preserves a selected model from a provider whose ID includes default', () => {
    expect(getModelDisplayLabel({ selectedValue: 'legacy-default:gpt-4o', selectedLabel: 'gpt-4o', defaultModelLabel: '默认模型', fallbackLabel: 'Select model' })).toBe('gpt-4o');
    expect(isDefaultModel('legacy-default:gpt-4o', 'legacy-default:gpt-4o')).toBe(false);
    expect(isDefaultModel('my-default-model', 'My recommended model')).toBe(false);
  });
  it.each(['default', 'recommended', 'Default Model', '默认模型'])('recognizes the explicit %s sentinel', (value) => {
    expect(isDefaultModel(value)).toBe(true);
  });
});
