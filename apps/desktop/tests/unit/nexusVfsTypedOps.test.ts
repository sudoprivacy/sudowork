import { beforeEach, describe, expect, it, vi } from 'vitest';

const typed = {
  exists: vi.fn(),
  readdir: vi.fn(),
  mkdir: vi.fn(),
  delete: vi.fn(),
  stat: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  call: vi.fn(),
  callBinary: vi.fn(),
  serverInfo: vi.fn(),
};

vi.mock('@nexus-ai-fs/vfs-client', () => ({
  NexusVfsClient: class {
    exists = (...a: unknown[]) => typed.exists(...a);
    readdir = (...a: unknown[]) => typed.readdir(...a);
    mkdir = (...a: unknown[]) => typed.mkdir(...a);
    delete = (...a: unknown[]) => typed.delete(...a);
    stat = (...a: unknown[]) => typed.stat(...a);
    read = (...a: unknown[]) => typed.read(...a);
    write = (...a: unknown[]) => typed.write(...a);
    call = (...a: unknown[]) => typed.call(...a);
    callBinary = (...a: unknown[]) => typed.callBinary(...a);
    serverInfo = (...a: unknown[]) => typed.serverInfo(...a);
  },
}));

const { Nexus } = await import('@common/nexus/nexus-vfs-client');

/**
 * These file operations were hand-rolled over the generic Call surface, which
 * `nexusd-cluster` does not carry them on. Every call failed, and every failure
 * was swallowed into a benign-looking value — `false` from exists, `[]` from
 * list — so the safety poller reported "no events" for months while never
 * having been able to enumerate anything.
 *
 * What these pin is therefore not "the happy path works". It is that a failure
 * can no longer arrive disguised as an answer.
 */
describe('Nexus file ops go through typed RPCs', () => {
  let nexus: InstanceType<typeof Nexus>;
  beforeEach(() => {
    for (const fn of Object.values(typed)) fn.mockReset();
    nexus = new Nexus();
  });

  it('uses the typed RPC, not the generic Call surface', async () => {
    typed.exists.mockResolvedValue(true);
    typed.readdir.mockResolvedValue([]);
    typed.mkdir.mockResolvedValue(undefined);
    typed.delete.mockResolvedValue(undefined);

    await nexus.exists('/a');
    await nexus.list('/a');
    await nexus.mkdir('/a');
    await nexus.delete('/a');

    expect(typed.exists).toHaveBeenCalled();
    expect(typed.readdir).toHaveBeenCalled();
    expect(typed.mkdir).toHaveBeenCalled();
    expect(typed.delete).toHaveBeenCalled();
    // The generic surface must not be used for file operations at all.
    expect(typed.call).not.toHaveBeenCalled();
  });

  it('propagates a failed listing instead of returning an empty one', async () => {
    typed.readdir.mockRejectedValue(new Error('unknown Call method: readdir'));
    await expect(nexus.list('/safe/event')).rejects.toThrow(/readdir/);
  });

  it('propagates a failed existence check instead of returning false', async () => {
    typed.exists.mockRejectedValue(new Error('daemon unreachable'));
    await expect(nexus.exists('/safe/action/x')).rejects.toThrow(/exists/);
  });

  it('still reports a clean not-found as false', async () => {
    // The one case that must stay a boolean: the daemon answered, and said no.
    typed.exists.mockResolvedValue(false);
    await expect(nexus.exists('/nope')).resolves.toBe(false);
  });

  it('propagates a failed delete instead of reporting success-by-omission', async () => {
    typed.delete.mockRejectedValue(new Error('permission denied'));
    await expect(nexus.delete('/safe/event/x')).rejects.toThrow(/delete/);
  });

  it('maps directory entries onto the shape callers read', async () => {
    typed.readdir.mockResolvedValue([
      { name: '/safe/event/abc', entryType: 0 },
      { name: '/safe/event/sub', entryType: 1 },
    ]);
    const items = await nexus.list('/safe/event');
    // listEventFilenames() takes the basename off these; a full path in `name`
    // would silently produce filenames that match no event.
    expect(items.map((i) => i.name)).toEqual(['abc', 'sub']);
    expect(items.map((i) => i.isDirectory)).toEqual([false, true]);
  });
});
