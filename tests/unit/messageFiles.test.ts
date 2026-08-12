import { describe, expect, it } from 'vitest';
import { buildDisplayMessage } from '@/renderer/utils/messageFiles';

const WORKSPACE = '/Users/test/.nexus/sudoclaw/workspace/proj-123';

describe('buildDisplayMessage', () => {
  it('preserves _nexus_ timestamp suffix in pasted file names', () => {
    // This is the core bug fix: paste-uploaded files have _nexus_<timestamp> suffix.
    // buildDisplayMessage must preserve the full filename so it matches the actual
    // file path created by copyFilesToDirectory.
    const result = buildDisplayMessage('analyze this image', ['C:\\Users\\test\\.nexus\\config\\temp\\image_nexus_1775876155151.png'], WORKSPACE);
    expect(result).toContain(`${WORKSPACE}/image_nexus_1775876155151.png`);
    // Must NOT contain the stripped version
    expect(result).not.toContain(`${WORKSPACE}/image.png`);
  });

  it('handles file-picker uploads without _nexus_ suffix', () => {
    const result = buildDisplayMessage('analyze this', ['C:\\Users\\test\\Pictures\\a4ac618e1abdfa9f0a0f9cce37c97746.jpeg'], WORKSPACE);
    expect(result).toContain(`${WORKSPACE}/a4ac618e1abdfa9f0a0f9cce37c97746.jpeg`);
  });

  it('handles relative file paths by joining with workspace', () => {
    const result = buildDisplayMessage('see attached', ['docs/spec.md'], WORKSPACE);
    expect(result).toContain(`${WORKSPACE}/docs/spec.md`);
  });

  it('returns original input when no workspace is provided', () => {
    const result = buildDisplayMessage('no workspace', ['/tmp/file.txt'], '');
    expect(result).toBe('no workspace\n\n[[NEXUS_FILES]]\n/tmp/file.txt');
  });

  it('returns input unchanged when files list is empty', () => {
    const result = buildDisplayMessage('just text', [], WORKSPACE);
    expect(result).toBe('just text');
  });

  it('handles multiple files including both paste and picker uploads', () => {
    const result = buildDisplayMessage('analyze both', ['C:\\Users\\test\\.nexus\\config\\temp\\screenshot_nexus_1775876200000.png', 'C:\\Users\\test\\Downloads\\photo.jpeg'], WORKSPACE);
    expect(result).toContain(`${WORKSPACE}/screenshot_nexus_1775876200000.png`);
    expect(result).toContain(`${WORKSPACE}/photo.jpeg`);
  });
});
