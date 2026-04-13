import { describe, expect, it } from 'vitest';

import type { IDirOrFile } from '@/common/ipcBridge';

const { filterHiddenWorkspaceDirs } = await import('@/renderer/pages/conversation/workspace/hooks/useWorkspaceTree');

function dir(name: string, children?: IDirOrFile[]): IDirOrFile {
  return {
    name,
    fullPath: `/tmp/workspace/${name}`,
    relativePath: name,
    isDir: true,
    isFile: false,
    children,
  } as IDirOrFile;
}

function root(children?: IDirOrFile[]): IDirOrFile {
  return {
    name: 'workspace',
    fullPath: '/tmp/workspace',
    relativePath: '',
    isDir: true,
    isFile: false,
    children,
  } as IDirOrFile;
}

describe('filterHiddenWorkspaceDirs', () => {
  it('hides root skills directory for openclaw workspaces only', () => {
    const result = filterHiddenWorkspaceDirs([dir('skills'), dir('src')], {
      eventPrefix: 'openclaw-gateway',
      isRoot: true,
    });

    expect(result.map((node: IDirOrFile) => node.name)).toEqual(['src']);
  });

  it('hides root .claude directory for claude acp workspaces only', () => {
    const result = filterHiddenWorkspaceDirs([dir('.claude'), dir('docs')], {
      eventPrefix: 'acp',
      backend: 'claude',
      isRoot: true,
    });

    expect(result.map((node: IDirOrFile) => node.name)).toEqual(['docs']);
  });

  it('does not hide nested directories with the same names', () => {
    const result = filterHiddenWorkspaceDirs([dir('src', [dir('skills'), dir('.claude')]), dir('skills')], {
      eventPrefix: 'openclaw-gateway',
      isRoot: true,
    });

    expect(result.map((node: IDirOrFile) => node.name)).toEqual(['src']);
    expect(result[0]?.children?.map((node) => node.name)).toEqual(['skills', '.claude']);
  });

  it('hides root children under the synthetic workspace root node', () => {
    const result = filterHiddenWorkspaceDirs([root([dir('skills'), dir('docs')])], {
      eventPrefix: 'openclaw-gateway',
      isRoot: true,
    });

    expect(result[0]?.children?.map((node) => node.name)).toEqual(['docs']);
  });
});
