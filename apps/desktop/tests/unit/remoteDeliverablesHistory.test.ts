import { beforeEach, describe, expect, it, vi } from 'vitest';
import { appendGeneratedFilesMarker } from '@sudowork/common/generatedFiles';
const mocks = vi.hoisted(() => ({ messages: vi.fn(), tree: vi.fn() }));
vi.mock('@process/database', () => ({ getDatabase: () => ({ getConversation: () => ({ data: { type: 'remote-agent', extra: { mossSessionId: 'session', mossServerUrl: 'https://moss.test', workspace: '/workspace' } } }), getConversationMessages: mocks.messages }) }));
vi.mock('@process/services/team/TeamStore', () => ({ teamStore: {} }));
vi.mock('@process/utils/mainLogger', () => ({ mainError: vi.fn() }));
vi.mock('@process/services/mossExecutionContext', () => ({ assertConversationAccount: vi.fn() }));
vi.mock('@process/remote/MossSessionApi', () => ({ initMossApi: () => ({ getSessionWorkspaceTree: mocks.tree }) }));
import { deliverablesService } from '@process/services/deliverables/DeliverablesService';
beforeEach(() => vi.clearAllMocks());
describe('remote deliverable history', () => {
  it('recovers linked outputs from an old session, excluding user input attachments and nonexistent files', async () => {
    mocks.messages.mockReturnValue({
      data: [
        { type: 'text', position: 'right', content: { content: 'Read this [[NEXUS_FILES]]\n/tmp/input.txt' }, createdAt: 1 },
        { type: 'text', position: 'left', content: { content: '[Input](input.txt) [Result](qa-result.md) [Preview](qa-preview.html) [Missing](missing.md)' }, createdAt: 2 },
      ],
      hasMore: false,
    });
    mocks.tree.mockResolvedValue({ relativePath: '', isFile: false, children: ['input.txt', 'qa-result.md', 'qa-preview.html'].map((relativePath) => ({ relativePath, fullPath: `/workspace/${relativePath}`, isFile: true })) });
    const entries = await deliverablesService.listRemoteForConversation('conversation');
    expect(entries.map((entry) => entry.relativePath)).toEqual(['qa-result.md', 'qa-preview.html']);
  });
  it('keeps persisted outputs visible when the workspace service is offline', async () => {
    const entry = { path: '/workspace/result.md', relativePath: 'result.md', ext: 'md', kind: 'create' as const, createdAt: 1 };
    mocks.messages.mockReturnValue({ data: [{ type: 'text', position: 'left', content: { content: appendGeneratedFilesMarker('', [entry]) } }], hasMore: false });
    mocks.tree.mockRejectedValue(new Error('offline'));
    expect(await deliverablesService.listRemoteForConversation('conversation')).toEqual([entry]);
  });
});
