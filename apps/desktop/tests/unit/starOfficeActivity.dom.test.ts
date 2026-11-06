import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(path.resolve(__dirname, '../../examples/star-office-extension/settings/star-office.js'), 'utf8');
let frame: HTMLIFrameElement;
let child: Window;
let parentMessages: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-06T00:00:00Z'));
  frame = document.createElement('iframe');
  document.body.appendChild(frame);
  child = frame.contentWindow!;
  child.document.body.innerHTML = '<div id="stats"></div><div id="agent-layer"></div><div id="activity-feed"></div><div id="source-text"></div><button id="refresh-btn"></button><button id="autoplay-btn"></button>';
  parentMessages = vi.spyOn(child.parent, 'postMessage').mockImplementation(() => {});
  runInNewContext(source, { window: child, document: child.document, Date, Math, setTimeout, clearTimeout, setInterval });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  frame.remove();
});

async function deliver(expiresAt: number, state = 'executing', reqId?: string) {
  child.dispatchEvent(
    new MessageEvent('message', {
      data: {
        type: 'star-office:activity-snapshot',
        reqId,
        snapshot: {
          generatedAt: Date.now(),
          agents: [{ id: 'connection::instance', agentName: 'same-agent', state, runtimeStatus: state === 'idle' ? 'finished' : 'running', runtimeObservation: { availability: 'available', expiresAt } }],
        },
      },
    })
  );
  await Promise.resolve();
}

describe('Star Office observation freshness', () => {
  it('clears an expired state before the next poll, even when polling is paused', async () => {
    const request = parentMessages.mock.calls[0][0] as { reqId: string };
    await deliver(Date.now() + 3000, 'executing', request.reqId);
    expect(child.document.querySelector('.state-executing')).not.toBeNull();
    child.document.getElementById('autoplay-btn')!.click();

    await vi.advanceTimersByTimeAsync(2999);
    expect(child.document.querySelector('.state-executing')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(child.document.querySelector('.state-unknown')).not.toBeNull();
    expect(child.document.querySelector('.state-executing')).toBeNull();
    expect(child.document.getElementById('stats')!.textContent).toMatch(/Running\s*0/);
    expect(parentMessages).toHaveBeenCalledTimes(1);
  });

  it('keeps a newer observation valid when an earlier observation would have expired', async () => {
    const request = parentMessages.mock.calls[0][0] as { reqId: string };
    await deliver(Date.now() + 3000, 'executing', request.reqId);
    await vi.advanceTimersByTimeAsync(2000);
    await deliver(Date.now() + 3000, 'idle');
    await vi.advanceTimersByTimeAsync(1000);
    expect(child.document.querySelector('.state-idle')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(2000);
    expect(child.document.querySelector('.state-idle')).toBeNull();
    expect(child.document.querySelector('.state-unknown')).not.toBeNull();
  });

  it('keeps an invalid embedded host response in live mode without inventing mock agents', async () => {
    const request = parentMessages.mock.calls[0][0] as { reqId: string };
    child.dispatchEvent(new MessageEvent('message', { data: { type: 'star-office:activity-snapshot', reqId: request.reqId, snapshot: null } }));
    await Promise.resolve();
    await Promise.resolve();
    expect(child.document.querySelectorAll('.agent')).toHaveLength(0);
    expect(child.document.getElementById('source-text')!.textContent).not.toContain('Mock');
  });
});
