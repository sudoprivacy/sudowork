import { getRendererSessionMode } from '@renderer/pages/guid/hooks/useGuidAgentSelection';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Message, Modal, Select, Space, Spin, Tabs, Tag, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { mossCatalog } from '@sudowork/host-bridge/ipcBridge';
import type { IMossCatalogInstallation, IMossCatalogItem, MossCatalogKind, MossCatalogSource } from '@sudowork/common/mossCatalog';
import { Bot, Zap, ArrowUpRight, Search, RefreshCw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { COS_HUB_BASE } from '@sudowork/common/cos';
import styles from './MossCatalogBrowser.module.css';
import { useAuth } from '@renderer/context/AuthContext';
import { useAgentEntry } from '@renderer/pages/conversation/hooks/useAgentEntry';

const itemKey = (item: { source: string; id: string }) => `${item.source}:${item.id}`;

function expertTypeLabel(value?: string) {
  switch ((value || '').toLowerCase()) {
    case 'local': return '本地服务';
    case 'dify': return 'Dify';
    case 'a2a': return 'A2A';
    case 'custom_http':
    case 'api': return '外部 API';
    case 'static':
    case 'file': return '静态描述文件';
    case 'moss_runtime':
    case 'runtime': return '运行时专家';
    case 'hub': return '平台专家';
    default: return value || '组织专家';
  }
}

export default function MossCatalogBrowser({ kind, customContent, builtinContent, publishedContent, hostedContent, onCreate, onInstalled }: IMossCatalogBrowserProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { onOpenAgent } = useAgentEntry();
  const { user } = useAuth();
  // The client has two user-facing views: a consumption view and the
  // account-owned workspace. Organization publication remains a Moss concern.
  const [tab, setTab] = useState<'available' | 'mine'>('available');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [items, setItems] = useState<IMossCatalogItem[]>([]);
  const [installed, setInstalled] = useState<IMossCatalogInstallation[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [isCached, setIsCached] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<IMossCatalogItem | null>(null);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isLocalDetail, setIsLocalDetail] = useState(false);
  const [detailError, setDetailError] = useState('');
  const detailRequestId = useRef(0);
  const requestId = useRef(0);
  const identity = `${user?.id || ''}:${user?.enterprise_code || ''}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const installedMap = new Map(installed.filter((item) => item.kind === kind).map((item) => [itemKey(item), item]));

  const onRefreshInstalled = useCallback(async () => {
    const token = identity;
    const result = await mossCatalog.installed.invoke();
    if (identityRef.current !== token) return;
    if (result.success && result.data) setInstalled(result.data);
    else throw new Error(result.msg || t('settings.mossCatalog.failed'));
  }, [identity, t]);

  const onLoad = useCallback(
    async (next?: string) => {
      if (tab === 'mine') return;
      const id = ++requestId.current;
      const token = identity;
      setIsLoading(true);
      setError('');
      try {
        const sources = next ? (['hub'] as const) : (['hub', 'tenant'] as const);
        const results = await Promise.all(sources.map((source) => mossCatalog.list.invoke({ kind, source, query, category, cursor: source === 'hub' ? next : undefined })));
        if (id !== requestId.current || identityRef.current !== token) return;
        const failed = results.find((result) => !result.success || !result.data);
        if (failed && !failed.data) throw new Error(failed.msg || t('settings.mossCatalog.failed'));
        const pages = results.flatMap((result) => (result.success && result.data ? [result.data] : []));
        const pageItems = pages.flatMap((page) => page.items);
        setItems((previous) => {
          const merged = next ? [...previous, ...pageItems] : pageItems;
          return merged.filter((item, index) => merged.findIndex((candidate) => itemKey(candidate) === itemKey(item)) === index && !(item.source === 'hub' && merged.some((candidate) => candidate.source === 'tenant' && candidate.replacesId === item.id)));
        });
        setCategories([...new Set(pages.flatMap((page) => page.categories))].sort());
        setIsCached(pages.some((page) => page.isCached === true));
        setCursor(pages.find((page) => page.nextCursor)?.nextCursor || null);
      } catch (cause) {
        if (id === requestId.current && identityRef.current === token) setError(String(cause instanceof Error ? cause.message : cause));
      } finally {
        if (id === requestId.current) setIsLoading(false);
      }
    },
    [tab, identity, kind, query, category, t]
  );

  useEffect(() => {
    setItems([]);
    setCursor(null);
    const timer = setTimeout(() => {
      void onLoad();
    }, 200);
    return () => {
      clearTimeout(timer);
      requestId.current++;
    };
  }, [onLoad]);

  useEffect(() => {
    setInstalled([]);
    setDetail(null);
    setBusy(null);
    const refresh = () => {
      void onRefreshInstalled().catch((cause) => setError(String(cause)));
    };
    refresh();
    return mossCatalog.changed.on(refresh);
  }, [onRefreshInstalled]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      void onLoad();
      window.dispatchEvent(new Event('expert-library-refresh'));
    };
    const unsubscribe = mossCatalog.changed.on(refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      unsubscribe();
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [onLoad]);

  const onPrepare = async (item: { id: string; source: MossCatalogSource }, isUse: boolean, isUpdate = false) => {
    const token = identity;
    setBusy(itemKey(item));
    try {
      if (isUse && getRendererSessionMode() === 'remote') {
        setDetail(null);
        if (kind === 'agents') await onOpenAgent(item.id);
        else void navigate(`/guid?skill=${encodeURIComponent(item.id)}`);
        return;
      }
      const available = items.find((candidate) => itemKey(candidate) === itemKey(item));
      const current = installedMap.get(itemKey(item));
      const result = await mossCatalog.install.invoke({ kind, id: item.id, source: item.source, isUpdate: isUpdate || (!!current && current.version !== available?.version) });
      if (identityRef.current !== token) return;
      if (!result.success || !result.data) throw new Error(result.msg || t('settings.mossCatalog.failed'));
      await onRefreshInstalled();
      await onInstalled();
      if (identityRef.current !== token) return;
      if (isUse) {
        setDetail(null);
        if (kind === 'agents') await onOpenAgent(result.data.id);
        else void navigate(`/guid?skill=${encodeURIComponent(result.data.runtimeName)}`);
      } else Message.success(t('settings.mossCatalog.downloaded'));
    } catch (cause) {
      if (identityRef.current === token) Message.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (identityRef.current === token) setBusy(null);
    }
  };

  const onDetail = async (item: IMossCatalogItem | IMossCatalogInstallation, isLocal = false) => {
    const token = identity;
    const id = ++detailRequestId.current;
    setDetail({ ...item, categories: 'categories' in item ? item.categories : [], isAvailable: 'isAvailable' in item ? item.isAvailable : item.isEnabled });
    setIsLocalDetail(isLocal);
    setDetailError('');
    setIsDetailLoading(true);
    try {
      const result = await mossCatalog.detail.invoke({ kind, source: item.source, id: item.id, isLocal });
      if (identityRef.current !== token || id !== detailRequestId.current) return;
      if (!result.success || !result.data) throw new Error(result.msg || t('settings.mossCatalog.failed'));
      setDetail(result.data);
    } catch (cause) {
      if (identityRef.current === token && id === detailRequestId.current) setDetailError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (identityRef.current === token && id === detailRequestId.current) setIsDetailLoading(false);
    }
  };

  const label = (key: string) => t(`settings.mossCatalog.${key}`);
  const onCloseDetail = () => {
    detailRequestId.current++;
    setDetail(null);
  };

  return (
    <div className='flex flex-col flex-1 min-h-0 gap-3'>
      <Tabs
        activeTab={tab}
        onChange={(value) => {
          setTab(value as typeof tab);
          setCategory('');
          setError('');
        }}
      >
        <Tabs.TabPane key='available' title={kind === 'agents' ? '可用专家' : '可用技能'} />
        <Tabs.TabPane key='mine' title={kind === 'agents' ? '我的专家' : '我的技能'} />
      </Tabs>
      <Typography.Paragraph className='text-xs text-secondary'>
        {tab === 'available'
          ? `可用${kind === 'agents' ? '专家' : '技能'}展示当前账号有权限使用的已发布版本；“我的”展示当前账号创建或导入的本地工作稿。同一资产可能同时出现，分别用于使用和继续编辑。`
          : `“我的”仅展示当前账号创建或导入的本地${kind === 'agents' ? '专家' : '技能'}，可继续编辑、调试、上传或导出。`}
      </Typography.Paragraph>
      <div className={styles.toolbar}>
        <Input value={query} onChange={setQuery} placeholder={label('search')} prefix={<Search size={16} />} allowClear className={styles.search} />
        {tab === 'available' && (
          <Select value={category} onChange={setCategory} style={{ width: 180 }} options={[{ value: '', label: label('allCategories') }, ...categories.map((value) => ({ value, label: value }))]} />
        )}
        <Button
          icon={<RefreshCw size={14} />}
          onClick={() => {
            window.dispatchEvent(new Event('expert-library-refresh'));
            void onLoad();
            void onRefreshInstalled().catch((cause) => setError(String(cause)));
          }}
        >
          {label('refresh')}
        </Button>
        {tab === 'mine' && <Button onClick={onCreate}>{label('create')}</Button>}
      </div>
      {isCached && tab !== 'mine' && <Alert type='warning' content={label('cached')} />}
      {error && <Alert type='error' content={error} />}
      <div className='flex-1 min-h-0 overflow-auto pb-4'>
        {tab === 'mine' ? (
          <>
            {builtinContent && <div className='mt-4'>{builtinContent}</div>}
            <div className='mt-4'>{customContent}</div>
          </>
        ) : (
          <>
            <div className={styles.grid}>
              {!category && publishedContent?.(query)}
              {!category && kind === 'agents' && hostedContent?.(query)}
              {items.map((item) => {
                const local = installedMap.get(itemKey(item));
                const isUpdateAvailable = !!local && !!item.version && local.version !== item.version;
                return (
                  <article className={styles.card} key={itemKey(item)}>
                    <div className={styles.cardHeading}>
                      <CatalogIcon key={item.icon || item.emoji || item.id} item={item} />
                      <div className='min-w-0 flex-1'>
                        <Button
                          type='text'
                          className={styles.title}
                          onClick={() => {
                            void onDetail(item);
                          }}
                        >
                          {item.displayName}
                        </Button>
                        {kind === 'agents' && <Tag color='arcoblue'>{expertTypeLabel(item.expertType)}</Tag>}
                        <span className={styles.source}>{label(`source.${item.source}`)}</span>
                      </div>
                    </div>
                    <p className={styles.description}>{item.description || label('noDescription')}</p>
                    <div className={styles.tags}>
                      {item.displayVersion && <Tag>{label('version')}: {item.displayVersion}</Tag>}
                      {item.categories.slice(0, 2).map((value) => (
                        <Tag key={value}>{value}</Tag>
                      ))}
                      {isUpdateAvailable && <Tag color='orange'>{label('updateAvailable')}</Tag>}
                      {!item.isAvailable && <Tag>{label(item.status === 'pending' ? 'pending' : item.status === 'rejected' ? 'rejected' : 'unavailable')}</Tag>}
                      {item.isLocalAllowed === false && <Tag>{label('cloudOnly')}</Tag>}
                    </div>
                    <div className={styles.actions}>
                      <Button
                        type='text'
                        icon={<ArrowUpRight size={14} />}
                        onClick={() => {
                          void onDetail(item);
                        }}
                      >
                        {label('details')}
                      </Button>
                      <span className='flex-1' />
                      <Button
                        type='primary'
                        disabled={!item.isAvailable || busy !== null || local?.isEnabled === false}
                        onClick={() => {
                          void onPrepare(item, true);
                        }}
                      >
                        {label('use')}
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
            {isLoading && (
              <div className='flex justify-center p-5'>
                <Spin />
              </div>
            )}
            {!isLoading && !items.length && !error && !publishedContent && !hostedContent && <Typography.Paragraph>{label('empty')}</Typography.Paragraph>}
            {cursor && (
              <Button
                disabled={isLoading}
                onClick={() => {
                  void onLoad(cursor);
                }}
              >
                {label('loadMore')}
              </Button>
            )}
          </>
        )}
      </div>
      <Modal title={label('details')} visible={!!detail} onCancel={onCloseDetail} footer={null} style={{ width: 760, maxWidth: 'calc(100vw - 48px)' }}>
        {detail && (
          <>
            <div className={styles.detailHeader}>
              <CatalogIcon key={detail.icon || detail.emoji || detail.id} item={detail} />
              <div className='min-w-0'>
                <h2 className={styles.detailTitle}>{detail.displayName}</h2>
                <Space wrap>
                  <Tag>{label(`source.${detail.source}`)}</Tag>
                  {kind === 'agents' && <Tag color='arcoblue'>{expertTypeLabel(detail.expertType)}</Tag>}
                  {detail.displayVersion && (
                    <span className={styles.source}>
                      {label('version')}: {detail.displayVersion}
                    </span>
                  )}
                </Space>
              </div>
            </div>
            {isLocalDetail && <Alert type='info' content={label('localDetails')} className='mb-3' />}
            <div className={styles.detailBody}>
              <p>{detail.description || label('noDescription')}</p>
              <Space wrap>
                {detail.categories.map((value) => (
                  <Tag key={value}>{value}</Tag>
                ))}
                {!detail.isAvailable && <Tag>{label('unavailable')}</Tag>}
                {detail.isLocalAllowed === false && <Tag>{label('cloudOnly')}</Tag>}
              </Space>
              {detailError && <Alert type='error' content={detailError} />}
              {!!detail.scenarios?.length && (
                <>
                  <h3 className={styles.instructionsHeading}>{label('scenarios')}</h3>
                  <ul>
                    {detail.scenarios.map((scenario) => (
                      <li key={scenario}>{scenario}</li>
                    ))}
                  </ul>
                </>
              )}
              {!!detail.features?.length && (
                <>
                  <h3 className={styles.instructionsHeading}>{label('features')}</h3>
                  <div className={styles.features}>
                    {detail.features.map((feature) => (
                      <div className={styles.feature} key={feature.title}>
                        <strong>{feature.title}</strong>
                        {feature.description && <p>{feature.description}</p>}
                      </div>
                    ))}
                  </div>
                </>
              )}
              {isDetailLoading ? (
                <div className='p-5 f-center'>
                  <Spin />
                </div>
              ) : detail.content ? (
                <>
                  <h3 className={styles.instructionsHeading}>{label(kind === 'agents' ? 'agentInstructions' : 'skillInstructions')}</h3>
                  <div className={styles.markdown}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{detail.content}</ReactMarkdown>
                  </div>
                </>
              ) : (
                !detailError && !detail.features?.length && !detail.scenarios?.length && <p className={styles.source}>{label('noInstructions')}</p>
              )}
            </div>
            <div className={styles.detailActions}>
              <Button
                type='primary'
                disabled={!detail.isAvailable || busy !== null}
                loading={busy === itemKey(detail)}
                onClick={() => {
                  void onPrepare(detail, true);
                }}
              >
                {label('use')}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

function CatalogIcon({ item }: ICatalogIconProps) {
  const [isImageFailed, setIsImageFailed] = useState(false);
  const raw = item.icon || '';
  const icon = /^(https?:|data:image\/)/.test(raw) ? raw : item.source === 'hub' && raw && !raw.startsWith('/') ? `${COS_HUB_BASE}/${raw}` : '';
  return (
    <div className={styles.icon}>
      {icon && !isImageFailed ? (
        <img src={icon} alt={item.displayName} onError={() => setIsImageFailed(true)} />
      ) : item.emoji ? (
        <span role='img' aria-label={item.displayName}>
          {item.emoji}
        </span>
      ) : item.kind === 'agents' ? (
        <Bot size={25} aria-label={item.displayName} />
      ) : (
        <Zap size={25} aria-label={item.displayName} />
      )}
    </div>
  );
}

interface ICatalogIconProps {
  item: Pick<IMossCatalogItem, 'id' | 'kind' | 'source' | 'displayName' | 'icon' | 'emoji'>;
}

interface IMossCatalogBrowserProps {
  kind: MossCatalogKind;
  customContent: React.ReactNode;
  builtinContent?: React.ReactNode;
  publishedContent?: (query: string) => React.ReactNode;
  hostedContent?: (query: string) => React.ReactNode;
  onCreate: () => void;
  onInstalled: () => Promise<void>;
}
