/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  registry: new Map<string, (...args: any[]) => any>(),
  emits: [] as Array<{ path: string; args: any[] }>,
  reap: vi.fn(async (_id: string) => ({ id: _id, dbDeleted: true, workspaceDeleted: false, errors: [] })),
  uninstall: vi.fn(async () => ({ success: true })),
  findIds: vi.fn((key: string) => {
    if (key === 'builtin-foo') return { success: true, data: { conversationIds: ['c1'] } };
    if (key === 'foo') return { success: true, data: { conversationIds: ['c2'] } };
    return { success: true, data: { conversationIds: [] } };
  }),
}));

function makeChannelProxy(pathStr: string): any {
  return new Proxy(() => {}, {
    get(_t, prop: string) {
      if (prop === 'provider' || prop === 'on') {
        return (cb: (...args: any[]) => any) => h.registry.set(`${pathStr}.${prop}`, cb);
      }
      if (prop === 'emit') {
        return (...args: any[]) => h.emits.push({ path: pathStr, args });
      }
      return makeChannelProxy(pathStr ? `${pathStr}.${String(prop)}` : String(prop));
    },
  });
}

vi.mock('@/common', () => ({ ipcBridge: makeChannelProxy('') }));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: vi.fn(), mainError: vi.fn() }));
vi.mock('@/process/services/conversationReaper', () => ({ reapConversation: h.reap }));
vi.mock('@/process/AssistantManager', () => ({ assistantManager: { uninstallAssistant: h.uninstall } }));
vi.mock('@/process/database', () => ({ getDatabase: () => ({ findConversationIdsByPresetAssistantId: h.findIds }) }));
vi.mock('@/process/initStorage', () => ({
  getAssistantsDir: () => '/tmp/a',
  getHubAssistantsDir: () => '/tmp/h',
  getSystemAssistantsDir: () => '/tmp/s',
  getCustomAssistantsDir: () => '/tmp/c',
}));
vi.mock('@/process/SkillManager', () => ({ skillManager: {} }));
vi.mock('@/types/acpTypes', () => ({ DEFAULT_PRESET_AGENT_TYPE: 'scode', normalizePresetAgentType: (v: unknown) => v }));
vi.mock('@/common/enterpriseDebugConfig', () => ({ isEnterpriseMode: () => false }));
vi.mock('@/process/constants/enterpriseStorage', () => ({ ASSISTANTS_ROOT_DIR: 'assistants', ENTERPRISE_ASSISTANT_SUBDIRS: {} }));
vi.mock('@sudowork/common/systemConfig', () => ({ getSkillHubBaseUrl: () => 'https://hub.example' }));
vi.mock('@/process/credentialsCache', () => ({ getSkillhubToken: () => '' }));
vi.mock('@common/nexus/hubErrors', () => ({ tokenMissingResponse: () => ({ success: false }) }));

describe('assistantHub uninstall routes through the reaper', () => {
  beforeEach(async () => {
    h.registry.clear();
    h.emits.length = 0;
    h.reap.mockClear();
    h.uninstall.mockClear();
    h.findIds.mockClear();
    const { initAssistantHubBridge } = await import('../../src/process/bridge/assistantHubBridge');
    initAssistantHubBridge();
  });

  it('reaps conversations for both the name and the builtin-stripped id', async () => {
    const cb = h.registry.get('assistantHub.uninstallAssistant.provider');
    expect(cb).toBeTypeOf('function');

    const result = await cb!({ name: 'builtin-foo', category: 'custom' });

    // Both matched ids reaped through the SSOT (not a raw DB delete).
    expect(h.reap).toHaveBeenCalledWith('c1', { reason: 'assistant-uninstall' });
    expect(h.reap).toHaveBeenCalledWith('c2', { reason: 'assistant-uninstall' });
    // Looked up under both the raw name and the stripped id.
    expect(h.findIds).toHaveBeenCalledWith('builtin-foo');
    expect(h.findIds).toHaveBeenCalledWith('foo');
    // Assistant itself uninstalled + list-refresh events emitted per reaped id.
    expect(h.uninstall).toHaveBeenCalledWith('builtin-foo', 'custom');
    const changedEmits = h.emits.filter((e) => e.path === 'database.conversationChanged');
    expect(changedEmits.length).toBe(2);
    expect(result).toEqual({ success: true, data: undefined });
  });
});
