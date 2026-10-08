export interface ModelMember {
  token_id: number;
  token_name?: string;
  unlimited: boolean;
  remaining_limit_usd: string | null;
  used_amount_usd: string;
  admin_status: 'enabled' | 'disabled';
  effective_status: string;
  key_masked: string | null;
}
export interface ModelAccount {
  mode: 'organization_shared';
  org_id: string;
  account_status: string;
  can_manage: boolean;
  can_recharge: boolean;
  model_balance_usd?: string;
  used_amount_usd?: string;
  member: ModelMember | null;
}
export interface ModelPackage {
  purchase_amount_usd: string;
  bonus_amount_usd: string;
  amount_cny_fen: number;
}
export interface ModelOnlineOrder extends ModelPackage {
  source?: 'online';
  payer_username?: string | null;
  payer_nickname?: string | null;
  payer_user_id?: string;
  reason?: string;
  order_no: string;
  org_id: string;
  payment_method: 'ALIPAY' | 'WECHAT';
  payment_status: 'pending' | 'paying' | 'paid' | 'cancelled';
  credit_status: 'pending' | 'sending' | 'credited' | 'needs_review';
  created_at: number;
  expires_at: number;
  payment_test_mode: boolean;
}
export interface ModelManualOrder {
  source: 'manual';
  order_no: string;
  org_id: string;
  purchase_amount_usd: string;
  bonus_amount_usd: string;
  amount_cny_fen: null;
  payment_method: null;
  payment_status: 'not_required';
  credit_status: 'pending' | 'sending' | 'credited' | 'failed' | 'needs_review';
  created_at: number;
  expires_at: null;
  payment_test_mode: false;
  payer_username: string | null;
  payer_nickname: string | null;
  payer_user_id: string;
  reason: string;
}
export type ModelOrder = ModelOnlineOrder | ModelManualOrder;
export function isPayableOrder(order: ModelOrder, now = Date.now()): order is ModelOnlineOrder {
  return order.source !== 'manual' && ['pending', 'paying'].includes(order.payment_status) && order.expires_at > now;
}
export interface ModelLog {
  id: string;
  model_name: string;
  created_at: number;
  amount_usd: string;
  input_tokens: number;
  output_tokens: number;
  duration?: number | null;
}
export function canRecharge(role?: string): boolean {
  return role === 'ENTERPRISE_ADMIN' || role === 'admin';
}
export function createModelBillingClient(baseUrl: string, authFetch: (url: string, options?: RequestInit) => Promise<Response>) {
  return async function request<T>(path: string, method = 'GET', body?: unknown, reference?: string): Promise<T> {
    const response = await authFetch(`${baseUrl.replace(/\/$/, '')}/api/v1/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(reference ? { 'Idempotency-Key': reference } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = (await response.json()) as { success: boolean; data: T; error?: { message?: string }; msg?: string };
    if (!response.ok || !result.success) throw new Error(result.error?.message || result.msg || `HTTP ${response.status}`);
    return result.data;
  };
}
