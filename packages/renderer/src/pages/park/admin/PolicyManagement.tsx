import { Button, Card, Input, Message, Select, Table, Typography } from '@arco-design/web-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invokePark, useParkQuery } from '@renderer/hooks/usePark';

interface INode {
  id: string;
  name: string;
  autoManaged: boolean;
}
interface IDocument {
  id: string;
  fileName: string;
  sizeBytes: number;
}
interface IWiki {
  id: string;
  name: string;
  sourceMode: 'files' | 'dir';
  sourceDocumentIds: string[];
  buildStatus: string;
}
interface IBuildStatus {
  wiki_build_status: string;
  last_build_error: string | null;
  latest_job: { status: string } | null;
}

async function policyCall(method: string, args: Record<string, unknown>): Promise<unknown> {
  const result = await invokePark<unknown>(method, args);
  if (result && typeof result === 'object' && ('error' in result || '__error' in result)) {
    throw new Error(JSON.stringify(result));
  }
  return result;
}

function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(file);
  });
}

const BUILD_STATES = ['queued', 'pending', 'running', 'succeeded', 'failed', 'cancelled'] as const;

export default function PolicyManagement({ parkOrgId }: IPolicyManagementProps) {
  const { t } = useTranslation();
  const [nodeId, setNodeId] = useState('');
  const [wikiId, setWikiId] = useState('');
  const [nodeName, setNodeName] = useState('');
  const [wikiName, setWikiName] = useState('');
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const tree = useParkQuery<{ nodes: INode[] }>('policyTree', { parkOrgId });
  const docs = useParkQuery<{ documents: IDocument[] }>(nodeId ? 'policyDocuments' : null, { parkOrgId, nodeId });
  const wikis = useParkQuery<{ wikis: IWiki[] }>('policyWikis', { parkOrgId });
  const status = useParkQuery<IBuildStatus>(wikiId ? 'policyBuildStatus' : null, { parkOrgId, wikiId });
  const selectedWiki = wikis.data?.wikis.find((wiki) => wiki.id === wikiId);
  const rawBuildState = status.data?.latest_job?.status ?? status.data?.wiki_build_status ?? selectedWiki?.buildStatus;
  const buildState = BUILD_STATES.find((value) => value === rawBuildState) ?? 'unknown';

  useEffect(() => {
    setSourceIds(selectedWiki?.sourceDocumentIds ?? []);
  }, [wikiId, wikis.data]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      Message.success(t('park.admin.policies.saved'));
    } catch (error) {
      Message.error(error instanceof Error ? error.message : t('park.leads.updateFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={t('park.admin.policies.title')}>
      <div className='space-y-4'>
        <Typography.Paragraph>{t('park.admin.policies.uploadNote')}</Typography.Paragraph>
        <div className='flex gap-2'>
          <Select value={nodeId || undefined} placeholder={t('park.admin.policies.node')} onChange={(value) => setNodeId(String(value))} style={{ width: 260 }}>
            {(tree.data?.nodes ?? [])
              .filter((node) => !node.autoManaged)
              .map((node) => (
                <Select.Option key={node.id} value={node.id}>
                  {node.name}
                </Select.Option>
              ))}
          </Select>
          <Input value={nodeName} onChange={setNodeName} placeholder={t('park.admin.policies.newNode')} style={{ width: 220 }} />
          <Button
            disabled={!nodeName.trim() || busy}
            onClick={() =>
              void run(async () => {
                const created = (await policyCall('createPolicyNode', { parkOrgId, name: nodeName.trim() })) as INode;
                setNodeId(created.id);
                setNodeName('');
                tree.reload();
              })
            }
          >
            {t('park.common.create')}
          </Button>
        </div>
        <div className='flex gap-2 items-center'>
          <input
            type='file'
            aria-label={t('park.admin.policies.file')}
            disabled={!nodeId || busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              event.target.value = '';
              void run(async () => {
                if (file.size > 50 * 1024 * 1024) throw new Error(t('park.admin.policies.fileTooLarge'));
                await policyCall('uploadPolicyDocument', { parkOrgId, nodeId, fileName: file.name, mimeType: file.type || 'application/octet-stream', contentBase64: await fileBase64(file) });
                docs.reload();
              });
            }}
          />
        </div>
        <Table
          rowKey='id'
          pagination={false}
          data={docs.data?.documents ?? []}
          columns={[
            { title: t('park.admin.policies.file'), dataIndex: 'fileName' },
            {
              title: t('park.common.actions'),
              render: (_: unknown, doc: IDocument) => (
                <Button
                  status='danger'
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await policyCall('deletePolicyDocument', { parkOrgId, documentId: doc.id });
                      setSourceIds((ids) => ids.filter((id) => id !== doc.id));
                      docs.reload();
                    })
                  }
                >
                  {t('park.admin.policies.deleteOld')}
                </Button>
              ),
            },
          ]}
        />
        <div className='flex gap-2'>
          <Select value={wikiId || undefined} placeholder={t('park.admin.policies.wiki')} onChange={(value) => setWikiId(String(value))} style={{ width: 260 }}>
            {(wikis.data?.wikis ?? []).map((wiki) => (
              <Select.Option key={wiki.id} value={wiki.id}>
                {wiki.name}
              </Select.Option>
            ))}
          </Select>
          <Input value={wikiName} onChange={setWikiName} placeholder={t('park.admin.policies.newWiki')} style={{ width: 220 }} />
          <Button
            disabled={!wikiName.trim() || sourceIds.length === 0 || busy}
            onClick={() =>
              void run(async () => {
                const created = (await policyCall('createPolicyWiki', { parkOrgId, name: wikiName.trim(), sourceDocumentIds: sourceIds })) as IWiki;
                setWikiId(created.id);
                setWikiName('');
                wikis.reload();
              })
            }
          >
            {t('park.common.create')}
          </Button>
        </div>
        {(!selectedWiki || selectedWiki.sourceMode === 'files') && (
          <Select mode='multiple' value={sourceIds} placeholder={t('park.admin.policies.sources')} onChange={(value) => setSourceIds(value as string[])} style={{ width: '100%' }}>
            {(docs.data?.documents ?? []).map((doc) => (
              <Select.Option key={doc.id} value={doc.id}>
                {doc.fileName}
              </Select.Option>
            ))}
          </Select>
        )}
        <div className='flex gap-2 items-center'>
          <Button
            type='primary'
            disabled={!wikiId || busy || (selectedWiki?.sourceMode === 'files' && sourceIds.length === 0)}
            onClick={() =>
              void run(async () => {
                if (selectedWiki?.sourceMode === 'files') await policyCall('updatePolicyWiki', { parkOrgId, wikiId, sourceDocumentIds: sourceIds });
                await policyCall('buildPolicyWiki', { parkOrgId, wikiId });
                status.reload();
                wikis.reload();
              })
            }
          >
            {t('park.admin.policies.rebuild')}
          </Button>
          <Button disabled={!wikiId} onClick={status.reload}>
            {t('park.common.retry')}
          </Button>
          {wikiId && (
            <Typography.Text>
              {t('park.admin.policies.buildStatus')}: {t(`park.admin.policies.buildStates.${buildState}`)}
            </Typography.Text>
          )}
        </div>
        {status.data?.last_build_error && <Typography.Text type='error'>{status.data.last_build_error}</Typography.Text>}
      </div>
    </Card>
  );
}

interface IPolicyManagementProps {
  parkOrgId: string;
}
