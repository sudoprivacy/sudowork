import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LocalAgentToolControl } from '../../src/process/services/browserPanel/LocalAgentToolControl';

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'local-tool-control-'));
  const filename = () => path.join(root, 'control.json');
  return { filename, control: new LocalAgentToolControl(filename) };
}

describe('local browser admission and acknowledged tool barriers', () => {
  it('keeps the browser with AI when an active agent cannot acknowledge takeover', async () => {
    const { control } = fixture();
    control.register('unsupported', {
      ready: async () => {},
      connection: {
        hasActiveSession: true,
        isToolPauseSupported: false,
        pauseTools: async () => {
          throw new Error('Unsupported pause must not run');
        },
        resumeTools: async () => {},
      },
    });
    let isGranted = false;
    await expect(
      control.take('conversation', async () => {
        isGranted = true;
      })
    ).rejects.toThrow('cannot acknowledge');
    expect(isGranted).toBe(false);
    expect(control.status()).toEqual({ epoch: 0, state: 'ai' });
    expect(control.assertCanPrompt()).toBe(0);
  });

  it('waits for every actor before granting input and rejects old queued prompts', async () => {
    const { control } = fixture();
    const events: string[] = [];
    let ready!: () => void;
    const bootstrap = new Promise<void>((resolve) => {
      ready = resolve;
    });
    control.register('main', {
      ready: () => bootstrap,
      connection: {
        hasActiveSession: true,
        pauseTools: async () => {
          events.push('main stopped');
          return { sessionId: 'main', pauseEpoch: 4 };
        },
        resumeTools: async () => {
          events.push('main permits fresh prompts');
        },
      },
    });
    const admission = control.assertCanPrompt();
    const pending = control.take('conversation', async () => {
      events.push('browser granted');
    });
    expect(() => control.assertCanPrompt()).toThrow();
    expect(events).toEqual([]);
    ready();
    const held = await pending;
    expect(events).toEqual(['main stopped', 'browser granted']);
    await expect(control.giveBack('foreign', held.epoch, async () => {})).rejects.toThrow('owner');
    await control.giveBack('conversation', held.epoch, async () => {
      events.push('fresh observation');
    });
    expect(events).toEqual(['main stopped', 'browser granted', 'fresh observation', 'main permits fresh prompts']);
    expect(() => control.assertCanPrompt(admission)).toThrow('predates');
    expect(control.assertCanPrompt()).toBe(held.epoch);
  });

  it('reacquires engine acknowledgements after a partial return before releasing the fence', async () => {
    const { control } = fixture();
    const pauses = { main: 0, child: 0 };
    let isFailure = true;
    for (const id of ['main', 'child'] as const) {
      control.register(id, {
        ready: async () => {},
        connection: {
          hasActiveSession: true,
          pauseTools: async () => ({ sessionId: id, pauseEpoch: ++pauses[id] }),
          resumeTools: async () => {
            if (id === 'child' && isFailure) throw new Error('Lost acknowledgement');
          },
        },
      });
    }
    const held = await control.take('conversation', async () => {});
    await expect(control.giveBack('conversation', held.epoch, async () => {})).rejects.toThrow('Lost acknowledgement');
    expect(() => control.assertCanPrompt()).toThrow();
    isFailure = false;
    await control.giveBack('conversation', held.epoch, async () => {});
    expect(pauses).toEqual({ main: 2, child: 2 });
    expect(control.status().state).toBe('ai');
  });

  it('retains human intent and ownership across a restart', async () => {
    const { filename, control } = fixture();
    const held = await control.take('conversation', async () => {});
    const restored = new LocalAgentToolControl(filename);
    expect(restored.status()).toMatchObject({ state: 'error', owner: 'conversation', epoch: held.epoch });
    expect(() => restored.assertCanPrompt()).toThrow();
    await expect(restored.take('other', async () => {})).rejects.toThrow();
    await expect(restored.giveBack('other', held.epoch, async () => {})).rejects.toThrow();
  });
});
