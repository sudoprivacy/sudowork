import { RingBuffer } from '@/process/services/browserPanel/BrowserPanelCdpService';

describe('RingBuffer (BrowserPanelCdpService internal)', () => {
  it('keeps the most recent N items when overflowing', () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    expect(buf.snapshot()).toEqual([1, 2, 3]);
    expect(buf.length).toBe(3);

    buf.push(4);
    expect(buf.snapshot()).toEqual([2, 3, 4]);

    buf.push(5);
    buf.push(6);
    expect(buf.snapshot()).toEqual([4, 5, 6]);
    expect(buf.length).toBe(3);
  });

  it('returns snapshot in chronological (oldest → newest) order', () => {
    const buf = new RingBuffer<string>(4);
    buf.push('a');
    buf.push('b');
    expect(buf.snapshot()).toEqual(['a', 'b']);
    buf.push('c');
    buf.push('d');
    buf.push('e'); // overwrites 'a'
    expect(buf.snapshot()).toEqual(['b', 'c', 'd', 'e']);
  });

  it('updateLatest matches the most recent entry first', () => {
    const buf = new RingBuffer<{ id: string; value: number }>(5);
    buf.push({ id: 'r1', value: 1 });
    buf.push({ id: 'r2', value: 2 });
    buf.push({ id: 'r1', value: 3 }); // second occurrence, newer

    // updateLatest should find the SECOND r1 (newer one) and update it
    const updated = buf.updateLatest(
      (r) => r.id === 'r1',
      (r) => ({ ...r, value: 99 }),
    );
    expect(updated).toBe(true);

    const snapshot = buf.snapshot();
    expect(snapshot[0]).toEqual({ id: 'r1', value: 1 }); // older r1 untouched
    expect(snapshot[1]).toEqual({ id: 'r2', value: 2 });
    expect(snapshot[2]).toEqual({ id: 'r1', value: 99 }); // newer r1 updated
  });

  it('updateLatest returns false when nothing matches', () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    const updated = buf.updateLatest(
      (n) => n === 999,
      (n) => n + 1,
    );
    expect(updated).toBe(false);
    expect(buf.snapshot()).toEqual([1, 2]);
  });

  it('updateLatest works correctly across the wrap-around boundary', () => {
    const buf = new RingBuffer<number>(3);
    [1, 2, 3, 4, 5].forEach((n) => buf.push(n));
    // snapshot is [3, 4, 5]; the underlying storage is wrapped
    const updated = buf.updateLatest(
      (n) => n === 3,
      () => 30,
    );
    expect(updated).toBe(true);
    expect(buf.snapshot()).toEqual([30, 4, 5]);
  });

  it('clear() resets length and snapshot', () => {
    const buf = new RingBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.clear();
    expect(buf.length).toBe(0);
    expect(buf.snapshot()).toEqual([]);
    buf.push(7);
    expect(buf.snapshot()).toEqual([7]);
  });
});
