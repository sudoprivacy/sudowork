/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProvider, ModelType } from '@sudowork/common/storage';

/**
 * 能力匹配的正则表达式 - 参考 Cherry Studio 的做法
 */
const CAPABILITY_PATTERNS: Record<ModelType, RegExp> = {
  text: /gpt|claude|gemini|qwen|llama|mistral|deepseek/i,
  vision: /4o|claude-3|gemini-.*-pro|gemini-.*-flash|gemini-2\.0|qwen-vl|llava|vision/i,
  function_calling: /gpt-4|claude-3|gemini|qwen|deepseek/i,
  image_generation: /flux|diffusion|stabilityai|sd-|dall|cogview|janus|midjourney|mj-|imagen/i,
  web_search: /search|perplexity/i,
  reasoning: /o1-|reasoning|think/i,
  embedding: /(?:^text-|embed|bge-|e5-|LLM2Vec|retrieval|uae-|gte-|jina-clip|jina-embeddings|voyage-)/i,
  rerank: /(?:rerank|re-rank|re-ranker|re-ranking|retrieval|retriever)/i,
  excludeFromPrimary: /dall-e|flux|stable-diffusion|midjourney|flash-image|image|embed|rerank/i, // 要排除的主力模型
};

/**
 * 明确不支持某些能力的模型列表 - 黑名单
 */
const CAPABILITY_EXCLUSIONS: Record<ModelType, RegExp[]> = {
  text: [],
  vision: [/embed|rerank|dall-e|flux|stable-diffusion/i],
  function_calling: [/aqa(?:-[\\w-]+)?/i, /imagen(?:-[\\w-]+)?/i, /o1-mini/i, /o1-preview/i, /gemini-1(?:\\.[\\w-]+)?/i, /dall-e/i, /embed/i, /rerank/i],
  image_generation: [],
  web_search: [],
  reasoning: [],
  embedding: [],
  rerank: [],
  excludeFromPrimary: [],
};

/**
 * 获取模型名称的小写基础版本（用于匹配）
 * @param modelName - 原始模型名称
 * @returns 清理后的小写模型名称
 */
const getBaseModelName = (modelName: string): string => {
  return modelName
    .toLowerCase()
    .replace(/[^a-z0-9./-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
};

/**
 * 判断平台下的具体模型是否具有某个能力
 * @param platformModel - 平台配置
 * @param modelName - 具体模型名
 * @param type - 能力类型
 */
export const hasSpecificModelCapability = (platformModel: IProvider, modelName: string, type: ModelType): boolean | undefined => {
  const baseModelName = getBaseModelName(modelName);
  const exclusions = CAPABILITY_EXCLUSIONS[type];
  const pattern = CAPABILITY_PATTERNS[type];

  // 统一逻辑：先检查黑名单，再检查白名单
  const isExcluded = exclusions.some((excludePattern) => excludePattern.test(baseModelName));
  if (isExcluded) return false;

  // 检查白名单
  return pattern.test(baseModelName) ? true : undefined;
};
