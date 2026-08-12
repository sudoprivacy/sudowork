/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveLocaleKey } from '../../src/common/utils';

const loadPresetAssistantResources = vi.fn();
const configGet = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {},
}));

vi.mock('@/common/storage', async () => {
  const actual = await vi.importActual<typeof import('../../src/common/storage')>('../../src/common/storage');
  return {
    ...actual,
    ConfigStorage: {
      get: configGet,
    },
  };
});

vi.mock('@/renderer/shared/agents/presetAssistantResources', () => ({
  loadPresetAssistantResources,
}));

const { buildPresetAssistantParams } = await import('../../src/renderer/pages/conversation/utils/createConversationParams');

describe('createConversationParams', () => {
  beforeEach(() => {
    loadPresetAssistantResources.mockReset();
    configGet.mockReset();
  });

  it('uses the shared locale resolver for Turkish', async () => {
    loadPresetAssistantResources.mockResolvedValue({
      rules: 'You are Preset Assistant, an intelligent assistant.\n\npreset rules',
      skills: '',
      enabledSkills: ['moltbook'],
    });

    const params = await buildPresetAssistantParams(
      {
        backend: 'custom',
        name: 'Preset Assistant',
        customAgentId: 'builtin-cowork',
        isPreset: true,
        presetAgentType: 'scode',
      },
      '/tmp/workspace',
      'tr'
    );

    expect(resolveLocaleKey('tr')).toBe('tr-TR');
    expect(loadPresetAssistantResources).toHaveBeenCalledWith({
      customAgentId: 'builtin-cowork',
      localeKey: 'tr-TR',
    });
    expect(params.type).toBe('acp');
    // Rules with explicit identity should not be modified
    expect(params.extra.presetContext).toBe('You are Preset Assistant, an intelligent assistant.\n\npreset rules');
    expect(params.extra.enabledSkills).toEqual(['moltbook']);
    expect(params.extra.agentName).toBe('Preset Assistant'); // agentName should be set for placeholder display
    // ACP conversations don't resolve a model at creation time — the backend determines it
    expect(params.extra.backend).toBe('scode');
  });

  it('maps acp preset assistants to presetContext and backend', async () => {
    loadPresetAssistantResources.mockResolvedValue({
      rules: '你是 Codebuddy 助手，专门用于代码辅助。\n\nacp preset rules',
      skills: '',
      enabledSkills: undefined,
    });

    const params = await buildPresetAssistantParams(
      {
        backend: 'custom',
        name: 'Codebuddy Assistant',
        customAgentId: 'preset-1',
        isPreset: true,
        presetAgentType: 'codebuddy',
      },
      '/tmp/workspace',
      'zh'
    );

    expect(params.type).toBe('acp');
    // Rules with explicit identity should not be modified
    expect(params.extra.presetContext).toBe('你是 Codebuddy 助手，专门用于代码辅助。\n\nacp preset rules');
    expect(params.extra.backend).toBe('codebuddy');
    expect(params.extra.agentName).toBe('Codebuddy Assistant'); // agentName should be set for placeholder display
  });

  it('uses the configured brand name for the brand-locked assistant identity', async () => {
    loadPresetAssistantResources.mockResolvedValue({
      rules: '你是「格物」。\n\n当用户询问“你是谁”时，回答“我是格物”。',
      skills: '',
      enabledSkills: [],
    });

    const params = await buildPresetAssistantParams(
      {
        backend: 'custom',
        name: 'gewu',
        customAgentId: 'builtin-gewu',
        isPreset: true,
        presetAgentType: 'scode',
      },
      '/tmp/workspace',
      'zh-CN'
    );

    expect(params.name).toBe('格物AI');
    expect(params.extra.agentName).toBe('格物AI');
    expect(params.extra.presetContext).toContain('你的身份是：格物AI');
    expect(params.extra.presetContext).toContain('我是格物AI');
  });

  it('normalizes legacy sudoclaw presets to scode ACP conversations', async () => {
    loadPresetAssistantResources.mockResolvedValue({
      rules: 'Some generic rules without identity',
      skills: '',
      enabledSkills: ['skill-1'],
    });

    const params = await buildPresetAssistantParams(
      {
        backend: 'custom',
        name: '自定义助手',
        customAgentId: 'custom-1',
        isPreset: true,
        presetAgentType: 'sudoclaw',
      },
      '/tmp/workspace',
      'zh-CN'
    );

    expect(params.type).toBe('acp');
    expect(params.extra.backend).toBe('scode');
    // Should inject identity override block for rules without explicit identity
    expect(params.extra.presetContext).toContain('[Identity Override - 最高优先级]');
    expect(params.extra.presetContext).toContain('你的身份是：自定义助手');
    expect(params.extra.presetContext).toContain('我是自定义助手');
    expect(params.extra.presetContext).toContain('Some generic rules without identity');
    expect(params.extra.agentName).toBe('自定义助手');
  });
});
