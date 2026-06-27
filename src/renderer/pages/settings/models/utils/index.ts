import type { ScodeConfig, ScodeModelEntry } from '@/common/ipcBridge';
import type { EditableModel, ProviderRow } from '../types';

/** 添加/编辑模型对话框中内置的提供商预设列表 */
export const PROVIDER_PRESETS = [
  { label: '智谱 Coding Plan / GLM Coding Plan', value: 'zhipu-coding-plan', providerId: 'zhipu-coding-plan', baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4', apiKeyRequired: true },
  { label: 'Kimi Coding Plan', value: 'kimi-coding-plan', providerId: 'kimi-coding-plan', baseUrl: 'https://api.moonshot.cn/v1', apiKeyRequired: true },
  { label: '智谱开放平台 / GLM API', value: 'zhipu-glm', providerId: 'zhipu-glm', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKeyRequired: true },
  { label: 'Kimi 中国版 / Kimi China', value: 'kimi-china', providerId: 'kimi-china', baseUrl: 'https://api.moonshot.cn/v1', apiKeyRequired: true },
  { label: 'MiniMax 中国版 / MiniMax China', value: 'minimax-china', providerId: 'minimax-china', baseUrl: 'https://api.minimax.chat/v1', apiKeyRequired: true },
  { label: '深度求索 / DeepSeek', value: 'deepseek', providerId: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', apiKeyRequired: true },
  { label: 'Ollama 本地 / Ollama', value: 'ollama', providerId: 'ollama', baseUrl: 'http://localhost:11434/v1', apiKeyRequired: false },
  { label: '自定义 / Custom', value: 'custom', providerId: 'custom-openai', baseUrl: '', apiKeyRequired: true },
];

/**
 * 从模型条目中获取指定认证模式下的 provider ID。
 * @param entry - 模型条目
 * @param mode - 认证模式：`'proxy'` 或 `'api-key'`
 */
export function getEntryProvider(entry: ScodeModelEntry | undefined, mode: 'proxy' | 'api-key'): string | undefined {
  return entry?.providers?.[mode]?.provider;
}

/**
 * 从 sudocode 配置中派生出页面展示所需的行数据。
 * 将 sudorouter 模型与第三方 api-key 提供商分开返回。
 * @param config - sudocode 配置，未加载时传 `null`
 */
export function buildProviderRows(config: ScodeConfig | null): { sudorouterModels: string[]; customProviders: ProviderRow[] } {
  const models = config?.models || {};
  const apiKeyProviders = config?.auth_modes?.['api-key'] || {};
  const rows = new Map<string, ProviderRow>();
  const sudorouterModels: string[] = [];

  for (const [providerId, provider] of Object.entries(apiKeyProviders)) {
    rows.set(providerId, {
      id: providerId,
      baseUrl: provider.baseUrl || '',
      apiKey: provider.apiKey || '',
      modelIds: [],
    });
  }

  for (const [alias, entry] of Object.entries(models)) {
    const proxyProvider = getEntryProvider(entry, 'proxy');
    if (proxyProvider === 'sudorouter') {
      sudorouterModels.push(entry.alias || alias);
    }

    const apiKeyProvider = getEntryProvider(entry, 'api-key');
    if (apiKeyProvider) {
      const row =
        rows.get(apiKeyProvider) ||
        ({
          id: apiKeyProvider,
          baseUrl: '',
          apiKey: '',
          modelIds: [],
        } satisfies ProviderRow);
      row.modelIds.push(entry.alias || alias);
      rows.set(apiKeyProvider, row);
    }
  }

  return {
    sudorouterModels,
    customProviders: Array.from(rows.values()).sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/**
 * 对密钥字符串做脱敏处理，用于安全展示。
 * 短字符串保留前 2 位，长字符串保留前 6 位和后 4 位。
 * @param value - 原始密钥字符串
 */
export function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 10) return `${value.slice(0, 2)}******`;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

/**
 * 将用户输入的 provider ID 规范化为小写 slug。
 * 去除首尾空白、转小写，并将不合法字符替换为连字符。
 * @param value - 原始输入字符串
 */
export function sanitizeProviderId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * 将输入/输出上下文窗口大小格式化为可读的标签文本。
 * @param input - 输入上下文大小（K tokens）
 * @param output - 输出上下文大小（K tokens）
 * @param defaultText - 值缺失时的占位文本
 */
export function contextLabel(input?: number, output?: number, defaultText = '默认'): string {
  const inputText = input ? `${input}K` : defaultText;
  const outputText = output ? `${output}K` : defaultText;
  return `${inputText} / ${outputText}`;
}

/**
 * 按 alias 或 key 从配置中查找模型条目。
 * @param config - sudocode 配置
 * @param modelId - 要查找的模型 alias 或配置 key
 */
export function findModelEntry(config: ScodeConfig | null, modelId: string): ScodeModelEntry | undefined {
  return config?.models?.[modelId] || Object.values(config?.models || {}).find((entry) => entry.alias === modelId);
}

/**
 * 返回配置中所有模型的 alias 列表。
 * @param config - sudocode 配置
 */
export function getConfiguredModelIds(config: ScodeConfig | null): string[] {
  return Object.entries(config?.models || {}).map(([alias, entry]) => entry.alias || alias);
}

/**
 * 为已有的提供商行匹配对应的预设值。
 * 没有匹配项时回退到 `'custom'`。
 * @param provider - 要匹配的提供商行
 */
export function presetValueForProvider(provider?: ProviderRow): string {
  if (!provider) return 'custom';
  return PROVIDER_PRESETS.find((item) => item.providerId === provider.id && (!item.baseUrl || item.baseUrl === provider.baseUrl))?.value || 'custom';
}

/**
 * 从配置条目构建编辑表单所需的 `EditableModel` 对象。
 * @param config - sudocode 配置
 * @param modelId - 模型 alias 或配置 key
 */
export function editableModelFromEntry(config: ScodeConfig | null, modelId: string): EditableModel {
  const entry = findModelEntry(config, modelId);
  const providerModelId = entry?.providers?.['api-key']?.model || modelId;
  return {
    id: providerModelId,
    name: entry?.name || providerModelId,
    input: entry?.input,
    supportsTools: entry?.supports_tools,
    supportsReasoning: entry?.supports_reasoning,
    inputContext: entry?.context?.input,
    outputContext: entry?.context?.output,
  };
}

/**
 * 在模型重命名或删除后，同步更新 `default_model` 字段。
 * - 若默认模型被重命名，则更新为新 alias；
 * - 若默认模型已不存在，则删除该字段。
 * @param config - 需要处理的 sudocode 配置
 * @param previousModelId - 变更前的模型 alias
 * @param nextModelId - 变更后的模型 alias
 */
export function normalizeDefaultModel(config: ScodeConfig, previousModelId?: string, nextModelId?: string): ScodeConfig {
  if (previousModelId && nextModelId && config.default_model === previousModelId && config.models?.[nextModelId]) {
    return { ...config, default_model: nextModelId };
  }
  if (config.default_model && !config.models?.[config.default_model]) {
    const nextConfig = { ...config };
    delete nextConfig.default_model;
    return nextConfig;
  }
  return config;
}
