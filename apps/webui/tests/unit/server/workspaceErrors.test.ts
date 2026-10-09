import { describe, expect, test, vi } from 'vitest'
import { MossHttpError } from '@sudowork/moss-client'
import {
  getWorkspaceFile,
  getWorkspaceTree,
  SessionForbiddenError,
  SessionNotFoundError,
  uploadWorkspaceFile,
  type ConversationDeps,
} from '@server/features/conversations/conversationService'
import type { Principal } from '@server/features/auth/principalRepository'

const principal = { mossUserId: 'owner', orgId: 'org' } as Principal
const ctx = { accessToken: 'fixture', baseUrl: 'http://moss.test' }

function fixture() {
  const moss = {
    get: vi.fn().mockResolvedValue({ userId: 'owner', orgId: 'org' }),
    workspaceFileGet: vi.fn(),
    workspaceFilePost: vi.fn(),
    workspaceTree: vi.fn(),
  }
  const deps = { moss, config: { upload: { maxFileBytes: 1024 } } } as unknown as ConversationDeps
  return { deps, moss }
}

describe('workspace file error semantics', () => {
  test.each(['read', 'write', 'tree'])(
    'preserves a missing file on %s as a workspace error',
    async (operation) => {
      const { deps, moss } = fixture()
      const error = new MossHttpError(404, 'Path not found', '/workspace/file')
      moss.workspaceFileGet.mockRejectedValue(error)
      moss.workspaceFilePost.mockRejectedValue(error)
      moss.workspaceTree.mockRejectedValue(error)
      const call =
        operation === 'read'
          ? getWorkspaceFile(deps, principal, 'session', 'missing.txt', ctx)
          : operation === 'write'
            ? uploadWorkspaceFile(deps, principal, 'session', 'missing.txt', 'eA==', ctx)
            : getWorkspaceTree(deps, principal, 'session', 'missing', ctx)
      await expect(call).rejects.toBe(error)
    },
  )

  test('continues to report a missing session before file access', async () => {
    const { deps, moss } = fixture()
    moss.get.mockRejectedValue(new MossHttpError(404, '', '/sessions/missing'))
    await expect(
      getWorkspaceFile(deps, principal, 'missing', 'file.txt', ctx),
    ).rejects.toBeInstanceOf(SessionNotFoundError)
    expect(moss.workspaceFileGet).not.toHaveBeenCalled()
  })

  test('checks ownership before reading a workspace', async () => {
    const { deps, moss } = fixture()
    moss.get.mockResolvedValue({ userId: 'other-user', orgId: 'org' })
    await expect(
      getWorkspaceFile(deps, principal, 'foreign', 'file.txt', ctx),
    ).rejects.toBeInstanceOf(SessionForbiddenError)
    expect(moss.workspaceFileGet).not.toHaveBeenCalled()
  })
})
