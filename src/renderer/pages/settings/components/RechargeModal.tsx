/**
 * Recharge Modal Component
 * Handles user recharge flow: package selection -> QR code payment -> status polling
 */

import { ipcBridge } from '@/common';
import { SUDOWORK_SERVER_BASE_URL } from '@/common/sudoworkServer';
import AionModal from '@/renderer/components/base/AionModal';
import { useAuth } from '@/renderer/context/AuthContext';
import { Button, Message, Spin, Tabs } from '@arco-design/web-react';
import { Alipay, Wechat, Refresh, CheckOne, CloseOne } from '@icon-park/react';
import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Lazy load QRCodeSVG
const QRCodeSVGLazy = React.lazy(async () => {
  const mod = await import('qrcode.react');
  return { default: mod.QRCodeSVG };
});

// ==================== Types ====================

interface RechargePackage {
  amount: number;
  points: number;
  bonus: number;
  description: string;
  amount_cny: number;
  exchange_rate: number;
}

interface CreateOrderResponse {
  order_no: string;
  amount_usd: number;
  amount_cny: number;
  points: number;
  quota: number;
  expired_at: string;
}

interface PayOrderResponse {
  order_no: string;
  qr_code_url: string;
  order_info: string;
}

interface OrderStatus {
  order_no: string;
  status: 0 | 1 | 2 | 3 | 4 | 5;
  amount_usd: number;
  amount_cny: number;
  points: number;
  created_at: string;
  paid_at?: string;
}

type RechargeStep = 'select' | 'paying' | 'success' | 'failed';
type PaymentMethod = 'ALIPAY' | 'WECHAT';

enum OrderStatusEnum {
  PENDING = 0,
  PAYING = 1,
  SUCCESS = 2,
  FAILED = 3,
  REFUNDED = 4,
  CANCELLED = 5,
}

interface RechargeModalProps {
  visible: boolean;
  onCancel: () => void;
  onSuccess?: () => void;
}

// ==================== Component ====================

const RechargeModal: React.FC<RechargeModalProps> = ({ visible, onCancel, onSuccess }) => {
  const { t } = useTranslation();
  const { user: currentUser, refresh } = useAuth();

  // State
  const [step, setStep] = useState<RechargeStep>('select');
  const [packages, setPackages] = useState<RechargePackage[]>([]);
  const [selectedPackage, setSelectedPackage] = useState<RechargePackage | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('ALIPAY');
  const [orderNo, setOrderNo] = useState<string | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [orderInfo, setOrderInfo] = useState<string | null>(null);
  const [expiredAt, setExpiredAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pollCountRef = useRef(0);
  const MAX_POLL_COUNT = 600; // 30 minutes / 3 seconds

  // Fetch packages
  const fetchPackages = useCallback(async () => {
    if (!currentUser?.token) return;

    setLoading(true);
    try {
      const serverConfig = await ipcBridge.sudoworkServer.getConfig.invoke();
      const response = await fetch(`${serverConfig.baseUrl}/api/v1/recharge/packages`, {
        headers: { Authorization: `Bearer ${currentUser.token}` },
      });
      const data = await response.json();
      if (data.success) {
        setPackages(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch packages:', err);
      Message.error(t('settings.recharge.loadPackagesFailed') || '加载套餐失败');
    } finally {
      setLoading(false);
    }
  }, [currentUser?.token, t]);

  // Create order and get QR code
  const handleCreateOrder = useCallback(async () => {
    if (!currentUser?.token || !selectedPackage) return;

    setLoading(true);
    setError(null);
    try {
      const serverConfig = await ipcBridge.sudoworkServer.getConfig.invoke();
      const baseUrl = serverConfig.baseUrl;

      // Step 1: Create order
      const createRes = await fetch(`${baseUrl}/api/v1/recharge/create`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${currentUser.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: selectedPackage.amount,
          payment_method: paymentMethod,
        }),
      });
      const createData = await createRes.json();

      if (!createData.success) {
        setError(createData.msg || '创建订单失败');
        return;
      }

      const order: CreateOrderResponse = createData.data;
      setOrderNo(order.order_no);
      setExpiredAt(new Date(order.expired_at));

      // Step 2: Get QR code
      const payRes = await fetch(`${baseUrl}/api/v1/recharge/pay`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${currentUser.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ order_no: order.order_no }),
      });
      const payData = await payRes.json();

      if (!payData.success) {
        setError(payData.msg || '获取支付二维码失败');
        return;
      }

      const payResult: PayOrderResponse = payData.data;
      setQrCodeUrl(payResult.qr_code_url);
      setOrderInfo(payResult.order_info);
      setStep('paying');

      // Start polling
      startPolling(baseUrl, order.order_no);
    } catch (err) {
      console.error('Failed to create order:', err);
      setError(t('settings.recharge.createOrderFailed') || '创建订单失败');
    } finally {
      setLoading(false);
    }
  }, [currentUser?.token, selectedPackage, paymentMethod, t]);

  // Start polling for order status
  const startPolling = useCallback(
    (baseUrl: string, order: string) => {
      pollCountRef.current = 0;

      pollTimerRef.current = setInterval(async () => {
        pollCountRef.current++;

        if (pollCountRef.current > MAX_POLL_COUNT) {
          stopPolling();
          setStep('failed');
          setError(t('settings.recharge.orderExpired') || '订单已过期');
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
              Message.success(t('settings.recharge.success') || '充值成功');
              await refresh();
              onSuccess?.();
            } else if (status.status === OrderStatusEnum.FAILED) {
              stopPolling();
              setStep('failed');
              setError(t('settings.recharge.failed') || '支付失败');
            } else if (status.status === OrderStatusEnum.CANCELLED) {
              stopPolling();
              setStep('failed');
              setError(t('settings.recharge.orderCancelled') || '订单已取消');
            }
          }
        } catch (err) {
          console.error('Polling error:', err);
        }
      }, 3000);
    },
    [currentUser?.token, t, refresh, onSuccess]
  );

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

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
    resetState();
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
    setLoading(false);
    setPaying(false);
  }, []);

  // Handle modal close
  const handleCancel = useCallback(() => {
    stopPolling();
    resetState();
    onCancel();
  }, [stopPolling, resetState, onCancel]);

  // Handle modal visibility
  useEffect(() => {
    if (visible) {
      void fetchPackages();
    } else {
      stopPolling();
      resetState();
    }
  }, [visible, fetchPackages, stopPolling, resetState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  // Format currency
  const formatCurrency = (amount: number, currency: 'USD' | 'CNY') => {
    if (currency === 'USD') {
      return `$${amount}`;
    }
    return `${amount.toFixed(1)}`;
  };

  // Render package selection
  const renderPackageSelection = () => (
    <div className='space-y-16px'>
      <div className='text-14px font-500 text-t-primary'>{t('settings.recharge.selectPackage') || '选择套餐'}</div>

      {loading && packages.length === 0 ? (
        <div className='flex justify-center py-40px'>
          <Spin />
        </div>
      ) : (
        <div className='grid grid-cols-3 gap-12px'>
          {packages.map((pkg) => (
            <button
              key={pkg.amount}
              onClick={() => setSelectedPackage(pkg)}
              className={`
                relative p-16px rd-12px border transition-all cursor-pointer text-left
                ${selectedPackage?.amount === pkg.amount ? 'border-border-base bg-fill-1 ring-2 ring-[#7583b2]/30' : 'border-border-base bg-fill-0 hover:bg-fill-1'}
              `}
            >
              <div className='text-22px font-700 text-t-primary'>{formatCurrency(pkg.amount, 'USD')}</div>
              <div className='text-15px font-600 text-brand mt-12px'>{(pkg.points + pkg.bonus).toLocaleString()} PTS</div>
              {pkg.description && <div className='text-12px text-t-secondary mt-6px truncate'>{pkg.description}</div>}
              {selectedPackage?.amount === pkg.amount && (
                <div className='absolute top-8px right-8px w-16px h-16px rd-full bg-brand flex items-center justify-center'>
                  <CheckOne size={12} className='text-white' theme='filled' />
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      <div className='pt-8px'>
        <div className='text-14px font-500 text-t-primary mb-12px'>{t('settings.recharge.selectPayment') || '支付方式'}</div>
        <div className='flex items-center gap-24px'>
          <button onClick={() => setPaymentMethod('ALIPAY')} className={`relative flex items-center gap-8px px-16px py-8px rd-8px border transition-all cursor-pointer ${paymentMethod === 'ALIPAY' ? 'border-border-base bg-fill-1 ring-2 ring-[#7583b2]/30' : 'border-border-base bg-fill-0 hover:bg-fill-1'}`}>
            <Alipay size={18} fill={['#1677FF']} theme='filled' />
            <span className='text-14px text-t-primary'>{t('settings.recharge.alipay') || '支付宝'}</span>
            {paymentMethod === 'ALIPAY' && (
              <div className='absolute -top-4px -right-4px w-14px h-14px rd-full bg-brand flex items-center justify-center'>
                <CheckOne size={10} className='text-white' theme='filled' />
              </div>
            )}
          </button>
          <button onClick={() => setPaymentMethod('WECHAT')} className={`relative flex items-center gap-8px px-16px py-8px rd-8px border transition-all cursor-pointer ${paymentMethod === 'WECHAT' ? 'border-border-base bg-fill-1 ring-2 ring-[#7583b2]/30' : 'border-border-base bg-fill-0 hover:bg-fill-1'}`}>
            <Wechat size={18} fill={['#07C160']} theme='filled' />
            <span className='text-14px text-t-primary'>{t('settings.recharge.wechat') || '微信支付'}</span>
            {paymentMethod === 'WECHAT' && (
              <div className='absolute -top-4px -right-4px w-14px h-14px rd-full bg-brand flex items-center justify-center'>
                <CheckOne size={10} className='text-white' theme='filled' />
              </div>
            )}
          </button>
        </div>
      </div>

      {error && <div className='text-14px text-danger'>{error}</div>}

      <div className='flex justify-end gap-12px pt-8px'>
        <Button onClick={handleCancel}>{t('common.cancel') || '取消'}</Button>
        <Button type='primary' loading={loading} disabled={!selectedPackage} onClick={handleCreateOrder}>
          {t('settings.recharge.createOrder') || '创建订单'}
        </Button>
      </div>
    </div>
  );

  // Render paying state
  const renderPaying = () => (
    <div className='space-y-16px'>
      <div className='text-center'>
        <div className='text-14px text-t-secondary mb-8px'>{t('settings.recharge.scanToPay', { method: paymentMethod === 'ALIPAY' ? '支付宝' : '微信' }) || `请使用${paymentMethod === 'ALIPAY' ? '支付宝' : '微信'}扫码支付`}</div>

        {/* QR Code */}
        <div className='inline-block p-16px bg-white rd-12px border border-border-base'>
          <Suspense
            fallback={
              <div className='w-200px h-200px flex items-center justify-center'>
                <Spin />
              </div>
            }
          >
            {qrCodeUrl && <QRCodeSVGLazy value={qrCodeUrl} size={200} level='H' />}
          </Suspense>
        </div>

        {/* Order Info */}
        <div className='mt-16px space-y-8px'>
          <div className='text-16px font-600 text-t-primary'>
            {selectedPackage && formatCurrency(selectedPackage.amount, 'USD')}
            <span className='text-14px text-t-tertiary ml-4px'>({formatCurrency(selectedPackage?.amount_cny || 0, 'CNY')})</span>
          </div>
          <div className='text-14px text-t-secondary'>
            {t('settings.recharge.pointsToGet') || '获得积分'}: <span className='text-primary font-500'>{(selectedPackage?.points || 0) + (selectedPackage?.bonus || 0)} PTS</span>
          </div>
          {expiredAt && (
            <div className='text-12px text-t-tertiary'>
              {t('settings.recharge.expireAt') || '过期时间'}: {expiredAt.toLocaleTimeString()}
            </div>
          )}
        </div>

        {/* Status */}
        <div className='flex items-center justify-center gap-8px mt-16px text-14px text-t-secondary'>
          <Refresh size={16} className='animate-spin' />
          <span>{t('settings.recharge.waitingPayment') || '等待支付...'}</span>
        </div>

        {/* Cancel Button */}
        <div className='mt-16px'>
          <Button type='text' onClick={handleCancelOrder}>
            {t('settings.recharge.cancelOrder') || '取消订单'}
          </Button>
        </div>
      </div>
    </div>
  );

  // Render success state
  const renderSuccess = () => (
    <div className='flex flex-col items-center py-40px space-y-16px'>
      <CheckOne size={64} className='text-success' />
      <div className='text-20px font-600 text-t-primary'>{t('settings.recharge.success') || '充值成功'}</div>
      <div className='text-14px text-t-secondary'>{t('settings.recharge.successDesc') || '积分已到账，请查收'}</div>
      <Button type='primary' onClick={handleCancel}>
        {t('common.confirm') || '确定'}
      </Button>
    </div>
  );

  // Render failed state
  const renderFailed = () => (
    <div className='flex flex-col items-center py-40px space-y-16px'>
      <CloseOne size={64} className='text-danger' />
      <div className='text-20px font-600 text-t-primary'>{t('settings.recharge.failed') || '充值失败'}</div>
      <div className='text-14px text-t-secondary'>{error}</div>
      <div className='flex gap-12px'>
        <Button onClick={handleCancel}>{t('common.close') || '关闭'}</Button>
        <Button type='primary' onClick={resetState}>
          {t('settings.recharge.retryPayment') || '重新下单'}
        </Button>
      </div>
    </div>
  );

  // Render content based on step
  const renderContent = () => {
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
    <AionModal visible={visible} onCancel={handleCancel} header={t('settings.recharge.title') || '充值积分'} size='medium' footer={null}>
      <div className='p-16px'>{renderContent()}</div>
    </AionModal>
  );
};

export default RechargeModal;
