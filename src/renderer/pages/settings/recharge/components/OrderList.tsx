import { Tag, Button, Spin, Message } from '@arco-design/web-react';
import { IconRefresh } from '@arco-design/web-react/icon';
import { CreditCard, MessageCircle } from 'lucide-react';
import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/renderer/context/AuthContext';
import { ipcBridge } from '@/common';
import { OrderStatusEnum } from '../types';
import type { Order } from '../types';
import { formatAmount, formatDateTime } from '../utils';

const OrderList: React.FC<IOrderListProps> = ({ onContinuePay, refreshKey }) => {
  const { t } = useTranslation();
  const { user: currentUser, ensureValidToken } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchOrders = useCallback(async () => {
    if (!currentUser?.token) return;

    setLoading(true);
    try {
      const serverConfig = await ipcBridge.sudoworkServer.getConfig.invoke();
      const token = await ensureValidToken();
      if (!token) return;

      const response = await fetch(`${serverConfig.baseUrl}/api/v1/recharge/list?page=1&pageSize=100`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await response.json();

      if (data.success) {
        setOrders(data.data.list);
      }
    } catch (err) {
      console.error('Failed to fetch orders:', err);
      Message.error(t('settings.orders.loadFailed', '加载订单失败'));
    } finally {
      setLoading(false);
    }
  }, [currentUser?.token, ensureValidToken, t]);

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders, refreshKey]);

  // 状态标签颜色
  const getStatusColor = (status: OrderStatusEnum) => {
    switch (status) {
      case OrderStatusEnum.PENDING:
        return 'orange';
      case OrderStatusEnum.PAYING:
        return 'arcoblue';
      case OrderStatusEnum.SUCCESS:
        return 'green';
      case OrderStatusEnum.FAILED:
        return 'red';
      case OrderStatusEnum.REFUNDED:
        return 'gray';
      case OrderStatusEnum.CANCELLED:
        return 'gray';
      default:
        return 'gray';
    }
  };

  // 支付方式样式
  const getPaymentMethodStyle = (method: 'ALIPAY' | 'WECHAT') => {
    if (method === 'ALIPAY') {
      return {
        bgColor: 'bg-success-soft',
        textColor: 'text-info',
        icon: <CreditCard size={14} />,
        label: t('settings.recharge.alipay', '支付宝'),
      };
    }
    return {
      bgColor: 'bg-success-soft',
      textColor: 'text-success',
      icon: <MessageCircle size={14} />,
      label: t('settings.recharge.wechat', '微信'),
    };
  };

  if (loading) {
    return (
      <div className='flex justify-center py-6'>
        <Spin />
      </div>
    );
  }

  if (orders.length === 0) {
    return <div className='py-6 text-center text-tertiary text-14px'>{t('settings.orders.noOrders', '暂无订单记录')}</div>;
  }

  return (
    <div className='bg-muted rd-16px overflow-hidden border border-light'>
      <div className='px-5 py-4  flex items-center justify-between border-b border-light'>
        <div className='font-600 text-14px text-foreground'>{t('settings.orders.title', '订单记录')}</div>
        <div className='flex items-center gap-3'>
          <Button type='text' size='mini' iconOnly icon={<IconRefresh className='text-secondary text-16px' />} onClick={() => void fetchOrders()} title={t('settings.orders.refresh', '刷新')} />
          <div className='text-12px text-secondary'>{t('settings.orders.total', { count: orders.length, defaultValue: '共 {{count}} 条' })}</div>
        </div>
      </div>

      <div className='max-h-100 overflow-y-auto'>
        {orders.map((order) => {
          const paymentStyle = getPaymentMethodStyle(order.payment_method);
          // 将 PAYING 状态显示为"待支付"
          const displayStatusText = order.status === OrderStatusEnum.PAYING ? t('settings.orders.pendingPayment', '待支付') : order.status_text;
          return (
            <div key={order.order_no} className='p-4 border-b last:border-b-0 flex items-center gap-3 border-light'>
              {/* 订单号 */}
              <div className='flex-1 min-w-0 text-13px text-secondary truncate'>{order.order_no}</div>
              {/* 充值金额 */}
              <div className='w-20 flex-shrink-0 text-15px font-500 text-foreground'>{formatAmount(order.amount_cny)}</div>
              {/* 积分 */}
              <div className='w-22.5 flex-shrink-0 text-14px text-primary font-500'>{order.points.toLocaleString()} PTS</div>
              {/* 支付方式 */}
              <div className={`flex-shrink-0 flex items-center gap-1 px-2 py-1 rd-full ${paymentStyle.bgColor} ${paymentStyle.textColor}`}>
                {paymentStyle.icon}
                <span className={`text-12px font-500 ${paymentStyle.textColor}`}>{paymentStyle.label}</span>
              </div>
              {/* 状态 */}
              <div className='flex-shrink-0'>
                <Tag color={getStatusColor(order.status)} className={'rd-full'}>
                  {displayStatusText}
                </Tag>
              </div>
              {/* 创建时间 */}
              <div className='w-25 flex-shrink-0 text-12px text-tertiary'>{formatDateTime(order.created_at)}</div>
              {/* 操作 */}
              <div className='w-20 flex-shrink-0'>
                {order.status === OrderStatusEnum.PAYING && (
                  <Button type='primary' size='small' onClick={() => onContinuePay(order.order_no)}>
                    {t('settings.orders.continuePay', '继续支付')}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default OrderList;

interface IOrderListProps {
  onContinuePay: (orderNo: string) => void;
  refreshKey?: number; // 用于触发刷新
}
