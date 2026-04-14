/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { NEXUS_FILES_MARKER } from '@/common/constants';
import { appendNexusFilesMarker } from '@/common/nexusFiles';

const CHANNEL_WORKSPACE = '/Users/test/.nexus/sudowork/channel-media/wechat';

describe('appendNexusFilesMarker', () => {
  it('returns input unchanged when files list is empty', () => {
    expect(appendNexusFilesMarker('hello', [], CHANNEL_WORKSPACE)).toBe('hello');
  });

  it('rewrites absolute unix paths to workspace/fileName', () => {
    const result = appendNexusFilesMarker('[photo message]', ['/tmp/channel-media/wechat/wechat_123.jpg'], CHANNEL_WORKSPACE);
    expect(result).toContain(NEXUS_FILES_MARKER);
    expect(result).toContain(`${CHANNEL_WORKSPACE}/wechat_123.jpg`);
    // Preserves the leading text
    expect(result.startsWith('[photo message]\n\n')).toBe(true);
  });

  it('rewrites absolute Windows paths to workspace/fileName', () => {
    const result = appendNexusFilesMarker('[photo message]', ['C:\\Users\\bot\\channel-media\\wechat\\img.png'], CHANNEL_WORKSPACE);
    expect(result).toContain(`${CHANNEL_WORKSPACE}/img.png`);
  });

  it('joins relative paths under the workspace', () => {
    const result = appendNexusFilesMarker('text', ['subdir/file.txt'], CHANNEL_WORKSPACE);
    expect(result).toContain(`${CHANNEL_WORKSPACE}/subdir/file.txt`);
  });

  it('uses paths as-is when workspacePath is empty', () => {
    const result = appendNexusFilesMarker('text', ['/tmp/file.txt'], '');
    expect(result).toBe(`text\n\n${NEXUS_FILES_MARKER}\n/tmp/file.txt`);
  });

  it('joins multiple files on separate lines', () => {
    const result = appendNexusFilesMarker('text', ['/a/b/one.jpg', '/c/d/two.png'], CHANNEL_WORKSPACE);
    const afterMarker = result.split(NEXUS_FILES_MARKER)[1].trim();
    expect(afterMarker.split('\n')).toEqual([`${CHANNEL_WORKSPACE}/one.jpg`, `${CHANNEL_WORKSPACE}/two.png`]);
  });

  it('produces a message that MessageText.parseFileMarker can split back into text + files', () => {
    const result = appendNexusFilesMarker('[photo message]', ['/tmp/channel-media/wechat/img.jpg'], CHANNEL_WORKSPACE);
    const markerIndex = result.indexOf(NEXUS_FILES_MARKER);
    const text = result.slice(0, markerIndex).trimEnd();
    const files = result
      .slice(markerIndex + NEXUS_FILES_MARKER.length)
      .trim()
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(text).toBe('[photo message]');
    expect(files).toEqual([`${CHANNEL_WORKSPACE}/img.jpg`]);
  });
});
