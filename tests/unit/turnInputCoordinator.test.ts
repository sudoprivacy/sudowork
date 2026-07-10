/**
 * Covers the interrupt × queue decision matrix + serial flush ordering that
 * turnInputCoordinator centralizes for both the desktop and channel input paths.
 */
import { describe, it, expect } from 'vitest';
import { TurnInputCoordinator, type QueuedTurn } from '@process/task/turnInputCoordinator';

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Drives run-closures: each run() stays pending until finishCurrent()/interrupt() resolves it. */
class TurnController {
  calls: string[] = [];
  stops = 0;
  private resolvers: Array<() => void> = [];
  run(id: string) {
    return () => {
      this.calls.push(id);
      return new Promise<void>((resolve) => this.resolvers.push(resolve));
    };
  }
  interrupt = () => {
    this.stops += 1;
    this.finishCurrent(); // cancel resolves the in-flight turn, like a real session/cancel
    return Promise.resolve();
  };
  /** Resolve the oldest in-flight turn (simulate a turn completing). */
  finishCurrent() {
    const r = this.resolvers.shift();
    if (r) r();
  }
}

const turn = (c: TurnController, id: string): QueuedTurn => ({ id, content: id, run: c.run(id) });
const QUEUE = { autoInterrupt: false, messageQueue: true };
const INTERRUPT = { autoInterrupt: true, messageQueue: true };
const BLOCK = { autoInterrupt: false, messageQueue: false };

describe('TurnInputCoordinator', () => {
  it('idle → runs immediately', async () => {
    const c = new TurnInputCoordinator();
    const t = new TurnController();
    expect(c.submit('x', turn(t, 'A'), t.interrupt, QUEUE)).toBe('sent');
    await flush();
    expect(t.calls).toEqual(['A']);
  });

  it('queue mode: inputs flush in submission order after each turn', async () => {
    const c = new TurnInputCoordinator();
    const t = new TurnController();
    c.submit('x', turn(t, 'A'), t.interrupt, QUEUE);
    await flush();
    expect(c.submit('x', turn(t, 'B'), t.interrupt, QUEUE)).toBe('queued');
    expect(c.submit('x', turn(t, 'C'), t.interrupt, QUEUE)).toBe('queued');
    expect(t.calls).toEqual(['A']); // B, C waiting
    t.finishCurrent();
    await flush();
    expect(t.calls).toEqual(['A', 'B']);
    t.finishCurrent();
    await flush();
    expect(t.calls).toEqual(['A', 'B', 'C']);
  });

  it('auto-interrupt: a new message cancels the current turn and runs next', async () => {
    const c = new TurnInputCoordinator();
    const t = new TurnController();
    c.submit('x', turn(t, 'A'), t.interrupt, INTERRUPT);
    await flush();
    expect(c.submit('x', turn(t, 'B'), t.interrupt, INTERRUPT)).toBe('interrupting');
    await flush();
    expect(t.stops).toBe(1);
    expect(t.calls).toEqual(['A', 'B']);
  });

  it('auto-interrupt + queue off: pending items are dropped, only the newest runs next', async () => {
    const c = new TurnInputCoordinator();
    const t = new TurnController();
    c.submit('x', turn(t, 'A'), t.interrupt, QUEUE); // start a turn
    await flush();
    c.submit('x', turn(t, 'B'), t.interrupt, QUEUE); // B queued
    expect(c.getQueue('x').map((q) => q.id)).toEqual(['B']);
    c.submit('x', turn(t, 'C'), t.interrupt, { autoInterrupt: true, messageQueue: false }); // drop B, run C next
    expect(c.getQueue('x').map((q) => q.id)).toEqual(['C']);
    await flush();
    expect(t.calls).toEqual(['A', 'C']); // B never ran
  });

  it('both off: a turn in progress blocks new sends', async () => {
    const c = new TurnInputCoordinator();
    const t = new TurnController();
    c.submit('x', turn(t, 'A'), t.interrupt, BLOCK);
    await flush();
    expect(c.submit('x', turn(t, 'B'), t.interrupt, BLOCK)).toBe('busy');
    await flush();
    expect(t.calls).toEqual(['A']);
  });

  it('dequeue removes by id, or the most recent when unspecified', async () => {
    const c = new TurnInputCoordinator();
    const t = new TurnController();
    c.submit('x', turn(t, 'A'), t.interrupt, QUEUE);
    await flush();
    c.submit('x', turn(t, 'B'), t.interrupt, QUEUE);
    c.submit('x', turn(t, 'C'), t.interrupt, QUEUE);
    expect(c.dequeue('x', 'B')?.id).toBe('B');
    expect(c.getQueue('x').map((q) => q.id)).toEqual(['C']);
    expect(c.dequeue('x')?.id).toBe('C'); // most recent
    expect(c.getQueue('x')).toEqual([]);
  });

  it('a cancelled/failed turn does not stall the queue', async () => {
    const c = new TurnInputCoordinator();
    const calls: string[] = [];
    const failing = (id: string): QueuedTurn => ({ id, content: id, run: () => { calls.push(id); return Promise.reject(new Error('cancelled')); } });
    c.submit('x', failing('A'), () => Promise.resolve(), QUEUE);
    c.submit('x', failing('B'), () => Promise.resolve(), QUEUE);
    await flush();
    await flush();
    expect(calls).toEqual(['A', 'B']);
  });
});
