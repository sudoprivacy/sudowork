/**
 * Covers the interrupt × queue decision matrix + batched-flush semantics that
 * turnInputCoordinator centralizes for both the desktop and channel input paths.
 *
 * Batched flush (§3.2): N items queued during a running turn flush as ONE combined
 * downstream call — the head's run-closure receives the remaining items as `tail`
 * and merges their text into a single user message. Auto-interrupted turns are `solo`
 * — they do not batch with successors.
 */
import { describe, it, expect } from 'vitest';
import { TurnInputCoordinator, type QueuedTurn } from '@process/task/turnInputCoordinator';

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Records each run() call including any tail items, and lets tests resolve turns on demand. */
class TurnController {
  calls: Array<{ id: string; tail?: string[] }> = [];
  stops = 0;
  private resolvers: Array<() => void> = [];
  run(id: string) {
    return (tail?: QueuedTurn[]) => {
      this.calls.push({ id, tail: tail?.map((t) => t.id) });
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
  /** Just the head ids, for concise "which turns actually ran" assertions. */
  heads(): string[] {
    return this.calls.map((c) => c.id);
  }
}

const turn = (c: TurnController, id: string): QueuedTurn => ({ id, content: id, run: c.run(id) });
const QUEUE = { autoInterrupt: false, messageQueue: true };
const INTERRUPT = { autoInterrupt: true, messageQueue: true };
const BLOCK = { autoInterrupt: false, messageQueue: false };

describe('TurnInputCoordinator', () => {
  it('idle → runs immediately with no tail', async () => {
    const c = new TurnInputCoordinator();
    const t = new TurnController();
    expect(c.submit('x', turn(t, 'A'), t.interrupt, QUEUE)).toBe('sent');
    await flush();
    expect(t.calls).toEqual([{ id: 'A', tail: undefined }]);
  });

  it('queue mode: N items queued during a turn flush as ONE combined tail on turn-end', async () => {
    const c = new TurnInputCoordinator();
    const t = new TurnController();
    c.submit('x', turn(t, 'A'), t.interrupt, QUEUE);
    await flush();
    expect(c.submit('x', turn(t, 'B'), t.interrupt, QUEUE)).toBe('queued');
    expect(c.submit('x', turn(t, 'C'), t.interrupt, QUEUE)).toBe('queued');
    expect(t.heads()).toEqual(['A']); // B, C waiting, A running
    t.finishCurrent(); // A resolves → drain flushes B+C as ONE batched turn
    await flush();
    // Exactly 2 downstream turns total (A alone; then B with tail=[C]) — NOT 3.
    expect(t.calls).toEqual([
      { id: 'A', tail: undefined },
      { id: 'B', tail: ['C'] },
    ]);
    // No further work when the batched turn finishes.
    t.finishCurrent();
    await flush();
    expect(t.heads()).toEqual(['A', 'B']);
  });

  it('auto-interrupt: interrupter runs SOLO, does not batch with items queued behind it', async () => {
    const c = new TurnInputCoordinator();
    const t = new TurnController();
    c.submit('x', turn(t, 'A'), t.interrupt, INTERRUPT);
    await flush();
    // Queue B in the normal queue first — it should NOT get batched into C when C interrupts.
    c.submit('x', turn(t, 'B'), t.interrupt, QUEUE);
    expect(c.submit('x', turn(t, 'C'), t.interrupt, INTERRUPT)).toBe('interrupting');
    await flush();
    expect(t.stops).toBe(1);
    // After the interrupt: A's turn resolved (cancelled), C picked up as solo.
    expect(t.calls).toEqual([
      { id: 'A', tail: undefined },
      { id: 'C', tail: undefined },
    ]);
    // Finish C → drain picks up B alone (only item left, tail empty).
    t.finishCurrent();
    await flush();
    expect(t.calls).toEqual([
      { id: 'A', tail: undefined },
      { id: 'C', tail: undefined },
      { id: 'B', tail: undefined },
    ]);
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
    expect(t.heads()).toEqual(['A', 'C']); // B never ran
  });

  it('both off: a turn in progress blocks new sends', async () => {
    const c = new TurnInputCoordinator();
    const t = new TurnController();
    c.submit('x', turn(t, 'A'), t.interrupt, BLOCK);
    await flush();
    expect(c.submit('x', turn(t, 'B'), t.interrupt, BLOCK)).toBe('busy');
    await flush();
    expect(t.heads()).toEqual(['A']);
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

  it('a cancelled/failed head does not stall subsequent iterations', async () => {
    const c = new TurnInputCoordinator();
    const calls: string[] = [];
    const failing = (id: string): QueuedTurn => ({
      id,
      content: id,
      run: () => {
        calls.push(id);
        return Promise.reject(new Error('cancelled'));
      },
    });
    c.submit('x', failing('A'), () => Promise.resolve(), QUEUE);
    await flush(); // let A start (and reject) before B is submitted, so B is not batched into A's tail
    c.submit('x', failing('B'), () => Promise.resolve(), QUEUE);
    await flush();
    await flush();
    expect(calls).toEqual(['A', 'B']);
  });

  it('batched flush: N=5 items queued during a slow turn → head+tail of 4 in one call', async () => {
    // Guards the tokens-saving promise of the doc: five queued messages during a long turn
    // must not produce five downstream API calls.
    const c = new TurnInputCoordinator();
    const t = new TurnController();
    c.submit('x', turn(t, 'A'), t.interrupt, QUEUE);
    await flush();
    for (const id of ['B', 'C', 'D', 'E', 'F']) c.submit('x', turn(t, id), t.interrupt, QUEUE);
    t.finishCurrent();
    await flush();
    expect(t.calls).toEqual([
      { id: 'A', tail: undefined },
      { id: 'B', tail: ['C', 'D', 'E', 'F'] },
    ]);
  });
});
