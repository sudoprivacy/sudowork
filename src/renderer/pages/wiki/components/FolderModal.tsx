/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form, Input, Modal, TreeSelect } from '@arco-design/web-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DocumentTreeNode } from '../api/types';
import { buildFolderTree, collectSubtreeIds } from './FolderTree';

export interface IFolderModalValue {
  name: string;
  description: string;
  parentId: string;
}

/** Create a folder, or rename / move / describe an existing one. */
export default function FolderModal({ mode, nodes, rootId, target, onCancel, onSubmit }: IFolderModalProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<IFolderModalValue>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!target) return;
    form.setFieldsValue(mode === 'create' ? { name: '', description: '', parentId: target.id } : { name: target.name, description: target.description ?? '', parentId: target.parentId ?? rootId });
  }, [form, mode, target, rootId]);

  // When moving, a folder can't go under itself or its own descendants.
  const parentOptions = useMemo(() => {
    const blocked = mode === 'edit' && target ? collectSubtreeIds(nodes, target.id) : new Set<string>();
    const allowed = nodes.filter((n) => !blocked.has(n.id));
    const strip = (items: ReturnType<typeof buildFolderTree>): Array<{ key: string; title: string; children: unknown[] }> =>
      items.map((item) => ({
        key: item.key,
        title: item.key === rootId ? t('wiki.tree.root') : item.title,
        children: strip(item.children),
      }));
    return strip(buildFolderTree(allowed, rootId));
  }, [mode, nodes, rootId, target, t]);

  const onOk = async () => {
    const values = await form.validate();
    setIsSubmitting(true);
    try {
      await onSubmit({ ...values, name: values.name.trim(), description: (values.description ?? '').trim() });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal title={mode === 'create' ? t('wiki.tree.newFolder') : t('wiki.tree.edit')} visible={!!target} onCancel={onCancel} onOk={onOk} confirmLoading={isSubmitting} unmountOnExit>
      <Form form={form} layout='vertical'>
        <Form.Item field='name' label={t('wiki.tree.name')} rules={[{ required: true, message: t('wiki.tree.nameRequired') }]}>
          <Input maxLength={200} />
        </Form.Item>
        <Form.Item field='description' label={t('wiki.common.description')}>
          <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} maxLength={1000} />
        </Form.Item>
        {mode === 'edit' && (
          <Form.Item field='parentId' label={t('wiki.tree.parent')}>
            <TreeSelect treeData={parentOptions} />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}

interface IFolderModalProps {
  mode: 'create' | 'edit';
  nodes: DocumentTreeNode[];
  rootId: string;
  /** Parent (create) or folder being edited; null hides the modal. */
  target: DocumentTreeNode | null;
  onCancel: () => void;
  onSubmit: (value: IFolderModalValue) => Promise<void>;
}
