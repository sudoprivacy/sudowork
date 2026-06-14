/**
 * OrderList Component
 * Displays user's recharge order history
 */

import { ipcBridge } from '@/common';
import { useAuth } from '@/renderer/context/AuthContext';
import { Tag, Button, Spin, Message } from '@arco-design/web-react';
import { Alipay, Wechat, Refresh } from '@icon-park/react';
import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

// Order status enum
enum OrderStatusEnum {
  PENDING = 0,
  PAYING = 1,
  SUCCESS = 2,
  FAILED = 3,
  REFUNDED = 4,
  CANCELLED = 5,
}

interface Order {
  order_no: string;
  amount_usd: number;
  amount_cny: number;
  points: number;
  status: OrderStatusEnum;
  status_text: string;
  payment_method: 'ALIPAY' | 'WECHAT';
  created_at: string;
}

interface OrderListProps {
  onContinuePay: (orderNo: string) => void;
  refreshKey?: number; // 用于触发刷新
}

const OrderList: React.FC<OrderListProps> = ({ onContinuePay, refreshKey }) => {
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
      Message.error(t('settings.orders.loadFailed') || '加载订单失败');
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

  // 格式化日期时间（处理时区）
  const formatDateTime = (dateStr: string) => {
    // 服务端返回的时间可能是 ISO 格式或 SQLite 格式
    // SQLite 格式: "2024-04-20 12:00:00" (无时区，通常为 UTC)
    // ISO 格式: "2024-04-20T12:00:00.000Z" (有 Z 表示 UTC)

    let date: Date;
    if (dateStr.includes('T')) {
      // ISO 格式，直接解析
      date = new Date(dateStr);
    } else {
      // SQLite 格式，假设为 UTC，添加 Z 后缀
      date = new Date(dateStr + 'Z');
    }

    // 转换为本地时间显示
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const hour = date.getHours().toString().padStart(2, '0');
    const minute = date.getMinutes().toString().padStart(2, '0');
    return `${month}-${day} ${hour}:${minute}`;
  };

  // 格式化金额
  const formatAmount = (amount: number) => `¥${amount.toFixed(2)}`;

  // 支付方式样式
  const getPaymentMethodStyle = (method: 'ALIPAY' | 'WECHAT') => {
    if (method === 'ALIPAY') {
      return {
        bgColor: 'bg-[#1677FF]/10',
        textColor: 'text-[#1677FF]',
        icon: <Alipay size={14} fill={['#1677FF']} />,
        label: t('settings.recharge.alipay') || '支付宝',
      };
    }
    return {
      bgColor: 'bg-[#07C160]/10',
      textColor: 'text-[#07C160]',
      icon: <Wechat size={14} fill={['#07C160']} />,
      label: t('settings.recharge.wechat') || '微信',
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
    return <div className='py-6 text-center text-t-tertiary text-14px'>{t('settings.orders.noOrders') || '暂无订单记录'}</div>;
  }

  return (
    <div className='bg-fill-0 rd-16px border border-solid border-[var(--border-base)] overflow-hidden'>
      <div className='px-5 py-4 border-b border-b-solid border-b-[var(--border-base)] flex items-center justify-between'>
        <div className='font-600 text-14px text-t-primary'>{t('settings.orders.title') || '订单记录'}</div>
        <div className='flex items-center gap-3'>
          <button onClick={() => void fetchOrders()} className='p-1 rd-4px hover:bg-fill-1 transition-colors cursor-pointer border-none bg-transparent' style={{ outline: 'none', boxShadow: 'none' }} title={t('settings.orders.refresh') || '刷新'}>
            <Refresh size={16} className='text-t-secondary' />
          </button>
          <div className='text-12px text-t-secondary'>{t('settings.orders.total', { count: orders.length }) || `共 ${orders.length} 条`}</div>
        </div>
      </div>

      <div className='max-h-100 overflow-y-auto'>
        {orders.map((order) => {
          const paymentStyle = getPaymentMethodStyle(order.payment_method);
          // 将 PAYING 状态显示为"待支付"
          const displayStatusText = order.status === OrderStatusEnum.PAYING ? '待支付' : order.status_text;
          return (
            <div key={order.order_no} className='px-4 py-2.5 border-b border-b-solid border-b-[var(--color-border-1)] last:border-b-0 flex items-center gap-3'>
              {/* 订单号 */}
              <div className='flex-1 min-w-0 text-13px text-t-secondary truncate'>{order.order_no}</div>
              {/* 充值金额 */}
              <div className='w-20 flex-shrink-0 text-15px font-500 text-t-primary'>{formatAmount(order.amount_cny)}</div>
              {/* 积分 */}
              <div className='w-22.5 flex-shrink-0 text-14px text-primary font-500'>{order.points.toLocaleString()} PTS</div>
              {/* 支付方式 */}
              <div className={`w-20 flex-shrink-0 flex items-center gap-1 px-2 py-1 rd-6px ${paymentStyle.bgColor}`}>
                {paymentStyle.icon}
                <span className={`text-12px font-500 ${paymentStyle.textColor}`}>{paymentStyle.label}</span>
              </div>
              {/* 状态 */}
              <div className='w-17.5 flex-shrink-0'>
                <Tag color={getStatusColor(order.status)} size='small'>
                  {displayStatusText}
                </Tag>
              </div>
              {/* 创建时间 */}
              <div className='w-25 flex-shrink-0 text-12px text-t-tertiary'>{formatDateTime(order.created_at)}</div>
              {/* 操作 */}
              <div className='w-20 flex-shrink-0'>
                {order.status === OrderStatusEnum.PAYING && (
                  <Button type='primary' size='small' onClick={() => onContinuePay(order.order_no)}>
                    {t('settings.orders.continuePay') || '继续支付'}
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
