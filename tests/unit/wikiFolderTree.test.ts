import { describe, expect, it } from 'vitest';
import { buildFolderTree, collectSubtreeIds, folderAncestorIds } from '@/renderer/pages/wiki/components/FolderTree';
import type { DocumentTreeNode } from '@/renderer/pages/wiki/api/types';

const node = (id: string, parentId: string | null, name = id, sortOrder = 0): DocumentTreeNode => ({ id, parentId, name, orgId: 'o', description: null, sortOrder, createdAt: 0, updatedAt: 0 });
const nodes = [node('root', null, '私有'), node('a', 'root', 'A', 1), node('b', 'root', 'B', 0), node('a1', 'a'), node('a1x', 'a1')];

describe('wiki folder tree helpers', () => {
  it('nests nodes under the root ordered by sortOrder', () => {
    const [root] = buildFolderTree(nodes, 'root');
    expect(root.children.map((c) => c.key)).toEqual(['b', 'a']);
    expect(root.children[1].children[0].children[0].key).toBe('a1x');
  });

  it('lists ancestors nearest first, so a new subfolder can be revealed', () => {
    expect(folderAncestorIds(nodes, 'a1x')).toEqual(['a1', 'a', 'root']);
    expect(folderAncestorIds(nodes, 'root')).toEqual([]);
    expect(folderAncestorIds(nodes, null)).toEqual([]);
    expect(folderAncestorIds(nodes, 'missing')).toEqual([]);
  });

  it('collects a folder and everything below it', () => {
    expect([...collectSubtreeIds(nodes, 'a')].sort()).toEqual(['a', 'a1', 'a1x']);
  });
});
