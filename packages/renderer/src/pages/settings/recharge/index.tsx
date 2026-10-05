/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Message, Spin } from '@arco-design/web-react';
import { Check, CircleCheck, CircleX, CreditCard, MessageCircle, RefreshCw } from 'lucide-react';
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { requestConsumerApi } from '@sudowork/host-bridge/consumerApi';
import { normalizeRechargeMode, type SystemConfig } from '@sudowork/common/systemConfig';
import { useAuth } from '@renderer/context/AuthContext';
import PageWrapper from '@renderer/components/base/PageWrapper';
import CreditApplicationPanel from './components/CreditApplicationPanel';
import OrderList from './components/OrderList';
import PointsDashboard from './components/PointsDashboard';
import { OrderStatusEnum } from './types';
import type { CreateOrderResponse, OrderStatus, PaymentMethod, PayOrderResponse, RechargeMode, RechargePackage, RechargeStep } from './types';
import { formatCurrency } from './utils';

// Lazy load QRCodeSVG
const QRCodeSVGLazy = React.lazy(async () => {
  const mod = await import('qrcode.react');
  return { default: mod.QRCodeSVG };
});

const PANEL_CLASS = 'p-6 bg-muted rd-16px border border-light';

function RechargeCenter() {
  const { t } = useTranslation();
  const { user: currentUser, refresh, authFetch } = useAuth();

  // Points state
  const [stats, setStats] = useState<any>(null);
  const [isStatsLoading, setIsStatsLoading] = useState(false);
  const [rechargeMode, setRechargeMode] = useState<RechargeMode | null>(null);
  const [isLoadError, setIsLoadError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Recharge state
  const [step, setStep] = useState<RechargeStep>('select');
  const [packages, setPackages] = useState<RechargePackage[]>([]);
  const [selectedPackage, setSelectedPackage] = useState<RechargePackage | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('ALIPAY');
  const [orderNo, setOrderNo] = useState<string | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [, setOrderInfo] = useState<string | null>(null);
  const [expiredAt, setExpiredAt] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderListRefreshKey, setOrderListRefreshKey] = useState(0);

  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pollCountRef = useRef(0);
  const MAX_POLL_COUNT = 600; // 30 minutes / 3 seconds

  // Fetch stats and packages
  const fetchStats = useCallback(async () => {
    if (!currentUser?.token) return;

    setIsStatsLoading(true);
    try {
      const data = await requestConsumerApi<{ points: { remaining: number; used: number; bonus: number } }>(authFetch, '/api/v1/user/dashboard');
      if (!data.success) throw new Error('Dashboard unavailable');
      setStats(data.data.points);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
      setIsLoadError(true);
    } finally {
      setIsStatsLoading(false);
    }
  }, [currentUser?.token, authFetch]);

  const fetchPackages = useCallback(async () => {
    if (!currentUser?.token) return;

    setIsLoading(true);
    try {
      const data = await requestConsumerApi<RechargePackage[]>(authFetch, '/api/v1/recharge/packages');
      if (!data.success) throw new Error('Packages unavailable');
      setPackages(data.data);
    } catch (err) {
      console.error('Failed to fetch packages:', err);
      setIsLoadError(true);
      Message.error(t('settings.recharge.loadPackagesFailed', '加载套餐失败'));
    } finally {
      setIsLoading(false);
    }
  }, [currentUser?.token, authFetch, t]);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // Start polling for order status
  const startPolling = useCallback(
    (order: string) => {
      pollCountRef.current = 0;

      pollTimerRef.current = setInterval(async () => {
        pollCountRef.current++;

        if (pollCountRef.current > MAX_POLL_COUNT) {
          stopPolling();
          setStep('failed');
          setError(t('settings.recharge.orderExpired', '订单已过期'));
          return;
        }

        try {
          const data = await requestConsumerApi<OrderStatus>(authFetch, `/api/v1/recharge/query/${encodeURIComponent(order)}`);

          if (data.success) {
            const status: OrderStatus = data.data;

            if (status.status === OrderStatusEnum.SUCCESS) {
              stopPolling();
              setStep('success');
              Message.success(t('settings.recharge.success', '充值成功'));
              await refresh();
              await fetchStats();
              setOrderListRefreshKey((prev) => prev + 1);
            } else if (status.status === OrderStatusEnum.FAILED) {
              stopPolling();
              setStep('failed');
              setError(t('settings.recharge.failed', '支付失败'));
            } else if (status.status === OrderStatusEnum.CANCELLED) {
              stopPolling();
              setStep('failed');
              setError(t('settings.recharge.orderCancelled', '订单已取消'));
            }
          }
        } catch (err) {
          console.error('Polling error:', err);
        }
      }, 3000);
    },
    [authFetch, t, refresh, fetchStats, stopPolling]
  );

  // Create order and get QR code
  const onCreateOrder = useCallback(async () => {
    if (!currentUser?.token || !selectedPackage) return;

    setIsLoading(true);
    setError(null);
    try {
      // Step 1: Create order
      const createData = await requestConsumerApi<CreateOrderResponse>(authFetch, '/api/v1/recharge/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: selectedPackage.amount,
          payment_method: paymentMethod,
        }),
      });

      if (!createData.success) {
        setError(createData.msg || t('settings.recharge.createOrderFailed', '创建订单失败'));
        return;
      }

      const order: CreateOrderResponse = createData.data;
      setOrderNo(order.order_no);
      setExpiredAt(new Date(order.expired_at));

      // Step 2: Get QR code
      const payData = await requestConsumerApi<PayOrderResponse>(authFetch, '/api/v1/recharge/pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_no: order.order_no }),
      });

      if (!payData.success) {
        setError(payData.msg || t('settings.recharge.getPaymentQrFailed', '获取支付二维码失败'));
        return;
      }

      const payResult: PayOrderResponse = payData.data;
      setQrCodeUrl(payResult.qr_code_url);
      setOrderInfo(payResult.order_info);
      setStep('paying');

      startPolling(order.order_no);
    } catch (err) {
      console.error('Failed to create order:', err);
      setError(t('settings.recharge.createOrderFailed', '创建订单失败'));
    } finally {
      setIsLoading(false);
    }
  }, [currentUser?.token, selectedPackage, paymentMethod, authFetch, t, startPolling]);

  // Cancel order
  const onCancelOrder = useCallback(async () => {
    if (!currentUser?.token || !orderNo) return;

    try {
      const result = await requestConsumerApi(authFetch, `/api/v1/recharge/cancel/${encodeURIComponent(orderNo)}`, { method: 'POST' });
      if (!result.success) throw new Error('Cancellation rejected');
    } catch (err) {
      console.error('Failed to cancel order:', err);
      setError(t('settings.recharge.cancelFailed'));
      return;
    }

    stopPolling();
    setStep('select');
    setOrderNo(null);
    setQrCodeUrl(null);
    setOrderInfo(null);
    setExpiredAt(null);
    setError(null);
    setOrderListRefreshKey((prev) => prev + 1);
  }, [currentUser?.token, orderNo, stopPolling, authFetch, t]);

  // Reset state
  const resetState = useCallback(() => {
    setStep('select');
    setSelectedPackage(null);
    setOrderNo(null);
    setQrCodeUrl(null);
    setOrderInfo(null);
    setExpiredAt(null);
    setError(null);
    setOrderListRefreshKey((prev) => prev + 1);
  }, []);

  // Handle continue pay from OrderList
  const onContinuePay = useCallback(
    async (orderNoParam: string) => {
      if (!currentUser?.token) return;

      setIsLoading(true);
      setError(null);
      try {
        // Query order details
        const queryData = await requestConsumerApi<OrderStatus & { expired_at: string; exchange_rate?: number }>(authFetch, `/api/v1/recharge/query/${encodeURIComponent(orderNoParam)}`);

        if (!queryData.success) {
          setError(queryData.msg || t('settings.recharge.getOrderInfoFailed', '获取订单信息失败'));
          setStep('failed');
          setIsLoading(false);
          return;
        }

        const orderDetails = queryData.data;
        setSelectedPackage({
          amount: orderDetails.amount_usd,
          amount_cny: orderDetails.amount_cny,
          points: orderDetails.points,
          bonus: 0,
          description: '',
          exchange_rate: orderDetails.exchange_rate || 7.3,
        });
        setExpiredAt(new Date(orderDetails.expired_at));

        // Get QR code
        const payData = await requestConsumerApi<PayOrderResponse>(authFetch, '/api/v1/recharge/pay', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ order_no: orderNoParam }),
        });

        if (!payData.success) {
          setError(payData.msg || t('settings.recharge.getPaymentQrFailed', '获取支付二维码失败'));
          setStep('failed');
          return;
        }

        const payResult: PayOrderResponse = payData.data;
        setOrderNo(orderNoParam);
        setQrCodeUrl(payResult.qr_code_url);
        setOrderInfo(payResult.order_info);
        setStep('paying');

        startPolling(orderNoParam);
      } catch (err) {
        console.error('Failed to continue payment:', err);
        setError(t('settings.recharge.continuePayFailed', '继续支付失败'));
        setStep('failed');
      } finally {
        setIsLoading(false);
      }
    },
    [currentUser?.token, startPolling, authFetch, t]
  );

  useEffect(() => {
    const controller = new AbortController();
    setIsLoadError(false);
    setRechargeMode(null);
    void requestConsumerApi<SystemConfig>(authFetch, '/api/v1/system-config', { signal: controller.signal })
      .then((result) => {
        if (!result.success) throw new Error('Recharge configuration unavailable');
        if (!controller.signal.aborted) setRechargeMode(normalizeRechargeMode(result.data?.recharge_mode));
      })
      .catch(() => {
        if (!controller.signal.aborted) setIsLoadError(true);
      });
    return () => controller.abort();
  }, [authFetch, reloadKey]);

  // Initial fetch
  useEffect(() => {
    if (currentUser?.token && rechargeMode) {
      void fetchStats();
      if (rechargeMode === 'pay') {
        void fetchPackages();
      }
    }
  }, [currentUser?.token, fetchStats, fetchPackages, rechargeMode]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  // Payment method options
  const paymentOptions = [
    { method: 'ALIPAY' as const, Icon: CreditCard, iconClassName: 'text-info', label: t('settings.recharge.alipay', '支付宝') },
    { method: 'WECHAT' as const, Icon: MessageCircle, iconClassName: 'text-success', label: t('settings.recharge.wechat', '微信支付') },
  ];

  // Render package selection
  const renderPackageSelection = () => (
    <div className='p-6 bg-muted rd-16px border border-light'>
      <div className='text-14px font-600 text-foreground mb-4'>{t('settings.recharge.selectPackageRecharge', '选择套餐充值')}</div>

      {isLoading && packages.length === 0 ? (
        <div className='flex justify-center py-10'>
          <Spin />
        </div>
      ) : (
        <div className='grid grid-cols-3 gap-3'>
          {packages.map((pkg) => (
            <div
              key={pkg.amount}
              onClick={() => setSelectedPackage(pkg)}
              className={`
                relative p-4 rd-12px border transition-all cursor-pointer text-left
                ${selectedPackage?.amount === pkg.amount ? 'bg-emphasis border-primary' : 'bg-muted border-light hover:bg-emphasis'}
              `}
            >
              <div className='text-22px font-700 text-foreground'>{formatCurrency(pkg.amount_cny, 'CNY')}</div>
              <div className='text-15px font-600 text-brand mt-3'>{(pkg.points + pkg.bonus).toLocaleString()} PTS</div>
              {pkg.description && <div className='text-12px text-secondary mt-1.5 truncate'>{pkg.description}</div>}
              {selectedPackage?.amount === pkg.amount && (
                <div className='absolute top-2 right-2 size-4 rd-full bg-primary f-center text-white'>
                  <Check size={10} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className='pt-4'>
        <div className='text-14px font-500 text-foreground mb-3'>{t('settings.recharge.selectPayment', '支付方式')}</div>
        <div className='flex items-center gap-6'>
          {paymentOptions.map(({ method, Icon, iconClassName, label }) => (
            <button key={method} onClick={() => setPaymentMethod(method)} className={`relative flex items-center gap-2 px-4 py-2 rd-12px border transition-all cursor-pointer ${paymentMethod === method ? 'bg-emphasis border-primary' : 'bg-muted border-light hover:bg-emphasis'}`}>
              <Icon size={18} className={iconClassName} />
              <span className='text-14px text-foreground'>{label}</span>
              {paymentMethod === method && (
                <div className='absolute -top-1 -right-1 w-3.5 h-3.5 rd-full bg-primary f-center text-white'>
                  <Check size={9} />
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {error && <div className='text-14px text-danger pt-4'>{error}</div>}

      <div className='flex justify-end gap-3 pt-4'>
        <Button type='primary' loading={isLoading} disabled={!selectedPackage} onClick={onCreateOrder}>
          {t('settings.recharge.createOrder', '创建订单')}
        </Button>
      </div>
    </div>
  );

  // Render paying state
  const renderPaying = () => (
    <div className={PANEL_CLASS}>
      <div className='text-center'>
        <div className='text-14px text-secondary mb-2'>{t('settings.recharge.scanToPay', { method: paymentMethod === 'ALIPAY' ? t('settings.recharge.alipay', '支付宝') : t('settings.recharge.wechatShort', '微信'), defaultValue: '请使用{{method}}扫码支付' })}</div>

        {/* QR Code */}
        <div className='inline-block p-4 bg-white rd-12px border border-light'>
          <Suspense
            fallback={
              <div className='w-50 h-50 f-center'>
                <Spin />
              </div>
            }
          >
            {qrCodeUrl && <QRCodeSVGLazy value={qrCodeUrl} size={200} level='H' />}
          </Suspense>
        </div>

        {/* Order Info */}
        <div className='mt-4 space-y-2'>
          <div className='text-16px font-600 text-foreground'>{selectedPackage && formatCurrency(selectedPackage.amount_cny, 'CNY')}</div>
          <div className='text-14px text-secondary'>
            {t('settings.recharge.pointsToGet', '获得积分')}: <span className='text-primary font-500'>{(selectedPackage?.points || 0) + (selectedPackage?.bonus || 0)} PTS</span>
          </div>
          {expiredAt && (
            <div className='text-12px text-tertiary'>
              {t('settings.recharge.expireAt', '过期时间')}: {expiredAt.toLocaleTimeString()}
            </div>
          )}
        </div>

        {error && (
          <div role='alert' className='text-danger'>
            {error}
          </div>
        )}

        {/* Status */}
        <div className='f-center gap-2 mt-4 text-14px text-secondary'>
          <RefreshCw size={16} className='animate-spin' />
          <span>{t('settings.recharge.waitingPayment', '等待支付...')}</span>
        </div>

        {/* Cancel Button */}
        <div className='mt-4'>
          <Button type='text' onClick={onCancelOrder}>
            {t('settings.recharge.cancelOrder', '取消订单')}
          </Button>
        </div>
      </div>
    </div>
  );

  // Render success state
  const renderSuccess = () => (
    <div className={`${PANEL_CLASS} flex flex-col items-center py-10 space-y-4`}>
      <CircleCheck size={64} className='text-success' />
      <div className='text-20px font-600 text-foreground'>{t('settings.recharge.success', '充值成功')}</div>
      <div className='text-14px text-secondary'>{t('settings.recharge.successDesc', '积分已到账，请查收')}</div>
      <Button type='primary' onClick={resetState}>
        {t('settings.recharge.continueRecharge', '继续充值')}
      </Button>
    </div>
  );

  // Render failed state
  const renderFailed = () => (
    <div className={`${PANEL_CLASS} flex flex-col items-center py-10 space-y-4`}>
      <CircleX size={64} className='text-danger' />
      <div className='text-20px font-600 text-foreground'>{t('settings.recharge.failed', '充值失败')}</div>
      <div className='text-14px text-secondary'>{error}</div>
      <div className='flex gap-3'>
        <Button onClick={resetState}>{t('common.close', '关闭')}</Button>
        <Button type='primary' onClick={resetState}>
          {t('settings.recharge.retryPayment', '重新下单')}
        </Button>
      </div>
    </div>
  );

  // Render content based on step
  const renderRechargeContent = () => {
    switch (step) {
      case 'select':
        return renderPackageSelection();
      case 'paying':
        return renderPaying();
      case 'success':
        return renderSuccess();
      case 'failed':
        return renderFailed();
      default:
        return renderPackageSelection();
    }
  };

  if (isLoadError) {
    return (
      <PageWrapper title={t('settings.rechargeCenter')}>
        <div role='alert' className='p-6 text-center'>
          <p>{t('settings.recharge.loadFailed')}</p>
          <Button onClick={() => setReloadKey((key) => key + 1)}>{t('common.retry')}</Button>
        </div>
      </PageWrapper>
    );
  }

  if (!rechargeMode) {
    return (
      <PageWrapper title={t('settings.rechargeCenter', '充值中心')}>
        <div className='flex justify-center py-10'>
          <Spin />
        </div>
      </PageWrapper>
    );
  }

  if (rechargeMode === 'approve') {
    return (
      <PageWrapper title={t('settings.creditApplication.title', '积分申请')}>
        <div className='flex flex-col gap-6 pb-2'>
          {isStatsLoading ? (
            <div className='flex justify-center py-10'>
              <Spin />
            </div>
          ) : (
            <PointsDashboard remainingPoints={stats?.remaining ?? 0} usedPoints={stats?.used ?? 0} bonusPoints={stats?.bonus ?? 0} />
          )}

          <CreditApplicationPanel onSubmitted={fetchStats} />
        </div>
      </PageWrapper>
    );
  }

  if (rechargeMode === 'disabled') {
    return (
      <PageWrapper title={t('settings.rechargeCenter', '充值中心')}>
        <div className='flex flex-col gap-6 pb-2'>
          {isStatsLoading ? (
            <div className='flex justify-center py-10'>
              <Spin />
            </div>
          ) : (
            <PointsDashboard remainingPoints={stats?.remaining ?? 0} usedPoints={stats?.used ?? 0} bonusPoints={stats?.bonus ?? 0} />
          )}

          <div className={PANEL_CLASS}>
            <div className='text-14px text-secondary'>{t('settings.recharge.disabled', '当前暂未开放充值')}</div>
          </div>
        </div>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper title={t('settings.rechargeCenter', '充值中心')}>
      <div className='flex flex-col gap-6 pb-2'>
        {isStatsLoading ? (
          <div className='flex justify-center py-10'>
            <Spin />
          </div>
        ) : (
          <PointsDashboard remainingPoints={stats?.remaining ?? 0} usedPoints={stats?.used ?? 0} bonusPoints={stats?.bonus ?? 0} />
        )}

        {/* Recharge Section */}
        {renderRechargeContent()}

        {/* Order List */}
        <OrderList onContinuePay={onContinuePay} refreshKey={orderListRefreshKey} />
      </div>
    </PageWrapper>
  );
}

export default RechargeCenter;
