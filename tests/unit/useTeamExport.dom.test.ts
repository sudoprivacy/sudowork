import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportZipFile } from '../../src/renderer/pages/conversation/grouped-history/types';
import type { TTeam } from '../../src/renderer/pages/team/types';

const h = vi.hoisted(() => ({
  listMembers: vi.fn(),
  getConversation: vi.fn(),
  getConversationMessages: vi.fn(),
  getWorkspace: vi.fn(),
  getPath: vi.fn(),
  getFileMetadata: vi.fn(),
  createZip: vi.fn(),
  cancelZip: vi.fn(),
  showOpen: vi.fn(),
  messageSuccess: vi.fn(),
  messageError: vi.fn(),
  messageWarning: vi.fn(),
}));

vi.mock('@arco-design/web-react', () => ({
  Message: {
    success: (...args: unknown[]) => h.messageSuccess(...args),
    error: (...args: unknown[]) => h.messageError(...args),
    warning: (...args: unknown[]) => h.messageWarning(...args),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/renderer/utils/platform', () => ({
  isElectronDesktop: () => true,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    team: {
      listMembers: { invoke: (...args: unknown[]) => h.listMembers(...args) },
    },
    conversation: {
      get: { invoke: (...args: unknown[]) => h.getConversation(...args) },
      getWorkspace: { invoke: (...args: unknown[]) => h.getWorkspace(...args) },
    },
    database: {
      getConversationMessages: { invoke: (...args: unknown[]) => h.getConversationMessages(...args) },
    },
    application: {
      getPath: { invoke: (...args: unknown[]) => h.getPath(...args) },
    },
    fs: {
      getFileMetadata: { invoke: (...args: unknown[]) => h.getFileMetadata(...args) },
      createZip: { invoke: (...args: unknown[]) => h.createZip(...args) },
      cancelZip: { invoke: (...args: unknown[]) => h.cancelZip(...args) },
    },
    dialog: {
      showOpen: { invoke: (...args: unknown[]) => h.showOpen(...args) },
    },
  },
}));

import { useTeamExport } from '../../src/renderer/pages/team/hooks/useTeamExport';

function makeTeam(): TTeam {
  return {
    id: 'team-1',
    user_id: 'user-1',
    name: 'Team One',
    workspace: null,
    workspace_kind: null,
    leader_member_id: 'leader-slot',
    session_mode: null,
    pinned: false,
    pinned_at: null,
    created_at: 1,
    updated_at: 2,
    assistants: [],
  };
}

describe('useTeamExport', () => {
  beforeEach(() => {
    h.listMembers.mockReset();
    h.getConversation.mockReset();
    h.getConversationMessages.mockReset();
    h.getWorkspace.mockReset();
    h.getPath.mockReset();
    h.getFileMetadata.mockReset();
    h.createZip.mockReset();
    h.cancelZip.mockReset();
    h.showOpen.mockReset();
    h.messageSuccess.mockReset();
    h.messageError.mockReset();
    h.messageWarning.mockReset();
    h.getPath.mockResolvedValue('C:/Desktop');
    h.getFileMetadata.mockRejectedValue(new Error('not found'));
    h.getConversationMessages.mockResolvedValue([]);
    h.getConversation.mockImplementation(({ id }: { id: string }) => Promise.resolve({ id, name: id, type: 'acp', extra: {}, createTime: 1, modifyTime: 1 }));
    h.createZip.mockResolvedValue(true);
  });

  it('fetches members on export and uses that snapshot for files and manifests', async () => {
    h.listMembers.mockResolvedValue([
      { id: 'leader-slot', team_id: 'team-1', role: 'lead', name: 'Leader', assistant_id: 'scode', source: 'agent', backend: 'scode', preset_agent_type: null, skills: [], preset_context: null, model: null, avatar: null, conversation_id: 'conv-leader', status: 'idle', created_at: 1 },
      { id: 'member-slot', team_id: 'team-1', role: 'teammate', name: 'Worker', assistant_id: 'claude', source: 'agent', backend: 'claude', preset_agent_type: null, skills: [], preset_context: null, model: 'sonnet', avatar: null, conversation_id: 'conv-worker', status: 'idle', created_at: 1 },
    ]);
    const { result } = renderHook(() => useTeamExport());

    await act(async () => {
      await result.current.onOpenExport(makeTeam());
    });
    await waitFor(() => expect(result.current.exportTargetPath).toBe('C:/Desktop'));

    await act(async () => {
      await result.current.onConfirmExport();
    });

    expect(h.listMembers).toHaveBeenCalledWith({ teamId: 'team-1' });
    const files = (h.createZip.mock.calls[0][0] as { files: ExportZipFile[] }).files;
    const manifestJson = JSON.parse(files.find((file) => file.name.endsWith('/team.json'))?.content ?? '{}');
    const manifestMarkdown = files.find((file) => file.name.endsWith('/team.md'))?.content ?? '';
    expect(manifestJson.members).toHaveLength(2);
    expect(manifestJson.members[1]).toMatchObject({ slot_id: 'member-slot', assistant_name: 'Worker', conversation_id: 'conv-worker' });
    expect(manifestMarkdown).toContain('| teammate | Worker | member-slot | claude | sonnet | conv-worker |');
    expect(files.some((file) => file.name.includes('/conversations/member__member-slot__conv-worker/conversation.json'))).toBe(true);
  });
});
