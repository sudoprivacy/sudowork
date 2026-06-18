import nodePath from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGeneratedFileEntries, resolveFinalFileDisplayPath } from '@/process/task/generatedFileEntries';
import type { TrackedTurnFile } from '@/process/task/draftsCleanup';

const workspace = nodePath.resolve('/workspace');

const tracked = (overrides: Partial<TrackedTurnFile> = {}): TrackedTurnFile => ({
  actualPath: nodePath.join(workspace, 'report.pdf'),
  path: nodePath.join(workspace, 'report.pdf'),
  requestedPath: 'report.pdf',
  intent: 'final',
  reason: 'final',
  source: 'bash-generated',
  kind: 'create',
  ...overrides,
});

describe('resolveFinalFileDisplayPath', () => {
  it('prefers the archived absolute override over the tracked actualPath', () => {
    const file = tracked({ actualPath: nodePath.join(workspace, '.drafts', 'report.pdf') });
    const archived = nodePath.join(workspace, 'report.pdf');
    expect(resolveFinalFileDisplayPath(file, workspace, archived)).toBe('report.pdf');
  });

  it('falls back to the requested path when the actual path escapes the workspace', () => {
    const file = tracked({ actualPath: '/elsewhere/report.pdf', requestedPath: 'report.pdf' });
    expect(resolveFinalFileDisplayPath(file, workspace)).toBe('report.pdf');
  });

  it('never returns a .drafts-prefixed display path', () => {
    const file = tracked({ actualPath: nodePath.join(workspace, '.drafts', 'slide.png'), requestedPath: '.drafts/slide.png' });
    expect(resolveFinalFileDisplayPath(file, workspace)).toBe('slide.png');
  });
});

describe('buildGeneratedFileEntries', () => {
  it('uses the post-archive path from archivedPaths instead of the pre-archive actualPath', () => {
    const preArchive = nodePath.join(workspace, '.drafts', 'report.pdf');
    const postArchive = nodePath.join(workspace, 'report.pdf');
    const trackedFiles = new Map<string, TrackedTurnFile>([['report.pdf', tracked({ actualPath: preArchive, path: preArchive })]]);
    const archivedPaths = new Map<string, string>([['report.pdf', postArchive]]);

    const entries = buildGeneratedFileEntries({ workspaceRoot: workspace, trackedFiles, archivedPaths, now: 42 });

    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe(nodePath.resolve(postArchive));
    expect(entries[0].relativePath).toBe('report.pdf');
    expect(entries[0].createdAt).toBe(42);
  });

  it('reflects a collision-renamed final path from archivedPaths', () => {
    const preArchive = nodePath.join(workspace, '.drafts', 'report.pdf');
    const renamed = nodePath.join(workspace, 'report_1700000000000.pdf');
    const trackedFiles = new Map<string, TrackedTurnFile>([['report.pdf', tracked({ actualPath: preArchive, path: preArchive })]]);
    const archivedPaths = new Map<string, string>([['report.pdf', renamed]]);

    const entries = buildGeneratedFileEntries({ workspaceRoot: workspace, trackedFiles, archivedPaths });

    expect(entries[0].path).toBe(nodePath.resolve(renamed));
    expect(entries[0].relativePath).toBe('report_1700000000000.pdf');
  });

  it('falls back to actualPath when a tracking key has no archived override', () => {
    const actual = nodePath.join(workspace, 'summary.md');
    const trackedFiles = new Map<string, TrackedTurnFile>([['summary.md', tracked({ actualPath: actual, path: actual, requestedPath: 'summary.md' })]]);

    const entries = buildGeneratedFileEntries({ workspaceRoot: workspace, trackedFiles });

    expect(entries[0].path).toBe(nodePath.resolve(actual));
    expect(entries[0].relativePath).toBe('summary.md');
  });

  it('includes a turn-end fallback-discovered root file once it is tracked as final', () => {
    const discovered = nodePath.join(workspace, 'chart.png');
    const trackedFiles = new Map<string, TrackedTurnFile>([
      [
        'chart.png',
        tracked({
          actualPath: discovered,
          path: discovered,
          requestedPath: 'chart.png',
          intent: 'final',
          reason: 'Root-level turn-end deliverable file',
          kind: 'create',
        }),
      ],
    ]);

    const entries = buildGeneratedFileEntries({ workspaceRoot: workspace, trackedFiles });

    expect(entries).toHaveLength(1);
    expect(entries[0].relativePath).toBe('chart.png');
    expect(entries[0].kind).toBe('create');
  });

  it('omits non-final (draft) files from the marker', () => {
    const trackedFiles = new Map<string, TrackedTurnFile>([
      ['helper.py', tracked({ actualPath: nodePath.join(workspace, 'helper.py'), intent: 'draft' })],
      ['report.pdf', tracked()],
    ]);

    const entries = buildGeneratedFileEntries({ workspaceRoot: workspace, trackedFiles });

    expect(entries.map((e) => e.relativePath)).toEqual(['report.pdf']);
  });

  it('dedupes entries that resolve to the same absolute path', () => {
    const shared = nodePath.join(workspace, 'report.pdf');
    const trackedFiles = new Map<string, TrackedTurnFile>([
      ['a', tracked({ actualPath: shared, path: shared })],
      ['b', tracked({ actualPath: shared, path: shared })],
    ]);

    const entries = buildGeneratedFileEntries({ workspaceRoot: workspace, trackedFiles });

    expect(entries).toHaveLength(1);
  });
});
