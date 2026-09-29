import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Input, Message, Modal, Select, Space, Spin, Switch, Tabs, Tag, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { mossCatalog } from '@sudowork/host-bridge/ipcBridge';
import type { IMossCatalogInstallation, IMossCatalogItem, MossCatalogKind, MossCatalogSource } from '@sudowork/common/mossCatalog';
import { Bot, Zap, Download, ArrowUpRight, Search, RefreshCw, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { COS_HUB_BASE } from '@sudowork/common/cos';
import styles from './MossCatalogBrowser.module.css';
import { useAuth } from '@renderer/context/AuthContext';

const itemKey = (item: { source: string; id: string }) => `${item.source}:${item.id}`;

export default function MossCatalogBrowser({ kind, customContent, builtinContent, onCreate, onInstalled }: IMossCatalogBrowserProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tab, setTab] = useState<'hub' | 'tenant' | 'installed'>('hub');
  const [source, setSource] = useState('all');
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
      if (tab === 'installed') return;
      const id = ++requestId.current;
      const token = identity;
      setIsLoading(true);
      setError('');
      try {
        const result = await mossCatalog.list.invoke({ kind, source: tab, query, category, cursor: next });
        if (id !== requestId.current || identityRef.current !== token) return;
        if (!result.success || !result.data) throw new Error(result.msg || t('settings.mossCatalog.failed'));
        const page = result.data;
        setItems((previous) => (next ? [...previous, ...page.items.filter((item) => !previous.some((existing) => itemKey(existing) === itemKey(item)))] : page.items));
        setCategories(page.categories);
        setIsCached(page.isCached === true);
        setCursor(page.nextCursor);
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

  const onPrepare = async (item: { id: string; source: MossCatalogSource }, isUse: boolean, isUpdate = false) => {
    const token = identity;
    setBusy(itemKey(item));
    try {
      const result = await mossCatalog.install.invoke({ kind, id: item.id, source: item.source, isUpdate });
      if (identityRef.current !== token) return;
      if (!result.success || !result.data) throw new Error(result.msg || t('settings.mossCatalog.failed'));
      await onRefreshInstalled();
      await onInstalled();
      if (identityRef.current !== token) return;
      if (isUse) {
        setDetail(null);
        void navigate(`/guid?${kind === 'agents' ? 'assistant' : 'skill'}=${encodeURIComponent(kind === 'agents' ? result.data.id : result.data.runtimeName)}`);
      } else Message.success(t('settings.mossCatalog.downloaded'));
    } catch (cause) {
      if (identityRef.current === token) Message.error(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (identityRef.current === token) setBusy(null);
    }
  };

  const onChangeInstallation = async (item: IMossCatalogInstallation, isEnabled?: boolean) => {
    const token = identity;
    setBusy(itemKey(item));
    try {
      const input = { kind, source: item.source, id: item.id };
      const result = isEnabled === undefined ? await mossCatalog.remove.invoke(input) : await mossCatalog.setEnabled.invoke({ ...input, isEnabled });
      if (identityRef.current !== token) return;
      if (!result.success) throw new Error(result.msg || t('settings.mossCatalog.failed'));
      await onRefreshInstalled();
      await onInstalled();
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
  const localItems = installed.filter((item) => item.kind === kind && (source === 'all' || item.source === source) && `${item.displayName} ${item.description}`.toLowerCase().includes(query.toLowerCase()));

  const onCloseDetail = () => {
    detailRequestId.current++;
    setDetail(null);
  };
  const detailLocal = detail ? installedMap.get(itemKey(detail)) : undefined;
  const isDetailUpdate = !!detailLocal && !!detail?.version && detailLocal.version !== detail.version && !isLocalDetail;

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
        <Tabs.TabPane key='hub' title={label(kind === 'agents' ? 'agentLibrary' : 'skillLibrary')} />
        <Tabs.TabPane key='tenant' title={label(kind === 'agents' ? 'exclusiveAgents' : 'exclusiveSkills')} />
        <Tabs.TabPane key='installed' title={label(kind === 'agents' ? 'myAgents' : 'mySkills')} />
      </Tabs>
      <div className={styles.toolbar}>
        <Input value={query} onChange={setQuery} placeholder={label('search')} prefix={<Search size={16} />} allowClear className={styles.search} />
        {tab === 'installed' ? (
          <Select value={source} onChange={setSource} style={{ width: 180 }} options={['all', 'hub', 'tenant', 'custom', ...(builtinContent ? ['builtin'] : [])].map((value) => ({ value, label: label(`source.${value}`) }))} />
        ) : (
          <Select value={category} onChange={setCategory} style={{ width: 180 }} options={[{ value: '', label: label('allCategories') }, ...categories.map((value) => ({ value, label: value }))]} />
        )}
        <Button
          icon={<RefreshCw size={14} />}
          onClick={() => {
            void onLoad();
            void onRefreshInstalled().catch((cause) => setError(String(cause)));
          }}
        >
          {label('refresh')}
        </Button>
        {tab === 'installed' && <Button onClick={onCreate}>{label('create')}</Button>}
      </div>
      {isCached && tab !== 'installed' && <Alert type='warning' content={label('cached')} />}
      {error && <Alert type='error' content={error} />}
      <div className='flex-1 min-h-0 overflow-auto pb-4'>
        {tab === 'installed' ? (
          <>
            <div className={styles.grid}>
              {localItems.map((item) => (
                <article className={styles.card} key={itemKey(item)}>
                  <div className={styles.cardHeading}>
                    <CatalogIcon key={item.icon || item.emoji || item.id} item={item} />
                    <div className='min-w-0 flex-1'>
                      <Button
                        type='text'
                        className={styles.title}
                        onClick={() => {
                          void onDetail(item, true);
                        }}
                      >
                        {item.displayName}
                      </Button>
                      <span className={styles.source}>{label(`source.${item.source}`)}</span>
                    </div>
                    <Tag color='green'>{label('downloaded')}</Tag>
                  </div>
                  <p className={styles.description}>{item.description || label('noDescription')}</p>
                  <div className={styles.tags}>
                    {!item.isLocalAllowed && <Tag>{label('cloudOnly')}</Tag>}
                    {!item.isEnabled && <Tag>{label('disabled')}</Tag>}
                  </div>
                  <div className={styles.actions}>
                    <Button
                      type='text'
                      icon={<ArrowUpRight size={14} />}
                      onClick={() => {
                        void onDetail(item, true);
                      }}
                    >
                      {label('details')}
                    </Button>
                    <Switch
                      checked={item.isEnabled}
                      disabled={busy !== null}
                      onChange={(value) => {
                        void onChangeInstallation(item, value);
                      }}
                      aria-label={label('enabled')}
                    />
                    <Button
                      status='danger'
                      icon={<Trash2 size={14} />}
                      aria-label={label('remove')}
                      title={label('remove')}
                      disabled={busy !== null}
                      onClick={() => {
                        void onChangeInstallation(item);
                      }}
                    />
                    <span className='flex-1' />
                    <Button
                      disabled={busy !== null}
                      onClick={() => {
                        void onPrepare(item, false, true);
                      }}
                    >
                      {label('update')}
                    </Button>
                    <Button
                      type='primary'
                      disabled={!item.isEnabled || busy !== null}
                      loading={busy === itemKey(item)}
                      onClick={() => {
                        void onPrepare(item, true);
                      }}
                    >
                      {label('use')}
                    </Button>
                  </div>
                </article>
              ))}
            </div>
            {(source === 'all' || source === 'builtin') && builtinContent && <div className='mt-4'>{builtinContent}</div>}
            {(source === 'all' || source === 'custom') && <div className='mt-4'>{customContent}</div>}
            {localItems.length === 0 && source !== 'all' && source !== 'custom' && <Typography.Paragraph>{label('noDownloads')}</Typography.Paragraph>}
          </>
        ) : (
          <>
            <div className={styles.grid}>
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
                        <span className={styles.source}>{label(`source.${item.source}`)}</span>
                      </div>
                      {local && <Tag color='green'>{label('downloaded')}</Tag>}
                    </div>
                    <p className={styles.description}>{item.description || label('noDescription')}</p>
                    <div className={styles.tags}>
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
                        icon={<Download size={14} />}
                        disabled={!item.isAvailable || busy !== null || (!!local && !isUpdateAvailable)}
                        loading={busy === itemKey(item)}
                        onClick={() => {
                          void onPrepare(item, false, isUpdateAvailable);
                        }}
                      >
                        {label(isUpdateAvailable ? 'update' : 'download')}
                      </Button>
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
            {!isLoading && !items.length && !error && <Typography.Paragraph>{label('empty')}</Typography.Paragraph>}
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
                  {detail.version && (
                    <span className={styles.source}>
                      {label('version')}: {detail.version}
                    </span>
                  )}
                  {detailLocal && <Tag color='green'>{label('downloaded')}</Tag>}
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
              {!isLocalDetail && (
                <Button
                  icon={<Download size={14} />}
                  disabled={!detail.isAvailable || busy !== null || (!!detailLocal && !isDetailUpdate)}
                  onClick={() => {
                    void onPrepare(detail, false, isDetailUpdate);
                  }}
                >
                  {label(isDetailUpdate ? 'update' : 'download')}
                </Button>
              )}
              <Button
                type='primary'
                disabled={!detail.isAvailable || busy !== null || detailLocal?.isEnabled === false}
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
  onCreate: () => void;
  onInstalled: () => Promise<void>;
}
