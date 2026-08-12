import { describe, expect, it, vi } from 'vitest';

import { getAcpResumeStrategy } from '@/types/acpTypes';

/**
 * Resume-strategy SSOT + AcpConnection.newSession wiring.
 *
 * Regression guard for the "amnesia on resume" bug: sudowork used to resume every
 * non-codex backend by passing a generic `resumeSessionId` to `session/new`. scode's
 * ACP `session/new` ignores that param and mints a fresh, EMPTY session — so resume
 * silently lost all history. The fix routes resume by a declarative per-backend strategy:
 * 'session-load' (default, ACP-standard) for scode/codex, 'meta-resume' for CodeBuddy.
 */
describe('getAcpResumeStrategy (resume routing SSOT)', () => {
  it('defaults to session-load for scode (the ACP-standard session/load path)', () => {
    expect(getAcpResumeStrategy('scode')).toBe('session-load');
  });

  it('uses session-load for codex', () => {
    expect(getAcpResumeStrategy('codex')).toBe('session-load');
  });

  it('uses meta-resume for codebuddy', () => {
    expect(getAcpResumeStrategy('codebuddy')).toBe('meta-resume');
  });

  it('defaults unverified/other backends to session-load (safe: falls back to fresh on failure)', () => {
    expect(getAcpResumeStrategy('gemini')).toBe('session-load');
    expect(getAcpResumeStrategy('qwen')).toBe('session-load');
  });

  it('tolerates null/undefined backend with the session-load default', () => {
    expect(getAcpResumeStrategy(null)).toBe('session-load');
    expect(getAcpResumeStrategy(undefined)).toBe('session-load');
  });
});

type AcpConnectionCtor = typeof import('@/agent/acp/AcpConnection');

async function loadAcpConnection(): Promise<AcpConnectionCtor> {
  vi.resetModules();
  vi.doMock('@process/telemetry', () => ({
    recordFirstToken: vi.fn(),
  }));
  vi.doMock('@process/utils/mainLogger', () => ({
    mainLog: vi.fn(),
  }));
  vi.doMock('@process/utils/shellEnv', () => ({
    resolveNpxPath: vi.fn(() => 'npx'),
  }));
  vi.doMock('@process/services/authProxy', () => ({
    getAuthProxyPort: vi.fn(() => null),
    registerToken: vi.fn(),
    revokeToken: vi.fn(),
  }));
  vi.doMock('@/agent/acp/modelInfo', () => ({
    buildAcpModelInfo: vi.fn(() => null),
    summarizeAcpModelInfo: vi.fn(() => null),
  }));
  vi.doMock('@/agent/acp/acpConnectors', () => ({
    ACP_PERF_LOG: false,
    connectCodebuddy: vi.fn(),
    connectCodex: vi.fn(),
    prepareCleanEnv: vi.fn(() => process.env),
    spawnGenericBackend: vi.fn(),
  }));

  return await import('@/agent/acp/AcpConnection');
}

type NewSessionParams = {
  resumeSessionId?: string;
  _meta?: { claudeCode?: { options?: { resume?: string } } };
};

async function captureNewSessionParams(backend: string): Promise<NewSessionParams> {
  const { AcpConnection } = await loadAcpConnection();
  const connection = new AcpConnection();
  const sendRequest = vi.fn().mockResolvedValue({ sessionId: 'srv-session-id' });
  // sendRequest + backend are private; reach in to capture the wire params.
  (connection as unknown as { sendRequest: typeof sendRequest }).sendRequest = sendRequest;
  (connection as unknown as { backend: string }).backend = backend;

  await connection.newSession('/workspace', { resumeSessionId: 'prior-session', forkSession: false });

  const call = sendRequest.mock.calls[0];
  expect(call?.[0]).toBe('session/new');
  return call?.[1] as NewSessionParams;
}

describe('AcpConnection.newSession resume wiring', () => {
  it('does NOT attach a generic resumeSessionId or _meta for scode (resumes via session/load instead)', async () => {
    const params = await captureNewSessionParams('scode');
    expect(params).not.toHaveProperty('resumeSessionId');
    expect(params).not.toHaveProperty('_meta');
  });

  it('attaches _meta.claudeCode.options.resume for codebuddy wire compatibility', async () => {
    const params = await captureNewSessionParams('codebuddy');
    expect(params).not.toHaveProperty('resumeSessionId');
    expect(params._meta?.claudeCode?.options?.resume).toBe('prior-session');
  });
});
