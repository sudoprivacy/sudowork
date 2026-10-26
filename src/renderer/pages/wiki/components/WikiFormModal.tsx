/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Checkbox, Form, Input, Message, Modal, Radio, Select, Switch, TreeSelect } from '@arco-design/web-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DocumentRecord, DocumentTreeNode, OrgDirectory, WikiInput, WikiRecord } from '../api/types';
import { visibilityFrom, visibleToFrom, type IVisibilityValue } from '../utils/visibility';
import { filterOptionByText } from '../utils/files';
import { buildFolderTree } from './FolderTree';
import VisibilityPicker from './VisibilityPicker';

interface IFormValues {
  name: string;
  description?: string;
  sourceMode: 'dir' | 'files';
  sourceNodeIds?: string[];
  excludeNodeIds?: string[];
  documentIds?: string[];
  isAutoRebuild?: boolean;
  isBuildNow?: boolean;
}

/** Create or edit a private wiki: sources, auto-rebuild and who may use it. */
export default function WikiFormModal({ isVisible, wiki, nodes, rootId, documents, directory, ownerId, onCancel, onSubmit }: IWikiFormModalProps) {
  const { t } = useTranslation();
  const [form] = Form.useForm<IFormValues>();
  const [sourceMode, setSourceMode] = useState<'dir' | 'files'>('dir');
  const [visibility, setVisibility] = useState<IVisibilityValue>({ mode: 'self', departmentIds: [], userIds: [] });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isVisible) return;
    const mode = wiki?.sourceMode ?? 'dir';
    setSourceMode(mode);
    setVisibility(wiki ? visibilityFrom(wiki.visibleTo, wiki.ownerId ?? ownerId) : { mode: 'self', departmentIds: [], userIds: [] });
    form.setFieldsValue({
      name: wiki?.name ?? '',
      description: wiki?.description ?? '',
      sourceMode: mode,
      sourceNodeIds: wiki ? (wiki.sourceNodeIds?.length ? wiki.sourceNodeIds : wiki.sourceNodeId ? [wiki.sourceNodeId] : []) : [rootId],
      excludeNodeIds: wiki?.sourceExcludeNodeIds ?? [],
      documentIds: wiki?.sourceDocumentIds ?? [],
      isAutoRebuild: wiki?.autoRebuild ?? true,
      isBuildNow: true,
    });
  }, [isVisible, wiki, form, rootId, ownerId]);

  const folderOptions = useMemo(() => {
    const strip = (items: ReturnType<typeof buildFolderTree>): Array<{ key: string; title: string; children: unknown[] }> => items.map((item) => ({ key: item.key, title: item.key === rootId ? t('wiki.tree.root') : item.title, children: strip(item.children) }));
    return strip(buildFolderTree(nodes, rootId));
  }, [nodes, rootId, t]);

  const onOk = async () => {
    const values = await form.validate();
    if (values.sourceMode === 'dir' && !values.sourceNodeIds?.length) {
      Message.warning(t('wiki.form.pickFolders'));
      return;
    }
    if (values.sourceMode === 'files' && !values.documentIds?.length) {
      Message.warning(t('wiki.form.pickDocuments'));
      return;
    }
    const input: WikiInput = {
      name: values.name.trim(),
      description: values.description?.trim() || null,
      source_mode: values.sourceMode,
      source_node_ids: values.sourceMode === 'dir' ? values.sourceNodeIds : [],
      source_exclude_node_ids: values.sourceMode === 'dir' ? (values.excludeNodeIds ?? []) : [],
      source_document_ids: values.sourceMode === 'files' ? values.documentIds : [],
      auto_rebuild: values.sourceMode === 'dir' ? !!values.isAutoRebuild : false,
      visible_to: visibleToFrom(visibility, wiki?.ownerId ?? ownerId),
    };
    setIsSubmitting(true);
    try {
      await onSubmit(input, !wiki && !!values.isBuildNow);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal title={wiki ? t('wiki.form.editTitle') : t('wiki.form.createTitle')} visible={isVisible} onCancel={onCancel} onOk={onOk} confirmLoading={isSubmitting} style={{ width: 640 }} unmountOnExit>
      <Form form={form} layout='vertical'>
        <Form.Item field='name' label={t('wiki.form.name')} rules={[{ required: true, message: t('wiki.form.nameRequired') }]}>
          <Input maxLength={200} />
        </Form.Item>
        <Form.Item field='description' label={t('wiki.common.description')} extra={t('wiki.form.descriptionHint')}>
          <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} maxLength={1000} />
        </Form.Item>
        <Form.Item field='sourceMode' label={t('wiki.form.source')}>
          <Radio.Group type='button' onChange={(v: 'dir' | 'files') => setSourceMode(v)}>
            <Radio value='dir'>{t('wiki.form.sourceDir')}</Radio>
            <Radio value='files'>{t('wiki.form.sourceFiles')}</Radio>
          </Radio.Group>
        </Form.Item>
        {sourceMode === 'dir' ? (
          <>
            <Form.Item field='sourceNodeIds' label={t('wiki.form.folders')}>
              <TreeSelect treeData={folderOptions} multiple allowClear />
            </Form.Item>
            <Form.Item field='excludeNodeIds' label={t('wiki.form.excludeFolders')}>
              <TreeSelect treeData={folderOptions} multiple allowClear />
            </Form.Item>
            <Form.Item field='isAutoRebuild' label={t('wiki.form.autoRebuild')} triggerPropName='checked' extra={t('wiki.form.autoRebuildHint')}>
              <Switch />
            </Form.Item>
          </>
        ) : (
          <Form.Item field='documentIds' label={t('wiki.form.documents')}>
            <Select mode='multiple' allowClear showSearch filterOption={filterOptionByText}>
              {documents.map((doc) => (
                <Select.Option key={doc.id} value={doc.id}>
                  {doc.fileName}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        )}
        <Form.Item label={t('wiki.form.visibility')}>
          <VisibilityPicker value={visibility} directory={directory} ownerId={wiki?.ownerId ?? ownerId} onChange={setVisibility} />
        </Form.Item>
        {!wiki && (
          <Form.Item field='isBuildNow' triggerPropName='checked'>
            <Checkbox>{t('wiki.form.buildNow')}</Checkbox>
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}

interface IWikiFormModalProps {
  isVisible: boolean;
  /** The wiki being edited; null creates a new one. */
  wiki: WikiRecord | null;
  nodes: DocumentTreeNode[];
  rootId: string;
  /** Every document in the private space, for the "files" source mode. */
  documents: DocumentRecord[];
  directory: OrgDirectory | null;
  ownerId: string;
  onCancel: () => void;
  onSubmit: (input: WikiInput, isBuildNow: boolean) => Promise<void>;
}
