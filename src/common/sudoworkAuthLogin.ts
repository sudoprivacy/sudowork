export type LoginSudoclawPayload = {
  sudorouterKey?: string;
  modelServiceUrl?: string;
  models: string[];
};

type LoginResponseData = {
  user?: Record<string, unknown>;
  sudorouter_key?: unknown;
  model_service_url?: unknown;
  models?: unknown;
  available_models?: unknown;
  model_list?: unknown;
  access_token?: unknown;
};

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean);
}

export function mergeLoginUserData(payload: unknown): Record<string, unknown> {
  const data = (payload && typeof payload === 'object' ? payload : {}) as { data?: LoginResponseData };
  const loginData = (data.data && typeof data.data === 'object' ? data.data : {}) as LoginResponseData;
  const loginUser = (loginData.user && typeof loginData.user === 'object' ? loginData.user : {}) as Record<string, unknown>;

  const sudorouterKey = asNonEmptyString(loginData.sudorouter_key);
  const modelServiceUrl = asNonEmptyString(loginData.model_service_url);
  const directModels = asStringArray(loginData.models);
  const availableModels = asStringArray(loginData.available_models);
  const fallbackModels = asStringArray(loginData.model_list);
  const models = directModels.length ? directModels : availableModels.length ? availableModels : fallbackModels;

  return {
    ...loginUser,
    ...(sudorouterKey ? { sudorouter_key: sudorouterKey } : {}),
    ...(modelServiceUrl ? { model_service_url: modelServiceUrl } : {}),
    ...(models.length ? { models } : {}),
  };
}

export function extractLoginSudoclawPayload(payload: unknown): LoginSudoclawPayload | null {
  const mergedUser = mergeLoginUserData(payload);
  const sudorouterKey = asNonEmptyString(mergedUser.sudorouter_key);
  const modelServiceUrl = asNonEmptyString(mergedUser.model_service_url);
  const models = asStringArray(mergedUser.models);

  if (!sudorouterKey || !modelServiceUrl || models.length === 0) {
    return null;
  }

  return {
    sudorouterKey,
    modelServiceUrl,
    models,
  };
}
