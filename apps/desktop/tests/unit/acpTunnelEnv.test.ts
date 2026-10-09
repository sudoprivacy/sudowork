import { beforeEach, describe, expect, it, vi } from 'vitest';

const mainWarn = vi.fn();
vi.mock('@process/utils/mainLogger', () => ({
  mainLog: vi.fn(),
  mainWarn: (...args: unknown[]) => mainWarn(...args),
}));

const { resolveTunnelEnv } = await import('@/agent/acp/tunnelEnv');

/**
 * The third outcome of the tunnel decision, and the one that was silent
 * longest: the daemon is not serving at all, so the spawn goes local without
 * ever attempting a dial. A dial that fails is warned about downstream in
 * AcpConnection; this branch never gets that far.
 */
describe('resolveTunnelEnv', () => {
  beforeEach(() => mainWarn.mockClear());

  it('routes scode through the tunnel when one is serving', () => {
    expect(resolveTunnelEnv('scode', '127.0.0.1:12022')).toEqual({
      ACP_GRPC_ENDPOINT: '127.0.0.1:12022',
    });
    expect(mainWarn).not.toHaveBeenCalled();
  });

  it('says so when the daemon is not serving, rather than going local in silence', () => {
    expect(resolveTunnelEnv('scode', null)).toEqual({});
    expect(mainWarn).toHaveBeenCalledWith('[AcpAgent]', expect.stringContaining('tunnel unavailable'));
    expect(mainWarn).toHaveBeenCalledWith('[AcpAgent]', expect.stringContaining('scode'));
  });

  it('leaves other backends alone, and stays quiet about them', () => {
    // Not a capability check — a deliberate allowlist. scode is the only
    // backend proven end-to-end over the tunnel, so the others are not
    // "failing" to tunnel and must not be reported as though they were.
    for (const backend of ['claude', 'codex', 'gemini', 'qwen']) {
      expect(resolveTunnelEnv(backend, '127.0.0.1:12022'), backend).toEqual({});
      expect(resolveTunnelEnv(backend, null), backend).toEqual({});
    }
    expect(mainWarn).not.toHaveBeenCalled();
  });
});
