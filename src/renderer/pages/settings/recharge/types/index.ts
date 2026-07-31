/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

export enum OrderStatusEnum {
  PENDING = 0,
  PAYING = 1,
  SUCCESS = 2,
  FAILED = 3,
  REFUNDED = 4,
  CANCELLED = 5,
}

export interface RechargePackage {
  amount: number;
  points: number;
  bonus: number;
  description: string;
  amount_cny: number;
  exchange_rate: number;
}

export interface CreateOrderResponse {
  order_no: string;
  amount_usd: number;
  amount_cny: number;
  points: number;
  quota: number;
  expired_at: string;
}

export interface PayOrderResponse {
  order_no: string;
  qr_code_url: string;
  order_info: string;
}

export interface OrderStatus {
  order_no: string;
  status: OrderStatusEnum;
  amount_usd: number;
  amount_cny: number;
  points: number;
  created_at: string;
  paid_at?: string;
}

export interface Order {
  order_no: string;
  amount_usd: number;
  amount_cny: number;
  points: number;
  status: OrderStatusEnum;
  status_text: string;
  payment_method: 'ALIPAY' | 'WECHAT';
  created_at: string;
}

export type RechargeStep = 'select' | 'loading' | 'paying' | 'success' | 'failed';

export type PaymentMethod = 'ALIPAY' | 'WECHAT';
