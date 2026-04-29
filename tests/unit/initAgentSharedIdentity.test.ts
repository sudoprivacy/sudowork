import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';

/**
 * Tests for shared identity/soul/memory symlink logic in initAgent.
 *
 * These tests validate the core symlink behavior that enables persona
 * memory sharing across OpenClaw sessions (issue #520).
 */

// Mirror the constant from initAgent.ts
const SHARED_IDENTITY_ENTRIES = ['IDENTITY.md', 'SOUL.md', 'memory'];

/**
 * Re-implement the symlink logic here for isolated unit testing.
 * This avoids importing the real initAgent module which has heavy
 * Electron/process dependencies that don't work in a test environment.
 */
async function symlinkSharedIdentityFiles(sessionWorkspace: string, parentWorkspace: string): Promise<void> {
  for (const name of SHARED_IDENTITY_ENTRIES) {
    const source = path.join(parentWorkspace, name);
    const target = path.join(sessionWorkspace, name);

    try {
      const sourceStat = await fs.stat(source).catch(() => null);
      if (!sourceStat) continue;

      const targetExists = await fs.lstat(target).catch(() => null);
      if (targetExists) continue;

      if (sourceStat.isDirectory()) {
        await fs.symlink(source, target, process.platform === 'win32' ? 'junction' : 'dir');
      } else {
        await fs.symlink(source, target, 'file');
      }
    } catch {
      // Silently skip failures in test
    }
  }
}

describe('Shared Identity Symlink', () => {
  let tmpDir: string;
  let parentWorkspace: string;
  let sessionWorkspace: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sudowork-test-'));
    parentWorkspace = path.join(tmpDir, 'workspace');
    sessionWorkspace = path.join(parentWorkspace, 'sudoclaw-temp-12345');
    await fs.mkdir(parentWorkspace, { recursive: true });
    await fs.mkdir(sessionWorkspace, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('symlinks IDENTITY.md from parent to session workspace', async () => {
    const identityContent = '# IDENTITY.md\n\n- **Name:**\n  TestBot\n';
    await fs.writeFile(path.join(parentWorkspace, 'IDENTITY.md'), identityContent);

    await symlinkSharedIdentityFiles(sessionWorkspace, parentWorkspace);

    const target = path.join(sessionWorkspace, 'IDENTITY.md');
    const stat = await fs.lstat(target);
    expect(stat.isSymbolicLink()).toBe(true);

    const content = await fs.readFile(target, 'utf-8');
    expect(content).toBe(identityContent);
  });

  test('symlinks SOUL.md from parent to session workspace', async () => {
    const soulContent = '# Soul Memory\n\nI am a helpful assistant.\n';
    await fs.writeFile(path.join(parentWorkspace, 'SOUL.md'), soulContent);

    await symlinkSharedIdentityFiles(sessionWorkspace, parentWorkspace);

    const target = path.join(sessionWorkspace, 'SOUL.md');
    const stat = await fs.lstat(target);
    expect(stat.isSymbolicLink()).toBe(true);

    const content = await fs.readFile(target, 'utf-8');
    expect(content).toBe(soulContent);
  });

  test('symlinks memory directory from parent to session workspace', async () => {
    const memoryDir = path.join(parentWorkspace, 'memory');
    await fs.mkdir(memoryDir, { recursive: true });
    await fs.writeFile(path.join(memoryDir, 'note.md'), 'user prefers dark mode');

    await symlinkSharedIdentityFiles(sessionWorkspace, parentWorkspace);

    const target = path.join(sessionWorkspace, 'memory');
    const stat = await fs.lstat(target);
    expect(stat.isSymbolicLink()).toBe(true);

    const content = await fs.readFile(path.join(target, 'note.md'), 'utf-8');
    expect(content).toBe('user prefers dark mode');
  });

  test('skips entries that do not exist in parent workspace', async () => {
    // Parent workspace has no identity files
    await symlinkSharedIdentityFiles(sessionWorkspace, parentWorkspace);

    for (const name of SHARED_IDENTITY_ENTRIES) {
      const target = path.join(sessionWorkspace, name);
      expect(fsSync.existsSync(target)).toBe(false);
    }
  });

  test('does not overwrite existing files in session workspace', async () => {
    const parentContent = 'parent identity';
    const sessionContent = 'session identity';

    await fs.writeFile(path.join(parentWorkspace, 'IDENTITY.md'), parentContent);
    await fs.writeFile(path.join(sessionWorkspace, 'IDENTITY.md'), sessionContent);

    await symlinkSharedIdentityFiles(sessionWorkspace, parentWorkspace);

    // Session file should remain unchanged (not replaced by symlink)
    const target = path.join(sessionWorkspace, 'IDENTITY.md');
    const stat = await fs.lstat(target);
    expect(stat.isSymbolicLink()).toBe(false);

    const content = await fs.readFile(target, 'utf-8');
    expect(content).toBe(sessionContent);
  });

  test('changes to symlinked file persist to parent workspace', async () => {
    const originalContent = '# Soul Memory\n\nOriginal.\n';
    await fs.writeFile(path.join(parentWorkspace, 'SOUL.md'), originalContent);

    await symlinkSharedIdentityFiles(sessionWorkspace, parentWorkspace);

    // Agent writes through the symlink
    const updatedContent = '# Soul Memory\n\nUpdated by agent.\n';
    await fs.writeFile(path.join(sessionWorkspace, 'SOUL.md'), updatedContent);

    // Parent workspace should reflect the change
    const parentContent = await fs.readFile(path.join(parentWorkspace, 'SOUL.md'), 'utf-8');
    expect(parentContent).toBe(updatedContent);
  });

  test('symlinks all available entries simultaneously', async () => {
    await fs.writeFile(path.join(parentWorkspace, 'IDENTITY.md'), 'identity');
    await fs.writeFile(path.join(parentWorkspace, 'SOUL.md'), 'soul');
    await fs.mkdir(path.join(parentWorkspace, 'memory'), { recursive: true });

    await symlinkSharedIdentityFiles(sessionWorkspace, parentWorkspace);

    for (const name of SHARED_IDENTITY_ENTRIES) {
      const target = path.join(sessionWorkspace, name);
      const stat = await fs.lstat(target);
      expect(stat.isSymbolicLink()).toBe(true);
    }
  });

  test('partially available entries are symlinked (only existing ones)', async () => {
    // Only SOUL.md exists in parent
    await fs.writeFile(path.join(parentWorkspace, 'SOUL.md'), 'soul');

    await symlinkSharedIdentityFiles(sessionWorkspace, parentWorkspace);

    expect(fsSync.existsSync(path.join(sessionWorkspace, 'IDENTITY.md'))).toBe(false);
    expect((await fs.lstat(path.join(sessionWorkspace, 'SOUL.md'))).isSymbolicLink()).toBe(true);
    expect(fsSync.existsSync(path.join(sessionWorkspace, 'memory'))).toBe(false);
  });
});
