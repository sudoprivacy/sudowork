import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, it, vi } from 'vitest';
import { OntologyStudioDatabase } from '@process/services/ontology/OntologyStudioDatabase';

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }));
vi.mock('@process/utils', () => ({
  getDataPath: () => {
    throw new Error('Use an isolated explicit fixture directory');
  },
}));

const native = !!process.versions.electron;

it.skipIf(native)(
  'runs the durable review inbox against the shipped Electron SQLite driver',
  async () => {
    const require = createRequire(import.meta.url);
    const electron = require('electron') as string;
    const cli = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
    const { stdout } = await promisify(execFile)(electron, [cli, 'run', 'tests/unit/ontologyReviewInbox.native.test.ts', '--maxWorkers=1'], {
      cwd: path.resolve(__dirname, '../..'),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
      timeout: 90000,
    });
    expect(stdout).toContain('passed');
  },
  95000
);

it.skipIf(!native)('persists and deduplicates each event/destination across a real database reopen', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'sudograph-review-inbox-'));
  expect(path.dirname(folder)).toBe(path.resolve(os.tmpdir()));
  let database = new OntologyStudioDatabase(folder);
  try {
    database.registerSudographProject({ id: 'project', title: 'Project', modelRef: 'model' });
    const subscription = { id: 'binding', workspaceId: 'project', conversationId: 'conversation', account: 'owner', shareId: 'share' };
    database.subscribeReview(subscription);
    const item = { id: 'destination-event', subscription, event: { id: 'event', share_id: 'share', comment_id: 'comment', parent_id: null, event_type: 'comment.created', actor_role: 'owner' }, messageId: 'message' };
    database.acceptReviewEvents([item, item]);
    expect(database.reviewInbox('owner')).toHaveLength(1);
    expect(database.claimReviewDelivery(item.id)).toBe(true);
    const independent = new OntologyStudioDatabase(folder);
    try {
      expect(independent.claimReviewDelivery(item.id)).toBe(false);
      expect(() => independent.claimReviewDelivery('unknown-item')).toThrow('unavailable');
    } finally {
      independent.close();
    }
    database.close();
    database = new OntologyStudioDatabase(folder);
    expect(database.claimReviewDelivery(item.id)).toBe(false);
    expect(database.reviewInbox('owner')[0]).toMatchObject({ id: item.id, status: 'pending', messageId: 'message' });
    database.acceptReviewEvents([item]);
    expect(database.reviewInbox('owner')).toHaveLength(1);
    const screenshotEvent = { ...item, id: 'screenshot-event', event: { ...item.event, id: 'event-screenshot', event_type: 'comment.updated' } };
    database.acceptReviewEvents([screenshotEvent]);
    expect(database.claimReviewInput(item.id, 'same-human-text')).toBe(true);
    expect(database.claimReviewInput(screenshotEvent.id, 'same-human-text')).toBe(false);
    expect(database.reviewInbox('owner')).toHaveLength(1);
    expect(database.reviewInbox('another-account')).toEqual([]);
    expect(() => database.subscribeReview({ ...subscription, workspaceId: 'other-project' })).toThrow('cannot be rebound');
    database.finishReviewEvent(item.id, 'delivered');
    expect(database.reviewInbox('owner')).toEqual([]);
    expect(database.reviewDeliverySummary('owner', 'project', 'conversation')).toEqual({ delivered: 1, ignored: 1 });
    expect(() => database.setHostSecret('test', 'must-not-be-written')).toThrow('OS secret storage');
    expect(database.getHostValue('secret:test')).toBeNull();
  } finally {
    database.close();
    // The test framework owns this exact directory; keep Windows deletion bounded.
    if (path.dirname(folder) === path.resolve(os.tmpdir()) && path.basename(folder).startsWith('sudograph-review-inbox-')) await fs.rm(folder, { recursive: true, force: true });
  }
});
