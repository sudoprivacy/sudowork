/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Card, Empty, Message, Spin, Tabs, Typography } from '@arco-design/web-react';
import { Library, RefreshCw } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/renderer/context/AuthContext';
import type { DocumentRecord, DocumentTreeNode, OrgDirectory, PrivateTree, UsableWiki, WikiInput, WikiRecord } from './api/types';
import DocumentPanel from './components/DocumentPanel';
import FolderModal, { type IFolderModalValue } from './components/FolderModal';
import FolderTree from './components/FolderTree';
import MyWikiList from './components/MyWikiList';
import UsableWikiList from './components/UsableWikiList';
import WikiFormModal from './components/WikiFormModal';
import WikiViewerDrawer from './components/WikiViewerDrawer';
import { useBuildTracker } from './hooks/useBuildTracker';
import { useWikiApi } from './hooks/useWikiApi';
import { isUnsupportedServer, wikiErrorMessage } from './utils/errors';

const CARD_BODY_STYLE = { height: '100%', display: 'flex', flexDirection: 'column' as const, minHeight: 0 };

type TabKey = 'mine' | 'usable';

/** Enterprise wiki 知识库: the user's private space and private wikis, plus wikis they may use. */
export default function WikiPage() {
  const { t } = useTranslation();
  const api = useWikiApi();
  const { user } = useAuth();
  const ownerId = user?.id ?? '';

  const [activeTab, setActiveTab] = useState<TabKey>('mine');
  const [tree, setTree] = useState<PrivateTree | null>(null);
  const [isUnsupported, setIsUnsupported] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [allDocuments, setAllDocuments] = useState<DocumentRecord[]>([]);
  const [myWikis, setMyWikis] = useState<WikiRecord[]>([]);
  const [usableWikis, setUsableWikis] = useState<UsableWiki[]>([]);
  const [directory, setDirectory] = useState<OrgDirectory | null>(null);
  const [isLoadingTree, setIsLoadingTree] = useState(true);
  const [isLoadingDocs, setIsLoadingDocs] = useState(false);
  const [isLoadingWikis, setIsLoadingWikis] = useState(false);
  const [isLoadingUsable, setIsLoadingUsable] = useState(false);
  const [folderModal, setFolderModal] = useState<{ mode: 'create' | 'edit'; target: DocumentTreeNode } | null>(null);
  const [wikiModal, setWikiModal] = useState<{ wiki: WikiRecord | null } | null>(null);
  const [viewing, setViewing] = useState<{ id: string; name: string } | null>(null);

  const rootId = tree?.root_id ?? '';
  const selectedNode = tree?.nodes.find((n) => n.id === selectedNodeId) ?? null;

  const loadTree = useCallback(async () => {
    setIsLoadingTree(true);
    try {
      const next = await api.getMyTree();
      setTree(next);
      setIsUnsupported(false);
      setSelectedNodeId((prev) => (prev && next.nodes.some((n) => n.id === prev) ? prev : next.root_id));
    } catch (err) {
      if (isUnsupportedServer(err)) setIsUnsupported(true);
      else Message.error(wikiErrorMessage(t, err));
    } finally {
      setIsLoadingTree(false);
    }
  }, [api, t]);

  const loadDocuments = useCallback(async () => {
    if (!selectedNodeId) return;
    setIsLoadingDocs(true);
    try {
      setDocuments(await api.listDocuments(selectedNodeId));
    } catch (err) {
      Message.error(wikiErrorMessage(t, err));
    } finally {
      setIsLoadingDocs(false);
    }
  }, [api, selectedNodeId, t]);

  const loadMyWikis = useCallback(async () => {
    setIsLoadingWikis(true);
    try {
      setMyWikis(await api.listMyWikis());
    } catch (err) {
      if (!isUnsupportedServer(err)) Message.error(wikiErrorMessage(t, err));
    } finally {
      setIsLoadingWikis(false);
    }
  }, [api, t]);

  const loadUsable = useCallback(async () => {
    setIsLoadingUsable(true);
    try {
      setUsableWikis(await api.listUsableWikis());
    } catch (err) {
      if (!isUnsupportedServer(err)) Message.error(wikiErrorMessage(t, err));
    } finally {
      setIsLoadingUsable(false);
    }
  }, [api, t]);

  const refreshAll = useCallback(() => {
    void loadTree();
    void loadMyWikis();
    void loadUsable();
  }, [loadTree, loadMyWikis, loadUsable]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const buildingIds = useMemo(() => myWikis.filter((w) => w.buildStatus === 'running' || w.buildStatus === 'pending').map((w) => w.id), [myWikis]);
  const buildStatuses = useBuildTracker(api, buildingIds, () => {
    void loadMyWikis();
    void loadUsable();
  });

  const onDocumentsChanged = () => {
    void loadDocuments();
    void loadTree();
    void loadMyWikis(); // uploads mark dir-mode wikis as needing a rebuild
  };

  const onFolderSubmit = async (value: IFolderModalValue) => {
    if (!folderModal) return;
    try {
      if (folderModal.mode === 'create') {
        const created = await api.createNode({ parent_id: folderModal.target.id, name: value.name, description: value.description || undefined });
        setSelectedNodeId(created.id);
      } else {
        await api.updateNode(folderModal.target.id, {
          name: value.name,
          description: value.description || null,
          ...(value.parentId && value.parentId !== folderModal.target.parentId ? { parent_id: value.parentId } : {}),
        });
      }
      setFolderModal(null);
      await loadTree();
    } catch (err) {
      Message.error(wikiErrorMessage(t, err));
      throw err;
    }
  };

  const onDeleteFolder = async (node: DocumentTreeNode) => {
    try {
      await api.deleteNode(node.id);
      if (selectedNodeId === node.id) setSelectedNodeId(node.parentId ?? rootId);
      onDocumentsChanged();
    } catch (err) {
      Message.error(wikiErrorMessage(t, err));
    }
  };

  const openWikiModal = async (wiki: WikiRecord | null) => {
    setWikiModal({ wiki });
    // The "files" source mode picks from every document in the private space.
    const [docs, dir] = await Promise.all([rootId ? api.listDocuments(rootId, true).catch(() => [] as DocumentRecord[]) : Promise.resolve([] as DocumentRecord[]), directory ? Promise.resolve(directory) : api.getDirectory().catch((): OrgDirectory | null => null)]);
    setAllDocuments(docs);
    setDirectory(dir);
  };

  const onWikiSubmit = async (input: WikiInput, isBuildNow: boolean) => {
    try {
      if (wikiModal?.wiki) {
        await api.updateWiki(wikiModal.wiki.id, input);
        Message.success(t('wiki.form.saved'));
      } else {
        await api.createWiki({ ...input, build: isBuildNow });
        Message.success(isBuildNow ? t('wiki.myWikis.buildStarted') : t('wiki.form.saved'));
      }
      setWikiModal(null);
      void loadMyWikis();
      void loadUsable();
    } catch (err) {
      Message.error(wikiErrorMessage(t, err));
      throw err;
    }
  };

  const renderMine = () => {
    if (isUnsupported) return <Empty className='mt-60px' description={t('wiki.unsupported')} />;
    if (!tree) return <Spin loading={isLoadingTree} className='w-full mt-60px' />;
    return (
      <div className='grid h-full min-h-0 grid-cols-[300px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-4 max-lg:grid-cols-1 max-lg:grid-rows-[300px_minmax(0,1fr)]'>
        <Card className='min-h-0 overflow-hidden' bordered bodyStyle={CARD_BODY_STYLE}>
          <FolderTree
            nodes={tree.nodes}
            rootId={rootId}
            selectedId={selectedNodeId}
            usageBytes={tree.usage_bytes}
            quotaBytes={tree.quota_bytes}
            onSelect={setSelectedNodeId}
            onCreateChild={(target) => setFolderModal({ mode: 'create', target })}
            onEdit={(target) => setFolderModal({ mode: 'edit', target })}
            onDelete={(node) => void onDeleteFolder(node)}
          />
        </Card>
        <div className='flex min-h-0 flex-col gap-4 overflow-auto'>
          <Card bordered>{selectedNode && <DocumentPanel api={api} nodeId={selectedNode.id} nodeName={selectedNode.id === rootId ? t('wiki.tree.root') : selectedNode.name} documents={documents} isLoading={isLoadingDocs} remainingBytes={tree.quota_bytes - tree.usage_bytes} onChanged={onDocumentsChanged} />}</Card>
          <Card bordered>
            <MyWikiList api={api} wikis={myWikis} isLoading={isLoadingWikis} buildStatuses={buildStatuses} onCreate={() => void openWikiModal(null)} onEdit={(wiki) => void openWikiModal(wiki)} onView={(wiki) => setViewing({ id: wiki.id, name: wiki.name })} onChanged={() => void loadMyWikis()} />
          </Card>
        </div>
      </div>
    );
  };

  return (
    <div className='flex h-full min-h-0 flex-col overflow-hidden bg-color-bg-1 p-4'>
      <div className='mb-2 flex flex-shrink-0 flex-wrap items-center justify-between gap-3'>
        <div className='min-w-0'>
          <Typography.Title heading={4} className='mb-1! flex items-center gap-2'>
            <Library size={20} />
            {t('wiki.title')}
          </Typography.Title>
          <Typography.Text className='block max-w-[760px]' type='secondary'>
            {t('wiki.description')}
          </Typography.Text>
        </div>
        <Button className='flex-shrink-0' icon={<RefreshCw size={16} />} onClick={refreshAll}>
          {t('wiki.common.refresh')}
        </Button>
      </div>
      <Tabs activeTab={activeTab} onChange={(key) => setActiveTab(key as TabKey)} className='flex min-h-0 flex-1 flex-col [&_.arco-tabs-content]:min-h-0 [&_.arco-tabs-content]:flex-1 [&_.arco-tabs-content-inner]:h-full [&_.arco-tabs-pane]:h-full'>
        <Tabs.TabPane key='mine' title={t('wiki.tabs.mine')}>
          {renderMine()}
        </Tabs.TabPane>
        <Tabs.TabPane key='usable' title={t('wiki.tabs.usable')}>
          <div className='h-full overflow-auto'>{isUnsupported ? <Empty className='mt-60px' description={t('wiki.unsupported')} /> : <UsableWikiList wikis={usableWikis} isLoading={isLoadingUsable} onView={(wiki) => setViewing({ id: wiki.id, name: wiki.name })} />}</div>
        </Tabs.TabPane>
      </Tabs>

      {tree && <FolderModal mode={folderModal?.mode ?? 'create'} nodes={tree.nodes} rootId={rootId} target={folderModal?.target ?? null} onCancel={() => setFolderModal(null)} onSubmit={onFolderSubmit} />}
      {tree && <WikiFormModal isVisible={!!wikiModal} wiki={wikiModal?.wiki ?? null} nodes={tree.nodes} rootId={rootId} documents={allDocuments} directory={directory} ownerId={ownerId} onCancel={() => setWikiModal(null)} onSubmit={onWikiSubmit} />}
      <WikiViewerDrawer api={api} wiki={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}
