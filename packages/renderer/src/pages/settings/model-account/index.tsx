import { Alert, Button, Pagination, Spin, Table } from '@arco-design/web-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ModelLog } from './client';
import { useModelAccount } from './useModelAccount';

export default function ModelAccountPanel() {
  const model = useModelAccount();
  return <PersonalModelAccount key={model.identityKey} model={model} />;
}

interface PersonalModelAccountProps {
  model: ReturnType<typeof useModelAccount>;
}
function PersonalModelAccount({ model }: PersonalModelAccountProps) {
  const { t } = useTranslation();
  const { account, error, isLoading, refresh, request } = model;
  const [page, setPage] = useState(1);
  const [logs, setLogs] = useState<{ items: ModelLog[]; total: number; truncated: boolean }>();
  const [logError, setLogError] = useState('');
  useEffect(() => {
    let isActive = true;
    setLogs(undefined);
    setLogError('');
    if (account)
      void request<{ items: ModelLog[]; total: number; truncated: boolean }>(`model-account/logs?page=${page}`)
        .then((value) => {
          if (isActive) setLogs(value);
        })
        .catch((e: Error) => {
          if (isActive) setLogError(e.message);
        });
    return () => {
      isActive = false;
    };
  }, [account, page, request]);
  if (isLoading) return <Spin />;
  if (error) return <Alert type='warning' content={error.message} action={<Button onClick={() => void refresh()}>{t('modelBilling.refresh')}</Button>} />;
  if (!account) return null;
  const member = account.member;
  return (
    <section className='p-6 rd-16px border border-light flex flex-col gap-4'>
      <div className='flex justify-between items-center'>
        <h3>{t('modelBilling.title')}</h3>
        <Button onClick={() => void refresh()}>{t('modelBilling.refresh')}</Button>
      </div>
      <p className='text-secondary'>{t('modelBilling.sharedDescription')}</p>
      {account.account_status !== 'ready' && <Alert type='warning' content={t('modelBilling.accountPending')} />}
      {member ? (
        <div className='grid grid-cols-3 gap-4'>
          <div>
            <div className='text-secondary'>{t('modelBilling.remainingLimit')}</div>
            <strong>{member.unlimited ? t('modelBilling.unlimited') : `$${member.remaining_limit_usd}`}</strong>
          </div>
          <div>
            <div className='text-secondary'>{t('modelBilling.used')}</div>
            <strong>${member.used_amount_usd}</strong>
          </div>
          <div>
            <div className='text-secondary'>{t('modelBilling.status')}</div>
            <strong>{t(`modelBilling.statuses.${member.effective_status}`)}</strong>
          </div>
        </div>
      ) : (
        <Alert type='warning' content={t(account.member_usage_status === 'unavailable' ? 'modelBilling.memberUsageUnavailable' : 'modelBilling.memberPending')} />
      )}
      <h4>{t('modelBilling.myUsage')}</h4>
      {logError ? (
        <Alert type='warning' content={logError} />
      ) : (
        <Table
          rowKey='id'
          loading={!logs}
          pagination={false}
          data={logs?.items ?? []}
          columns={[
            { title: t('modelBilling.time'), render: (_, row: ModelLog) => new Date(row.created_at * 1000).toLocaleString() },
            { title: t('modelBilling.model'), dataIndex: 'model_name' },
            { title: t('modelBilling.cost'), render: (_, row: ModelLog) => `$${row.amount_usd}` },
            { title: t('modelBilling.tokens'), render: (_, row: ModelLog) => row.input_tokens + row.output_tokens },
          ]}
        />
      )}
      {logs?.truncated && <Alert type='info' content={t('modelBilling.truncated')} />}
      <Pagination current={page} pageSize={20} total={logs?.total ?? 0} onChange={setPage} />
    </section>
  );
}
