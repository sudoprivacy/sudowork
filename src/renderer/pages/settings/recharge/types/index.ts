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
  status: 0 | 1 | 2 | 3 | 4 | 5;
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
  status: number;
  status_text: string;
  payment_method: 'ALIPAY' | 'WECHAT';
  created_at: string;
}
