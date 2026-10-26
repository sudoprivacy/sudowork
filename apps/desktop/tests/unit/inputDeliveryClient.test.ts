import { afterEach, describe, expect, it, vi } from 'vitest';
import { InputDeliveryClient } from '@sudowork/moss-client/input-delivery';
import type { InputState } from '@sudowork/contracts/input-delivery';

const queued = { id: 2, clientId: 'draft', display: 'continue working', source: 'human' as const, delivery: 'queue' as const };
const state = (revision: number, pending: InputState['pending'] = []): InputState => ({ revision, activeTurnId: 1, running: true, paused: false, pending });
afterEach(() => vi.useRealTimers());

describe('host input delivery transport', () => {
  it('accepts a restarted upstream revision while the browser socket stays connected', () => {
    const onReset = vi.fn();
    const client = new InputDeliveryClient(() => true, vi.fn(), onReset);
    client.receive({ type: 'input_delivery_update', update: { kind: 'state', state: state(100, [queued]) } });
    client.receive({ type: 'input_delivery_reset' });
    expect(client.state).toBeNull();
    expect(onReset).toHaveBeenCalledOnce();
    client.receive({ type: 'input_delivery_update', update: { kind: 'state', state: state(1) } });
    expect(client.state?.revision).toBe(1);
    expect(client.state?.pending).toEqual([]);
  });

  it('keeps the consumed projection when a slower admission response arrives', async () => {
    const onUpdate = vi.fn();
    const send = vi.fn(() => true);
    const client = new InputDeliveryClient(send, onUpdate);
    const admitted = client.request('request', { action: 'submit', clientId: 'draft', delivery: 'queue', content: [{ type: 'text', text: 'continue working' }] });
    client.receive({ type: 'input_delivery_update', update: { kind: 'state', state: state(3, []) } });
    client.receive({ type: 'input_delivery_reply', requestId: 'request', isSupported: true, receipt: { id: 2, state: state(2, [queued]) } });
    await expect(admitted).resolves.toMatchObject({ id: 2 });
    expect(client.state?.pending).toEqual([]);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('recalls full editor state and images without scheduling another turn', async () => {
    const send = vi.fn(() => true);
    const client = new InputDeliveryClient(send, vi.fn());
    const recalled = [{ clientId: 'draft', draft: { text: 'original text', files: ['/webupload/image.png'], skills: ['review'] }, content: [{ type: 'image', mimeType: 'image/png', data: 'encoded-image' }] }];
    const promise = client.request('recall', { action: 'recall' });
    client.receive({ type: 'input_delivery_reply', requestId: 'recall', isSupported: true, receipt: { state: state(4), recalled } });
    await expect(promise).resolves.toMatchObject({ recalled });
    expect(send).toHaveBeenCalledExactlyOnceWith('recall', { action: 'recall' });
  });

  it('never retries input after a timeout or a disconnected acknowledgement', async () => {
    vi.useFakeTimers();
    const send = vi.fn(() => true);
    const client = new InputDeliveryClient(send, vi.fn());
    const promise = client.request('flush', { action: 'flush_or_cancel' });
    const outcome = expect(promise).rejects.toThrow(/outcome is unknown/);
    await vi.advanceTimersByTimeAsync(30_000);
    await outcome;
    expect(send).toHaveBeenCalledTimes(1);
    const next = client.request('snapshot', { action: 'snapshot' });
    const closed = expect(next).rejects.toThrow(/Connection closed/);
    client.disconnect();
    await closed;
    expect(vi.getTimerCount()).toBe(0);
  });
});

it('cleans up correlation and timers when a socket send throws synchronously', async () => {
  vi.useFakeTimers();
  const client = new InputDeliveryClient(() => {
    throw new Error('closed socket');
  }, vi.fn());
  await expect(client.request('failed', { action: 'snapshot' })).rejects.toThrow('closed socket');
  expect(vi.getTimerCount()).toBe(0);
  client.disconnect();
});
