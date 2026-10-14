import { describe, expect, it } from 'vitest';
import { BrowserSessionActionSchema, BrowserSessionReplySchema, isCurrentBrowserFrame } from '@sudowork/contracts/browser-session';

const state = {
  browserSessionId: 'browser-owned',
  profileId: 'profile-owned',
  state: 'human',
  controlEpoch: 4,
  targetEpoch: 2,
  isController: true,
  isHeadless: true,
  transport: 'extension',
  capabilities: { pageView: true, windowView: false, persistentProfile: true },
  activeTargetId: 'target-2',
  tabs: [{ id: 'target-2', title: 'Login', url: 'https://example.test/login' }],
  error: null,
} as const;

describe('browser session boundary', () => {
  it('drops a frame from before handoff or before a tab switch', () => {
    const reply = BrowserSessionReplySchema.parse({ session: state, frame: { data: 'pixels', width: 480, height: 850, controlEpoch: 3, targetEpoch: 2 } });
    expect(isCurrentBrowserFrame(reply.session, reply.frame!)).toBe(false);
    expect(isCurrentBrowserFrame(reply.session, { ...reply.frame!, controlEpoch: 4, targetEpoch: 1 })).toBe(false);
    expect(isCurrentBrowserFrame(reply.session, { ...reply.frame!, controlEpoch: 4 })).toBe(true);
  });

  it('accepts Unicode text and preserves the observation epochs', () => {
    const request = BrowserSessionActionSchema.parse({ kind: 'input', input: { kind: 'text', text: '登录完成 😀' }, controlEpoch: 4, targetEpoch: 2, actor: 'forged-controller' });
    expect(request).toEqual({ kind: 'input', input: { kind: 'text', text: '登录完成 😀' }, controlEpoch: 4, targetEpoch: 2 });
  });

  it('rejects incomplete or unbounded input instead of supplying fresh epochs', () => {
    expect(BrowserSessionActionSchema.safeParse({ kind: 'input', input: { kind: 'click', x: 1, y: 1 } }).success).toBe(false);
    for (const x of [NaN, Infinity, -1]) {
      expect(BrowserSessionActionSchema.safeParse({ kind: 'input', input: { kind: 'click', x, y: 1 }, controlEpoch: 4, targetEpoch: 2 }).success).toBe(false);
    }
    expect(BrowserSessionActionSchema.safeParse({ kind: 'navigate', url: 'javascript:submitPayment()', controlEpoch: 4, targetEpoch: 2 }).success).toBe(false);
  });
});
