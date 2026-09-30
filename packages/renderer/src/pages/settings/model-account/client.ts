export interface ModelMember {
  token_id: number;
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
export interface ModelOrder extends ModelPackage {
  order_no: string;
  org_id: string;
  payment_method: 'ALIPAY' | 'WECHAT';
  payment_status: 'pending' | 'paying' | 'paid' | 'cancelled';
  credit_status: 'pending' | 'sending' | 'credited' | 'needs_review';
  created_at: number;
  expires_at: number;
  payment_test_mode: boolean;
}
export interface ModelLog {
  id: string;
  model_name: string;
  created_at: number;
  amount_usd: string;
  input_tokens: number;
  output_tokens: number;
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
