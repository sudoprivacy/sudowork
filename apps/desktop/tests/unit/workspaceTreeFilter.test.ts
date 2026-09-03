import { describe, expect, it } from 'vitest';

import type { IDirOrFile } from '@sudowork/host-bridge/ipcBridge';

const { filterHiddenWorkspaceDirs } = await import('@/renderer/pages/conversation/workspace/hooks/useWorkspaceTree');
const { ensureDraftsDirectoryNode, updateTreeNodeChildren } = await import('@/renderer/pages/conversation/workspace/utils/treeHelpers');

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
  it('hides root .claude directory for claude acp workspaces only', () => {
    const result = filterHiddenWorkspaceDirs([dir('.claude'), dir('docs')], {
      eventPrefix: 'acp',
      backend: 'claude',
      isRoot: true,
    });

    expect(result.map((node: IDirOrFile) => node.name)).toEqual(['docs']);
  });

  it('does not apply local backend skill-root hiding to remote-agent workspaces', () => {
    const result = filterHiddenWorkspaceDirs([root([dir('skills'), dir('.claude'), dir('.nexus'), dir('docs')])], {
      eventPrefix: 'remote-agent',
      backend: 'remote-agent',
      isRoot: true,
    });

    expect(result[0]?.children?.map((node) => node.name)).toEqual(['skills', '.claude', '.nexus', 'docs']);
  });
});

describe('updateTreeNodeChildren', () => {
  it('updates nested directory children without mutating the original tree', () => {
    const originalChild = dir('reports');
    originalChild.relativePath = 'drafts/reports';
    originalChild.fullPath = '/tmp/workspace/drafts/reports';

    const drafts = dir('.drafts', [originalChild]);
    const tree = [root([drafts])];
    const generated = dir('summary.md');
    generated.relativePath = 'drafts/reports/summary.md';
    generated.fullPath = '/tmp/workspace/drafts/reports/summary.md';
    generated.isDir = false;
    generated.isFile = true;

    const updated = updateTreeNodeChildren(tree, 'drafts/reports', [generated]);

    expect(tree[0]?.children?.[0]?.children?.[0]?.children).toBeUndefined();
    expect(updated[0]?.children?.[0]?.children?.[0]?.children).toEqual([generated]);
  });
});

describe('ensureDraftsDirectoryNode', () => {
  it('adds a virtual drafts directory to an empty synthetic root', () => {
    const tree = [root([])];

    const updated = ensureDraftsDirectoryNode(tree);

    expect(tree[0]?.children).toEqual([]);
    expect(updated[0]?.children?.map((node) => node.name)).toEqual(['.drafts']);
    expect(updated[0]?.children?.[0]).toMatchObject({
      name: '.drafts',
      relativePath: '.drafts',
      isDir: true,
      isFile: false,
      children: [],
    });
  });

  it('does not duplicate an existing drafts directory', () => {
    const tree = [root([dir('.drafts'), dir('docs')])];

    const updated = ensureDraftsDirectoryNode(tree);

    expect(updated).toBe(tree);
    expect(updated[0]?.children?.map((node) => node.name)).toEqual(['.drafts', 'docs']);
  });
});
