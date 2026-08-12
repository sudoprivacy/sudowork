/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Team } from '@process/services/team/TeamStore';

const h = vi.hoisted(() => ({
  workDir: '',
  team: null as Team | null,
  reapConversation: vi.fn(async () => ({ id: '', dbDeleted: true, workspaceDeleted: false, errors: [] as unknown[] })),
  mainWarn: vi.fn(),
  emitListChanged: vi.fn(),
  softDeleteMembersByTeam: vi.fn(),
  softDeleteTeam: vi.fn(),
  buildConversation: vi.fn(() => ({ kill: vi.fn().mockResolvedValue(undefined) })),
}));

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '', getPath: () => '' } }));
vi.mock('@/common', () => ({
  ipcBridge: {
    acpConversation: { responseStream: { on: vi.fn(() => vi.fn()) } },
    team: { onListChanged: { emit: h.emitListChanged } },
  },
}));
vi.mock('@process/database', () => ({
  getDatabase: () => ({
    getConversation: () => ({ success: false, data: null }),
    updateConversation: () => ({ success: true }),
  }),
}));
vi.mock('@process/utils/mainLogger', () => ({ mainLog: vi.fn(), mainWarn: h.mainWarn, mainError: vi.fn() }));
vi.mock('@process/WorkerManage', () => ({ default: { buildConversation: h.buildConversation, kill: vi.fn(), clear: vi.fn() } }));
vi.mock('@/process/AssistantManager', () => ({
  assistantManager: { getAssistantMeta: vi.fn(() => null), getInstalledAssistants: vi.fn(() => []) },
}));
vi.mock('@/agent/acp/AcpDetector', () => ({ acpDetector: { getDetectedAgents: vi.fn(() => []) } }));
vi.mock('@process/services/claudeCli/NodeRuntimeService', () => ({ getNodeBinaryPath: () => 'node' }));
vi.mock('@process/utils/assistantResources', () => ({ readAssistantResource: vi.fn(), ruleFilePattern: /.*/ }));
vi.mock('@process/i18n', () => ({ default: { t: (k: string) => k }, i18nReady: Promise.resolve() }));
vi.mock('@process/services/conversationService', () => ({ createConversation: vi.fn() }));
// C3 关键：用 importOriginal 保留真实 isSafeAutoWorkspacePath（测真实白名单），只覆盖 reapConversation。
// 不可整体替换（如 teamCreateTeam.test.ts:112），否则 isSafeAutoWorkspacePath 为 undefined。
vi.mock('@process/services/conversationReaper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/process/services/conversationReaper')>();
  return { ...actual, reapConversation: (...args: unknown[]) => h.reapConversation(...args) };
});
vi.mock('@process/services/team/EventLoop', () => ({
  EventLoop: vi.fn(() => ({ start: vi.fn(), stop: vi.fn().mockResolvedValue(undefined), notifyWake: vi.fn() })),
}));
vi.mock('@process/services/team/TeamStore', () => ({
  teamStore: {
    getTeam: (id: string) => (h.team && h.team.id === id ? h.team : null),
    listMembersByTeam: () => [],
    softDeleteMembersByTeam: h.softDeleteMembersByTeam,
    softDeleteTeam: h.softDeleteTeam,
  },
}));
// conversationReaper 顶层其余依赖（importOriginal 真实加载会拉起，须一并 mock）
vi.mock('@process/bridge/terminalBridge', () => ({ closeTerminalsByConversation: vi.fn() }));
vi.mock('@process/bridge/browserPanelBridge', () => ({ closeBrowserTabsByConversation: vi.fn() }));
vi.mock('@process/message', () => ({ disposeConversation: vi.fn() }));
vi.mock('@process/telemetry', () => ({ stopConversationTracking: vi.fn() }));
vi.mock('@process/providers', () => ({ getConversationProvider: () => ({ deleteConversation: vi.fn(async () => true) }) }));
vi.mock('@process/services/cron/CronService', () => ({
  cronService: { listJobsByConversation: vi.fn(async () => []), removeJob: vi.fn(async () => {}) },
}));
// 控制白名单基准：workDir（isSafeAutoWorkspacePath :85）+ TEMP_WORKSPACE_REGEX（:38）
vi.mock('@process/initStorage', () => ({ getSystemDir: () => ({ workDir: h.workDir }) }));
vi.mock('@process/task/draftsCleanup', () => ({ TEMP_WORKSPACE_REGEX: /-temp-\d+$/ }));

const { teamService } = await import('../../src/process/services/team/TeamService');

function makeTeam(workspace: string | null, workspace_kind: Team['workspace_kind']): Team {
  return {
    id: 't1',
    user_id: 'system_default_user',
    name: 'T',
    workspace,
    workspace_kind,
    leader_member_id: null,
    session_mode: null,
    pinned: false,
    pinned_at: null,
    created_at: 1,
    updated_at: 1,
  };
}

describe('removeTeamWorkspace (C3 whitelist)', () => {
  let rmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    h.workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'team-ws-'));
    h.team = null;
    rmSpy = vi.spyOn(fs.promises, 'rm').mockResolvedValue(undefined);
    h.reapConversation.mockClear();
    h.mainWarn.mockClear();
    h.emitListChanged.mockClear();
    h.softDeleteMembersByTeam.mockClear();
    h.softDeleteTeam.mockClear();
  });

  afterEach(() => {
    rmSpy.mockRestore();
    try {
      fs.rmSync(h.workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('deletes managed temporary workspace (workDir direct child, -temp-<digits> basename)', async () => {
    const ws = path.join(h.workDir, 'scode-temp-123');
    h.team = makeTeam(ws, 'temporary');
    await teamService.removeTeam('t1', true);
    expect(rmSpy).toHaveBeenCalledWith(ws, { recursive: true, force: true });
    expect(h.mainWarn).not.toHaveBeenCalled();
  });

  it('keeps custom workspace outside workDir (user-selected project dir)', async () => {
    const ws = path.join(h.workDir, '..', 'MyProject');
    h.team = makeTeam(ws, 'custom');
    await teamService.removeTeam('t1', true);
    expect(rmSpy).not.toHaveBeenCalled();
    expect(h.mainWarn).toHaveBeenCalledWith('TeamService', expect.stringContaining('Skipped non-managed workspace'));
  });

  it('keeps workDir root / non-temp leaf / nested temp / ..-traversal (all fail whitelist)', async () => {
    const cases = [
      h.workDir, // workDir 根（:88 resolved===workDir 挡）
      path.join(h.workDir, 'not-temp'), // 叶子不匹配 /-temp-\d+$/
      path.join(h.workDir, 'sub', 'scode-temp-123'), // 非直接子目录（dirname !== workDir）
      path.join(h.workDir, '..', '..', 'evil-temp-123'), // .. 遍历出 workDir（path.resolve 规范化后 dirname !== workDir）
    ];
    for (const ws of cases) {
      rmSpy.mockClear();
      h.mainWarn.mockClear();
      h.team = makeTeam(ws, 'custom');
      await teamService.removeTeam('t1', true);
      expect(rmSpy).not.toHaveBeenCalled();
      expect(h.mainWarn).toHaveBeenCalled();
    }
  });

  it('early-returns before whitelist when workspace is null (removeTeamWorkspace:909)', async () => {
    h.team = makeTeam(null, null);
    await teamService.removeTeam('t1', true);
    expect(rmSpy).not.toHaveBeenCalled();
    expect(h.mainWarn).not.toHaveBeenCalled();
  });
});
