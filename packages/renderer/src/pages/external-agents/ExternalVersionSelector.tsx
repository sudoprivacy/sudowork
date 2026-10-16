import { Button, Select, Spin, Typography } from '@arco-design/web-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { externalProviders } from '@sudowork/host-bridge/ipcBridge';
import type { AgentReleaseOptions } from '@sudowork/contracts/agent-federation';

export default function ExternalVersionSelector({ agentId, value, isDisabled, onChange }: IExternalVersionSelectorProps) {
  const { t } = useTranslation();
  const [page, setPage] = useState<AgentReleaseOptions | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isFailed, setIsFailed] = useState(false);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    let isCancelled = false;
    setIsLoading(true);
    setIsFailed(false);
    void externalProviders.versions
      .invoke({ agentId })
      .then((result) => {
        if (isCancelled) return;
        if (!result.success || !result.data) throw new Error('Release options unavailable');
        setPage(result.data);
        onChange(result.data.channels.some((channel) => channel.name === 'stable') ? 'channel:stable' : '');
      })
      .catch(() => {
        if (!isCancelled) {
          setIsFailed(true);
          onChange('');
        }
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });
    return () => {
      isCancelled = true;
    };
  }, [agentId, generation, onChange]);
  const onMore = useCallback(async () => {
    if (!page?.next_cursor || isLoading) return;
    setIsLoading(true);
    setIsFailed(false);
    try {
      const result = await externalProviders.versions.invoke({ agentId, after: page.next_cursor });
      if (!result.success || !result.data) throw new Error('Release options unavailable');
      const data = result.data;
      setPage((current) => (current ? { ...data, items: [...current.items, ...data.items] } : data));
    } catch {
      setIsFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [agentId, page, isLoading]);
  return (
    <div className='flex flex-wrap items-center gap-2 mb-3'>
      <Typography.Text>{t('agent.external.versions.choose')}</Typography.Text>
      {isLoading && <Spin size={16} />}
      <Select aria-label={t('agent.external.versions.choose')} value={value || undefined} onChange={onChange} disabled={isDisabled || isLoading || !page} placeholder={t('agent.external.versions.choose')} style={{ minWidth: 220, maxWidth: '100%' }}>
        {page?.channels
          .filter((channel) => channel.enabled)
          .map((channel) => (
            <Select.Option key={`channel:${channel.name}`} value={`channel:${channel.name}`}>
              {channel.name} · {channel.version}
            </Select.Option>
          ))}
        {page?.items.map((item) => (
          <Select.Option key={`version:${item.version}`} value={`version:${item.version}`}>
            {item.version}
          </Select.Option>
        ))}
      </Select>
      {page?.next_cursor && (
        <Button size='mini' disabled={isLoading || isDisabled} onClick={() => void onMore()}>
          {t('agent.external.versions.more')}
        </Button>
      )}
      {isFailed && (
        <Button size='mini' disabled={isLoading || isDisabled} onClick={() => setGeneration((current) => current + 1)}>
          {t('agent.external.versions.retry')}
        </Button>
      )}
      {!isLoading && page && !page.items.length && !page.channels.length && <Typography.Text type='warning'>{t('agent.external.versions.empty')}</Typography.Text>}
    </div>
  );
}

interface IExternalVersionSelectorProps {
  agentId: string;
  value: string;
  isDisabled: boolean;
  onChange: (value: string) => void;
}
