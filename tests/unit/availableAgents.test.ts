/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { AVAILABLE_AGENTS_SWR_KEY, V1_VISIBLE_AGENT_BACKENDS, filterAvailableAgentsForUi, splitConversationDropdownAgents } from '../../src/renderer/shared/agents/availableAgents';
import type { AvailableAgent } from '../../src/renderer/shared/agents/types';

describe('availableAgents helpers', () => {
  const agents: AvailableAgent[] = [
    { backend: 'gemini', name: 'Gemini' },
    { backend: 'gemini', name: 'Gemini CLI', cliPath: '/usr/local/bin/gemini' },
    { backend: 'claude', name: 'Claude Code', cliPath: '/usr/local/bin/claude' },
    { backend: 'openclaw-gateway', name: 'Sudoclaw' },
    { backend: 'qwen', name: 'Qwen Code', cliPath: '/usr/local/bin/qwen' },
    { backend: 'custom', name: 'Custom Agent', customAgentId: 'custom-1' },
    { backend: 'custom', name: 'Preset Assistant', customAgentId: 'builtin-writer', isPreset: true },
    { backend: 'codex', name: 'Code Review Assistant', isPreset: true, customAgentId: 'preset-1' },
  ];

  it('uses the shared SWR key for available agents', () => {
    expect(AVAILABLE_AGENTS_SWR_KEY).toBe('acp.agents.available');
  });

  it('v1.0.3: only exposes claude and openclaw-gateway as visible backends', () => {
    expect(V1_VISIBLE_AGENT_BACKENDS.has('claude')).toBe(true);
    expect(V1_VISIBLE_AGENT_BACKENDS.has('openclaw-gateway')).toBe(true);
    expect(V1_VISIBLE_AGENT_BACKENDS.has('gemini')).toBe(false);
    expect(V1_VISIBLE_AGENT_BACKENDS.has('qwen')).toBe(false);
    expect(V1_VISIBLE_AGENT_BACKENDS.has('codex')).toBe(false);
  });

  it('filters to only show SudoClaw, Claude Code, and custom/preset agents', () => {
    expect(filterAvailableAgentsForUi(agents)).toEqual([
      { backend: 'claude', name: 'Claude Code', cliPath: '/usr/local/bin/claude' },
      { backend: 'openclaw-gateway', name: 'Sudoclaw' },
      { backend: 'custom', name: 'Custom Agent', customAgentId: 'custom-1' },
      { backend: 'custom', name: 'Preset Assistant', customAgentId: 'builtin-writer', isPreset: true },
    ]);
  });

  it('splits conversation dropdown agents into cli and preset groups', () => {
    expect(splitConversationDropdownAgents(filterAvailableAgentsForUi(agents))).toEqual({
      cliAgents: [
        { backend: 'claude', name: 'Claude Code', cliPath: '/usr/local/bin/claude' },
        { backend: 'openclaw-gateway', name: 'Sudoclaw' },
      ],
      presetAssistants: [
        { backend: 'custom', name: 'Preset Assistant', customAgentId: 'builtin-writer', isPreset: true },
      ],
    });
  });
});
