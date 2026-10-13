import { Alert, Button, Input, Message, Radio, Spin, Table } from '@arco-design/web-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PageWrapper from '@renderer/components/base/PageWrapper';
import { useModelAccount } from '../model-account/useModelAccount';
import { isPayableOrder, type ModelOrder, type ModelOnlineOrder, type ModelPackage } from '../model-account/client';

const QRCode = lazy(async () => ({ default: (await import('qrcode.react')).QRCodeSVG }));
export default function RechargeCenter() {
  const model = useModelAccount();
  return <OrganizationRechargeCenter key={model.identityKey} model={model} />;
}

function OrganizationRechargeCenter({ model }: IOrganizationRechargeCenterProps) {
  const { t } = useTranslation();
  const { account, error, isLoading, refresh, request, access, accessError, isAccessLoading, refreshAccess } = model;
  const [packages, setPackages] = useState<ModelPackage[]>([]);
  const [orders, setOrders] = useState<ModelOrder[]>([]);
  const [orderPage, setOrderPage] = useState(1);
  const [orderTotal, setOrderTotal] = useState(0);
  const [amount, setAmount] = useState('10.00');
  const [method, setMethod] = useState<'ALIPAY' | 'WECHAT'>('ALIPAY');
  const [order, setOrder] = useState<ModelOnlineOrder>();
  const [qr, setQr] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [loadFailure, setLoadFailure] = useState('');
  const [isRecordsLoading, setIsRecordsLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const reference = useRef<{ identity: string; key: string } | undefined>(undefined);
  const isAllowed = access?.can_recharge === true && !accessError;
  const onReload = useCallback(() => {
    // Refreshes are independent of the successful payment operation.
    void request<{ items: ModelOrder[]; total: number }>(`model-billing/orders?page=${orderPage}`)
      .then((result) => {
        setOrders(result.items);
        setOrderTotal(result.total);
        setLoadFailure('');
      })
      .catch((e: Error) => setLoadFailure(e.message));
    void refresh().catch((): void => undefined);
  }, [request, refresh, orderPage]);
  useEffect(() => {
    let isActive = true;
    if (isAllowed) {
      setLoadFailure('');
      setIsRecordsLoading(true);
      void Promise.all([request<{ items: ModelPackage[] }>('model-billing/packages'), request<{ items: ModelOrder[]; total: number }>(`model-billing/orders?page=${orderPage}`)])
        .then(([p, o]) => {
          if (isActive) {
            setPackages(p.items);
            setOrders(o.items);
            setOrderTotal(o.total);
          }
        })
        .catch((e: Error) => {
          if (isActive) setLoadFailure(e.message);
        })
        .finally(() => {
          if (isActive) setIsRecordsLoading(false);
        });
    }
    return () => {
      isActive = false;
    };
  }, [isAllowed, request, orderPage, reloadKey]);
  const onSync = useCallback(
    async (orderNo: string) => {
      const updated = await request<ModelOnlineOrder>(`model-billing/orders/${encodeURIComponent(orderNo)}/sync`, 'POST');
      setOrder(updated);
      if (updated.payment_status === 'paid' || updated.payment_status === 'cancelled') {
        setQr('');
        onReload();
      }
      return updated;
    },
    [request, onReload]
  );
  useEffect(() => {
    if (!isAllowed || !order || !['pending', 'paying'].includes(order.payment_status) || order.expires_at <= Date.now()) return;
    let isStopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await onSync(order.order_no);
      } catch (e) {
        if (!isStopped) setFailure((e as Error).message);
      }
      if (!isStopped && order.expires_at > Date.now()) timer = setTimeout(() => void poll(), 5000);
      else if (!isStopped) {
        setQr('');
        setFailure(t('modelBilling.expiredOrder'));
      }
    };
    timer = setTimeout(() => void poll(), 5000);
    return () => {
      isStopped = true;
      clearTimeout(timer);
    };
  }, [isAllowed, order, onSync, t]);
  const onPay = async (existing?: ModelOnlineOrder) => {
    setIsBusy(true);
    setFailure('');
    try {
      const identity = `${amount}:${method}`;
      if (reference.current?.identity !== identity) reference.current = { identity, key: crypto.randomUUID() };
      const created = existing ?? (await request<ModelOnlineOrder>('model-billing/orders', 'POST', { purchase_amount_usd: amount, payment_method: method }, reference.current.key));
      setOrder(created);
      const payment = await request<{ qr_code_url: string; order: ModelOnlineOrder }>(`model-billing/orders/${encodeURIComponent(created.order_no)}/pay`, 'POST');
      setOrder(payment.order);
      setQr(payment.qr_code_url);
      reference.current = undefined;
      onReload();
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setIsBusy(false);
    }
  };
  const onCancel = async () => {
    if (!order) return;
    setIsBusy(true);
    try {
      await request(`model-billing/orders/${encodeURIComponent(order.order_no)}/cancel`, 'POST');
      setOrder(undefined);
      setQr('');
      onReload();
    } catch (e) {
      Message.error((e as Error).message);
    } finally {
      setIsBusy(false);
    }
  };
  return (
    <PageWrapper title={t('modelBilling.recharge')}>
      {isAccessLoading ? (
        <Spin />
      ) : accessError ? (
        <div>
          <Alert type='warning' content={accessError.message} />
          <Button
            onClick={() => {
              void refreshAccess().catch((): void => undefined);
              void refresh().catch((): void => undefined);
            }}
          >
            {t('common.retry')}
          </Button>
        </div>
      ) : !isAllowed ? (
        <Alert type='warning' content={t('modelBilling.adminOnly')} />
      ) : (
        <div className='flex flex-col gap-4'>
          <div className='p-6 rd-16px border border-light'>
            <h3>
              {t('modelBilling.organizationBalance')}: {error || account?.balance_status === 'unavailable' ? t('modelBilling.balanceUnavailable') : isLoading ? '—' : account?.model_balance_usd !== undefined ? `$${account.model_balance_usd}` : '—'}
            </h3>
            {(error || account?.balance_status === 'unavailable') && <Button onClick={() => void refresh().catch((): void => undefined)}>{t('modelBilling.refreshBalance')}</Button>}
            <p>{t('modelBilling.rechargeDescription')}</p>
          </div>
          {failure && <Alert type='error' content={failure} />}
          {loadFailure && (
            <div>
              <Alert type='error' content={loadFailure} />
              <Button onClick={() => setReloadKey((key) => key + 1)}>{t('common.retry')}</Button>
            </div>
          )}
          {order?.payment_status === 'paid' && <Alert type={order.credit_status === 'credited' ? 'success' : 'warning'} content={t(`modelBilling.creditStatuses.${order.credit_status}`)} />}
          {qr && order ? (
            <div className='p-6 rd-16px border border-light flex flex-col items-center gap-4'>
              <p>
                {order.payment_method === 'ALIPAY' ? t('modelBilling.alipay') : t('modelBilling.wechat')} · ¥{(order.amount_cny_fen / 100).toFixed(2)}
              </p>
              <Suspense fallback={<Spin />}>
                <QRCode value={qr} size={200} />
              </Suspense>
              <p>
                {t('modelBilling.purchase')}: ${order.purchase_amount_usd} · {t('modelBilling.bonus')}: ${order.bonus_amount_usd}
              </p>
              <p>
                {t('modelBilling.expires')}: {new Date(order.expires_at).toLocaleString()}
              </p>
              {order.payment_test_mode && <Alert type='warning' content={t('modelBilling.testPayment')} />}
              <Button loading={isBusy} onClick={() => void onSync(order.order_no).catch((e: Error) => setFailure(e.message))}>
                {t('modelBilling.refresh')}
              </Button>
              <Button loading={isBusy} onClick={() => void onCancel()}>
                {t('modelBilling.cancel')}
              </Button>
            </div>
          ) : (
            <div className='p-6 rd-16px border border-light flex flex-col gap-4'>
              <div className='flex flex-wrap gap-3'>
                {packages.map((p) => (
                  <Button key={p.purchase_amount_usd} type={amount === p.purchase_amount_usd ? 'primary' : 'secondary'} onClick={() => setAmount(p.purchase_amount_usd)}>
                    ${p.purchase_amount_usd} + ${p.bonus_amount_usd} · ¥{(p.amount_cny_fen / 100).toFixed(2)}
                  </Button>
                ))}
              </div>
              <label>
                {t('modelBilling.purchase')} (USD)
                <Input value={amount} onChange={setAmount} placeholder='1.00 – 10000.00' />
              </label>
              <Radio.Group
                value={method}
                onChange={setMethod}
                options={[
                  { label: t('modelBilling.alipay'), value: 'ALIPAY' },
                  { label: t('modelBilling.wechat'), value: 'WECHAT' },
                ]}
              />
              <Button type='primary' loading={isBusy} onClick={() => void onPay(order && ['pending', 'paying'].includes(order.payment_status) ? order : undefined)}>
                {order && ['pending', 'paying'].includes(order.payment_status) ? t('modelBilling.continuePay') : t('modelBilling.createOrder')}
              </Button>
            </div>
          )}
          <h3>{t('modelBilling.orders')}</h3>
          {!loadFailure && (
            <Table
              loading={isRecordsLoading}
              rowKey='order_no'
              data={orders}
              pagination={{ current: orderPage, pageSize: 20, total: orderTotal, onChange: setOrderPage }}
              columns={[
                { title: t('modelBilling.source'), render: (_, row: ModelOrder) => t(row.source === 'manual' ? 'modelBilling.manualCredit' : 'modelBilling.onlineCredit') },
                { title: t('modelBilling.order'), dataIndex: 'order_no' },
                { title: t('modelBilling.purchase'), render: (_, row: ModelOrder) => `$${row.purchase_amount_usd}` },
                { title: t('modelBilling.bonus'), render: (_, row: ModelOrder) => `$${row.bonus_amount_usd}` },
                { title: t('modelBilling.paidCny'), render: (_, row: ModelOrder) => (row.source === 'manual' ? t('modelBilling.noPayment') : `¥${(row.amount_cny_fen / 100).toFixed(2)}`) },
                { title: t('modelBilling.status'), render: (_, row: ModelOrder) => t(row.source === 'manual' || row.payment_status === 'paid' ? `modelBilling.creditStatuses.${row.credit_status}` : `modelBilling.paymentStatuses.${row.payment_status}`) },
                { title: t('modelBilling.operator'), render: (_, row: ModelOrder) => row.payer_nickname || row.payer_username || row.payer_user_id || '—' },
                { title: t('modelBilling.reason'), render: (_, row: ModelOrder) => row.reason || '—' },
                {
                  title: t('modelBilling.actions'),
                  render: (_, row: ModelOrder) =>
                    isPayableOrder(row) ? (
                      <Button loading={isBusy} onClick={() => void onPay(row)}>
                        {t('modelBilling.continuePay')}
                      </Button>
                    ) : null,
                },
              ]}
            />
          )}
        </div>
      )}
    </PageWrapper>
  );
}

interface IOrganizationRechargeCenterProps {
  model: ReturnType<typeof useModelAccount>;
}
