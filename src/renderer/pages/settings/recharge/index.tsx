/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Message, Spin } from '@arco-design/web-react';
import { Check, CircleCheck, CircleX, CreditCard, MessageCircle, RefreshCw } from 'lucide-react';
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/renderer/context/AuthContext';
import { ipcBridge } from '@/common';
import PageWrapper from '@renderer/components/base/PageWrapper';
import OrderList from './components/OrderList';
import PointsDashboard from './components/PointsDashboard';
import { OrderStatusEnum } from './types';
import type { CreateOrderResponse, OrderStatus, PaymentMethod, PayOrderResponse, RechargePackage, RechargeStep } from './types';
import { formatCurrency } from './utils';

// Lazy load QRCodeSVG
const QRCodeSVGLazy = React.lazy(async () => {
  const mod = await import('qrcode.react');
  return { default: mod.QRCodeSVG };
});

const PANEL_CLASS = 'p-6 bg-muted rd-16px border border-light';

const RechargeCenter: React.FC = () => {
  const { t } = useTranslation();
  const { user: currentUser, refresh, ensureValidToken, forceRefreshToken } = useAuth();

  // Points state
  const [stats, setStats] = useState<any>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  // Recharge state
  const [step, setStep] = useState<RechargeStep>('select');
  const [packages, setPackages] = useState<RechargePackage[]>([]);
  const [selectedPackage, setSelectedPackage] = useState<RechargePackage | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('ALIPAY');
  const [orderNo, setOrderNo] = useState<string | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [, setOrderInfo] = useState<string | null>(null);
  const [expiredAt, setExpiredAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [orderListRefreshKey, setOrderListRefreshKey] = useState(0);

  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pollCountRef = useRef(0);
  const MAX_POLL_COUNT = 600; // 30 minutes / 3 seconds

  // Fetch with auth
  const fetchWithAuth = useCallback(
    async (url: string, options: RequestInit = {}, retry = true): Promise<Response> => {
      const token = await ensureValidToken();
      if (!token) {
        throw new Error('NO_TOKEN');
      }

      const headers = {
        ...options.headers,
        Authorization: `Bearer ${token}`,
      };

      const response = await fetch(url, { ...options, headers });

      if (response.status === 401 && retry) {
        console.log('[RechargeCenter] Got 401, attempting force token refresh...');
        const newToken = await forceRefreshToken();
        if (newToken) {
          const retryHeaders = {
            ...options.headers,
            Authorization: `Bearer ${newToken}`,
          };
          return fetch(url, { ...options, headers: retryHeaders });
        }
      }

      return response;
    },
    [ensureValidToken, forceRefreshToken]
  );

  // Fetch stats and packages
  const fetchStats = useCallback(async () => {
    if (!currentUser?.token) return;

    setStatsLoading(true);
    try {
      const serverConfig = await ipcBridge.sudoworkServer.getConfig.invoke();
      const response = await fetchWithAuth(`${serverConfig.baseUrl}/api/v1/user/dashboard`);
      const data = await response.json();
      if (data.success) {
        setStats(data.data.points);
      }
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    } finally {
      setStatsLoading(false);
    }
  }, [currentUser?.token, fetchWithAuth]);

  const fetchPackages = useCallback(async () => {
    if (!currentUser?.token) return;

    setLoading(true);
    try {
      const serverConfig = await ipcBridge.sudoworkServer.getConfig.invoke();
      const response = await fetchWithAuth(`${serverConfig.baseUrl}/api/v1/recharge/packages`);
      const data = await response.json();
      if (data.success) {
        setPackages(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch packages:', err);
      Message.error(t('settings.recharge.loadPackagesFailed', '加载套餐失败'));
    } finally {
      setLoading(false);
    }
  }, [currentUser?.token, fetchWithAuth, t]);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // Start polling for order status
  const startPolling = useCallback(
    (baseUrl: string, order: string) => {
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
          const response = await fetch(`${baseUrl}/api/v1/recharge/query/${order}`, {
            headers: { Authorization: `Bearer ${currentUser?.token}` },
          });
          const data = await response.json();

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
    [currentUser?.token, t, refresh, fetchStats, stopPolling]
  );

  // Create order and get QR code
  const handleCreateOrder = useCallback(async () => {
    if (!currentUser?.token || !selectedPackage) return;

    setLoading(true);
    setError(null);
    try {
      const serverConfig = await ipcBridge.sudoworkServer.getConfig.invoke();
      const baseUrl = serverConfig.baseUrl;

      // Step 1: Create order
      const createRes = await fetchWithAuth(`${baseUrl}/api/v1/recharge/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: selectedPackage.amount,
          payment_method: paymentMethod,
        }),
      });
      const createData = await createRes.json();

      if (!createData.success) {
        setError(createData.msg || t('settings.recharge.createOrderFailed', '创建订单失败'));
        return;
      }

      const order: CreateOrderResponse = createData.data;
      setOrderNo(order.order_no);
      setExpiredAt(new Date(order.expired_at));

      // Step 2: Get QR code
      const payRes = await fetchWithAuth(`${baseUrl}/api/v1/recharge/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_no: order.order_no }),
      });
      const payData = await payRes.json();

      if (!payData.success) {
        setError(payData.msg || t('settings.recharge.getPaymentQrFailed', '获取支付二维码失败'));
        return;
      }

      const payResult: PayOrderResponse = payData.data;
      setQrCodeUrl(payResult.qr_code_url);
      setOrderInfo(payResult.order_info);
      setStep('paying');

      startPolling(baseUrl, order.order_no);
    } catch (err) {
      console.error('Failed to create order:', err);
      setError(t('settings.recharge.createOrderFailed', '创建订单失败'));
    } finally {
      setLoading(false);
    }
  }, [currentUser?.token, selectedPackage, paymentMethod, fetchWithAuth, t, startPolling]);

  // Cancel order
  const handleCancelOrder = useCallback(async () => {
    if (!currentUser?.token || !orderNo) return;

    try {
      const serverConfig = await ipcBridge.sudoworkServer.getConfig.invoke();
      await fetch(`${serverConfig.baseUrl}/api/v1/recharge/cancel/${orderNo}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${currentUser.token}` },
      });
    } catch (err) {
      console.error('Failed to cancel order:', err);
    }

    stopPolling();
    setStep('select');
    setOrderNo(null);
    setQrCodeUrl(null);
    setOrderInfo(null);
    setExpiredAt(null);
    setError(null);
    setOrderListRefreshKey((prev) => prev + 1);
  }, [currentUser?.token, orderNo, stopPolling]);

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
  const handleContinuePay = useCallback(
    async (orderNoParam: string) => {
      if (!currentUser?.token) return;

      setLoading(true);
      setError(null);
      try {
        const serverConfig = await ipcBridge.sudoworkServer.getConfig.invoke();
        const baseUrl = serverConfig.baseUrl;

        // Query order details
        const queryRes = await fetch(`${baseUrl}/api/v1/recharge/query/${orderNoParam}`, {
          headers: { Authorization: `Bearer ${currentUser.token}` },
        });
        const queryData = await queryRes.json();

        if (!queryData.success) {
          setError(queryData.msg || t('settings.recharge.getOrderInfoFailed', '获取订单信息失败'));
          setStep('failed');
          setLoading(false);
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
        const payRes = await fetch(`${baseUrl}/api/v1/recharge/pay`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${currentUser.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ order_no: orderNoParam }),
        });
        const payData = await payRes.json();

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

        startPolling(baseUrl, orderNoParam);
      } catch (err) {
        console.error('Failed to continue payment:', err);
        setError(t('settings.recharge.continuePayFailed', '继续支付失败'));
        setStep('failed');
      } finally {
        setLoading(false);
      }
    },
    [currentUser?.token, startPolling, t]
  );

  // Initial fetch
  useEffect(() => {
    if (currentUser?.token) {
      void fetchStats();
      void fetchPackages();
    }
  }, [currentUser?.token, fetchStats, fetchPackages]);

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

      {loading && packages.length === 0 ? (
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
        <Button type='primary' loading={loading} disabled={!selectedPackage} onClick={handleCreateOrder}>
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

        {/* Status */}
        <div className='f-center gap-2 mt-4 text-14px text-secondary'>
          <RefreshCw size={16} className='animate-spin' />
          <span>{t('settings.recharge.waitingPayment', '等待支付...')}</span>
        </div>

        {/* Cancel Button */}
        <div className='mt-4'>
          <Button type='text' onClick={handleCancelOrder}>
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

  return (
    <PageWrapper title={t('settings.rechargeCenter', '充值中心')}>
      <div className='flex flex-col gap-6 pb-2'>
        {statsLoading ? (
          <div className='flex justify-center py-10'>
            <Spin />
          </div>
        ) : (
          <PointsDashboard remainingPoints={stats?.remaining ?? 0} usedPoints={stats?.used ?? 0} bonusPoints={stats?.bonus ?? 0} />
        )}

        {/* Recharge Section */}
        {renderRechargeContent()}

        {/* Order List */}
        <OrderList onContinuePay={handleContinuePay} refreshKey={orderListRefreshKey} />
      </div>
    </PageWrapper>
  );
};

export default RechargeCenter;
