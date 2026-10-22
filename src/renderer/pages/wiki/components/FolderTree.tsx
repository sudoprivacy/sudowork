/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Dropdown, Menu, Popconfirm, Progress, Tree, Typography } from '@arco-design/web-react';
import { Folder, MoreHorizontal } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DocumentTreeNode } from '../api/types';
import { formatSize } from '../utils/files';

interface ITreeItem {
  key: string;
  title: string;
  node: DocumentTreeNode;
  children: ITreeItem[];
}

/** Turn the flat node list into a nested tree rooted at `rootId`. */
export function buildFolderTree(nodes: DocumentTreeNode[], rootId: string): ITreeItem[] {
  const byParent = new Map<string | null, DocumentTreeNode[]>();
  for (const node of nodes) {
    const list = byParent.get(node.parentId) ?? [];
    list.push(node);
    byParent.set(node.parentId, list);
  }
  const toItem = (node: DocumentTreeNode): ITreeItem => ({
    key: node.id,
    title: node.name,
    node,
    children: (byParent.get(node.id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)).map(toItem),
  });
  const root = nodes.find((n) => n.id === rootId);
  return root ? [toItem(root)] : [];
}

/** Ids of `nodeId` and every folder below it (a folder can't move into its own subtree). */
export function collectSubtreeIds(nodes: DocumentTreeNode[], nodeId: string): Set<string> {
  const ids = new Set<string>([nodeId]);
  let isGrowing = true;
  while (isGrowing) {
    isGrowing = false;
    for (const n of nodes) {
      if (n.parentId && ids.has(n.parentId) && !ids.has(n.id)) {
        ids.add(n.id);
        isGrowing = true;
      }
    }
  }
  return ids;
}

export default function FolderTree({ nodes, rootId, selectedId, usageBytes, quotaBytes, onSelect, onCreateChild, onEdit, onDelete }: IFolderTreeProps) {
  const { t } = useTranslation();
  const [expandedKeys, setExpandedKeys] = useState<string[] | null>(null);
  const treeData = useMemo(() => buildFolderTree(nodes, rootId), [nodes, rootId]);
  const usagePercent = quotaBytes > 0 ? Math.min(100, Math.round((usageBytes / quotaBytes) * 100)) : 0;

  const renderActions = (node: DocumentTreeNode) => {
    const isRoot = node.id === rootId;
    return (
      <span className='inline-flex' onClick={(e) => e.stopPropagation()}>
        <Dropdown
          trigger='click'
          droplist={
            <Menu
              onClickMenuItem={(key) => {
                if (key === 'add') onCreateChild(node);
                if (key === 'edit') onEdit(node);
              }}
            >
              <Menu.Item key='add'>{t('wiki.tree.newFolder')}</Menu.Item>
              {!isRoot && <Menu.Item key='edit'>{t('wiki.tree.edit')}</Menu.Item>}
            </Menu>
          }
        >
          <MoreHorizontal size={14} className='cursor-pointer text-[var(--color-text-3)] hover:text-[var(--color-text-1)]' />
        </Dropdown>
        {!isRoot && (
          <Popconfirm title={t('wiki.tree.deleteConfirm', { name: node.name })} onOk={() => onDelete(node)}>
            <span className='ml-6px text-12px cursor-pointer text-[var(--color-text-3)] hover:text-[rgb(var(--danger-6))]'>{t('wiki.common.delete')}</span>
          </Popconfirm>
        )}
      </span>
    );
  };

  return (
    <div className='flex flex-col gap-12px h-full min-h-0'>
      <div className='flex-1 min-h-0 overflow-auto'>
        <Tree
          blockNode
          treeData={treeData}
          selectedKeys={selectedId ? [selectedId] : []}
          expandedKeys={expandedKeys ?? [rootId]}
          onExpand={(keys) => setExpandedKeys(keys)}
          onSelect={(keys) => keys[0] && onSelect(keys[0])}
          renderTitle={(props) => {
            const node = (props as unknown as { dataRef?: ITreeItem }).dataRef?.node;
            return (
              <span className='group flex items-center justify-between gap-6px w-full'>
                <span className='inline-flex items-center gap-6px truncate'>
                  <Folder size={14} />
                  <span className='truncate'>{node?.id === rootId ? t('wiki.tree.root') : props.title}</span>
                </span>
                {node && <span className='opacity-0 group-hover:opacity-100'>{renderActions(node)}</span>}
              </span>
            );
          }}
        />
      </div>
      <div>
        <Typography.Text type='secondary' className='text-12px'>
          {t('wiki.tree.quota', { used: formatSize(usageBytes), total: formatSize(quotaBytes) })}
        </Typography.Text>
        <Progress percent={usagePercent} size='small' status={usagePercent >= 90 ? 'warning' : 'normal'} showText={false} />
      </div>
    </div>
  );
}

interface IFolderTreeProps {
  nodes: DocumentTreeNode[];
  rootId: string;
  selectedId: string | null;
  usageBytes: number;
  quotaBytes: number;
  onSelect: (id: string) => void;
  onCreateChild: (parent: DocumentTreeNode) => void;
  onEdit: (node: DocumentTreeNode) => void;
  onDelete: (node: DocumentTreeNode) => void;
}
