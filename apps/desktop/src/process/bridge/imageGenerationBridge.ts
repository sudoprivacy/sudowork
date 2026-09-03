/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { app } from 'electron';
import { getSudorouterBaseUrl, isSudorouterBaseUrl } from '../../common/systemConfig';
import { detectImageMimeType, IMAGE_TARGET_RAW_SIZE } from '@common/imageUtils';
import { parseCustomImageModelRef } from '../../common/scodeConfig';
import { ipcBridge } from '../../common';
import type { IBridgeResponse, ScodeConfig } from '../../common/ipcBridge';
import { ProcessConfig } from '../initStorage';
import { SUDOCLAW_DIR } from '../services/sudoclaw/SudoclawInstallService';
import { SCODE_DIR } from '../services/scode/ScodeInstallService';
const SUDOCLAW_CONFIG_PATH = path.join(SUDOCLAW_DIR, 'sudoclaw.json');
const SUDOCODE_CONFIG_PATH = path.join(SCODE_DIR, 'sudocode.json');

const GEMINI_IMAGE_GENERATION_MODELS = new Set(['gemini-3.1-flash-image', 'gemini-3-pro-image', 'gemini-2.5-flash-image']);

/**
 * Detect image MIME type and file extension from magic bytes.
 * Falls back to image/png for unknown formats (used in image generation context where input is always an image).
 */
function detectMimeType(buffer: Buffer | Uint8Array): { mime: string; ext: string } {
  return detectImageMimeType(buffer) ?? { mime: 'image/png', ext: 'png' };
}

/**
 * Detect MIME type from a raw base64 string (no data: prefix).
 */
function detectMimeTypeFromBase64(b64: string): { mime: string; ext: string } {
  const decoded = Buffer.from(b64.slice(0, 24), 'base64');
  return detectMimeType(decoded);
}

function stripProviderPrefix(model: string): string {
  return model.includes('/') ? model.split('/').pop()! : model;
}

function isGeminiImageGenerationModel(model: string): boolean {
  return GEMINI_IMAGE_GENERATION_MODELS.has(stripProviderPrefix(model));
}

function getGeminiGenerateContentEndpoint(baseUrl: string, model: string): string {
  const trimmedBaseUrl = baseUrl.replace(/\/+$/, '');
  const v1BetaBaseUrl = trimmedBaseUrl.endsWith('/v1') ? trimmedBaseUrl.replace(/\/v1$/, '/v1beta') : trimmedBaseUrl.endsWith('/v1beta') ? trimmedBaseUrl : `${trimmedBaseUrl}/v1beta`;

  return `${v1BetaBaseUrl}/models/${encodeURIComponent(stripProviderPrefix(model))}:generateContent`;
}

function getGeminiImageConfig(size: string): { aspectRatio: string; imageSize: string } {
  const match = size.match(/^(\d+)x(\d+)$/);
  if (!match) {
    return { aspectRatio: '1:1', imageSize: '1K' };
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { aspectRatio: '1:1', imageSize: '1K' };
  }

  const divisor = gcd(width, height);
  const aspectRatio = `${width / divisor}:${height / divisor}`;
  const imageSize = Math.max(width, height) > 1024 ? '2K' : '1K';

  return { aspectRatio, imageSize };
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
}

/**
 * Resolve baseUrl and apiKey for image generation.
 * Priority:
 * 1. User-configured imageGenerationModel (switch must be on)
 * 2. sudorouter provider in sudoclaw.json
 * 3. Any model.config provider whose baseUrl contains sudorouter.ai
 */
export function readSudorouterCredentials(): { baseUrl: string; apiKey: string } | null {
  // Priority: sudocode.json (new), fallback to sudoclaw.json (legacy)
  try {
    const raw = fsSync.readFileSync(SUDOCODE_CONFIG_PATH, 'utf-8');
    const config = JSON.parse(raw) as { auth_modes?: { proxy?: Record<string, { baseUrl?: string; apiKey?: string }> } };
    const sr = config?.auth_modes?.proxy?.sudorouter;
    if (sr?.apiKey) {
      const baseUrl = (sr.baseUrl || `${getSudorouterBaseUrl()}/v1`).replace(/\/+$/, '');
      return { baseUrl, apiKey: sr.apiKey };
    }
  } catch {
    // ignored
  }
  try {
    const raw = fsSync.readFileSync(SUDOCLAW_CONFIG_PATH, 'utf-8');
    const config = JSON.parse(raw) as { models?: { providers?: Record<string, { baseUrl?: string; apiKey?: string }> } };
    const sr = config?.models?.providers?.sudorouter;
    if (sr?.apiKey) {
      const baseUrl = (sr.baseUrl || `${getSudorouterBaseUrl()}/v1`).replace(/\/+$/, '');
      return { baseUrl, apiKey: sr.apiKey };
    }
  } catch (e) {
    console.log('[ImageGen] sudoclaw.json read failed:', e instanceof Error ? e.message : String(e));
  }
  return null;
}

export function readApiKeyProviderCredentials(providerId: string): { baseUrl: string; apiKey: string } | null {
  try {
    const raw = fsSync.readFileSync(SUDOCODE_CONFIG_PATH, 'utf-8');
    const config = JSON.parse(raw) as ScodeConfig;
    const provider = config.auth_modes?.['api-key']?.[providerId];
    const baseUrl = provider?.baseUrl?.trim();
    const apiKey = provider?.apiKey?.trim();
    if (baseUrl && apiKey) {
      return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey };
    }
  } catch {
    // ignored
  }
  return null;
}

export async function resolveImageConfig(): Promise<{ baseUrl: string; apiKey: string; model: string } | null> {
  // Primary: read image generation model from sudoclaw.json agents.defaults.imageGenerationModel
  let imageModelId: string | null = null;
  try {
    const raw = fsSync.readFileSync(SUDOCLAW_CONFIG_PATH, 'utf-8');
    const config = JSON.parse(raw);
    const imageModel = config?.agents?.defaults?.imageGenerationModel;
    const model = typeof imageModel === 'string' ? imageModel : imageModel?.primary;
    if (model && typeof model === 'string' && model.trim()) imageModelId = model;
  } catch {
    // ignored
  }

  // Fallback: ProcessConfig (before user has changed settings in this session)
  if (!imageModelId) {
    const imageModel = await ProcessConfig.get('tools.imageGenerationModel').catch((): null => null);
    if (!imageModel?.switch || !imageModel.useModel) {
      console.log('[ImageGen] image generation switch is off or no model selected');
      return null;
    }
    imageModelId = imageModel.useModel;
  }

  const customRef = parseCustomImageModelRef(imageModelId);
  if (customRef) {
    const externalCreds = readApiKeyProviderCredentials(customRef.providerId);
    if (externalCreds) {
      return { baseUrl: externalCreds.baseUrl, apiKey: externalCreds.apiKey, model: customRef.modelId };
    }
    console.log('[ImageGen] custom image provider credentials not found:', customRef.providerId);
  }

  // Route user-selected model through sudorouter
  const sr = readSudorouterCredentials();
  if (sr) {
    return { baseUrl: sr.baseUrl, apiKey: sr.apiKey, model: imageModelId };
  }

  // Fall back to model.config sudorouter provider
  const providers = (await ProcessConfig.get('model.config').catch((): null => null)) || [];
  for (const provider of providers) {
    if (isSudorouterBaseUrl(provider.baseUrl) && provider.apiKey) {
      const baseUrl = provider.baseUrl.replace(/\/+$/, '');
      console.log('[ImageGen] routing user model via model.config sudorouter:', imageModelId);
      return { baseUrl, apiKey: provider.apiKey, model: imageModelId };
    }
  }

  console.log('[ImageGen] no credentials found, returning null');
  return null;
}

/**
 * Save an image URL (data: or remote) to saveDir and return { imgUrl, relativePath }.
 */
export async function saveImageResult(imageUrl: string, saveDir: string): Promise<{ imgUrl: string; relativePath: string }> {
  await fs.mkdir(saveDir, { recursive: true });

  let imageBuffer: Buffer;
  if (!imageUrl.startsWith('data:')) {
    const imageResp = await fetch(imageUrl);
    imageBuffer = Buffer.from(await imageResp.arrayBuffer());
  } else {
    const base64Data = imageUrl.replace(/^data:image\/[\w+]+;base64,/, '');
    imageBuffer = Buffer.from(base64Data, 'base64');
  }

  const { ext } = detectMimeType(imageBuffer);
  const fileName = `image_${Date.now()}.${ext}`;
  const filePath = path.join(saveDir, fileName);
  await fs.writeFile(filePath, imageBuffer);

  return { imgUrl: filePath, relativePath: fileName };
}

async function callGeminiGenerateContentImage(baseUrl: string, apiKey: string, model: string, prompt: string, size: string, inlineImage?: { mimeType: string; data: string }): Promise<string> {
  const endpoint = getGeminiGenerateContentEndpoint(baseUrl, model);
  const imageConfig = getGeminiImageConfig(size);
  console.log('[ImageGen] POST', endpoint, 'model:', stripProviderPrefix(model), 'prompt:', prompt.slice(0, 80));

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [{ text: prompt }];
  if (inlineImage) {
    parts.push({ inlineData: inlineImage });
  }

  const body = JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig,
    },
  });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body,
  });

  console.log('[ImageGen] Gemini response status:', response.status);

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    console.log('[ImageGen] Gemini error body:', errText.slice(0, 200));
    throw new Error(`Gemini image generation API error ${response.status}: ${errText}`);
  }

  const json = (await response.json()) as {
    error?: { message?: string };
    candidates?: Array<{
      content?: {
        parts?: Array<{
          inlineData?: { mimeType?: string; data?: string };
          inline_data?: { mime_type?: string; data?: string };
        }>;
      };
    }>;
  };

  if (json.error) {
    throw new Error(`Gemini image generation API error: ${json.error.message || JSON.stringify(json.error)}`);
  }

  for (const candidate of json.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      const inlineData = part.inlineData;
      const inlineDataSnakeCase = part.inline_data;
      const data = inlineData?.data || inlineDataSnakeCase?.data;
      const mimeType = inlineData?.mimeType || inlineDataSnakeCase?.mime_type || 'image/png';
      if (data) {
        console.log('[ImageGen] Gemini got inlineData, length:', data.length);
        return `data:${mimeType};base64,${data}`;
      }
    }
  }

  throw new Error('Gemini image generation returned no image data');
}

/**
 * Call the configured image-generation endpoint and return a data URL or remote URL of the generated image.
 */
export async function callImagesGenerations(baseUrl: string, apiKey: string, model: string, prompt: string, size: string, n: number): Promise<string> {
  if (isGeminiImageGenerationModel(model)) {
    return callGeminiGenerateContentImage(baseUrl, apiKey, model, prompt, size);
  }

  const endpoint = `${baseUrl}/images/generations`;
  console.log('[ImageGen] POST', endpoint, 'model:', model, 'prompt:', prompt.slice(0, 80));

  const body = JSON.stringify({ model, prompt, size, n });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body,
  });

  console.log('[ImageGen] response status:', response.status);

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    console.log('[ImageGen] error body:', errText.slice(0, 200));
    throw new Error(`Image generation API error ${response.status}: ${errText}`);
  }

  const json = (await response.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const item = json?.data?.[0];
  if (item?.b64_json) {
    console.log('[ImageGen] got b64_json, length:', item.b64_json.length);
    const { mime } = detectMimeTypeFromBase64(item.b64_json);
    return `data:${mime};base64,${item.b64_json}`;
  }
  if (item?.url) {
    console.log('[ImageGen] got url:', item.url.slice(0, 80));
    return item.url;
  }

  throw new Error('Image generation returned no image data');
}

/**
 * Call /images/edits and return a data URL or remote URL of the edited image.
 */
export async function callImagesEdits(baseUrl: string, apiKey: string, model: string, imagePath: string, prompt: string, size: string, n: number): Promise<string> {
  if (isGeminiImageGenerationModel(model)) {
    const imageBuffer = await fs.readFile(imagePath);
    const { mime } = detectMimeType(imageBuffer);
    return callGeminiGenerateContentImage(baseUrl, apiKey, model, prompt, size, {
      mimeType: mime,
      data: imageBuffer.toString('base64'),
    });
  }

  const endpoint = `${baseUrl}/images/edits`;
  console.log('[ImageGen] POST', endpoint, 'model:', model, 'prompt:', prompt.slice(0, 80));

  const formData = new FormData();
  const imageBuffer = await fs.readFile(imagePath);
  const imageBlob = new Blob([imageBuffer], { type: detectMimeType(imageBuffer).mime });
  formData.append('image', imageBlob, path.basename(imagePath));
  formData.append('prompt', prompt);
  formData.append('model', model);
  formData.append('n', String(n));
  formData.append('size', size);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  console.log('[ImageGen] edits response status:', response.status);

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    console.log('[ImageGen] edits error body:', errText.slice(0, 200));
    throw new Error(`Image edit API error ${response.status}: ${errText}`);
  }

  const json = (await response.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const item = json?.data?.[0];
  if (item?.b64_json) {
    const { mime } = detectMimeTypeFromBase64(item.b64_json);
    return `data:${mime};base64,${item.b64_json}`;
  }
  if (item?.url) return item.url;

  throw new Error('Image edit returned no image data');
}

/**
 * Resolve the current chat model from sudoclaw.json (agents.defaults.model.primary).
 * Returns null if not configured.
 */
export function resolveChatModel(): string | null {
  try {
    const raw = fsSync.readFileSync(SUDOCLAW_CONFIG_PATH, 'utf-8');
    const config = JSON.parse(raw) as { agents?: { defaults?: { model?: { primary?: string } } } };
    let model = config?.agents?.defaults?.model?.primary;
    if (!model) return null;
    // Strip provider prefix (e.g. "sudorouter-gemini-3-pro/gemini-3-pro" → "gemini-3-pro")
    if (model.includes('/')) {
      model = model.split('/').pop()!;
    }
    return model;
  } catch (e) {
    console.log('[ImageAnalyze] sudoclaw.json read failed:', e instanceof Error ? e.message : String(e));
    return null;
  }
}

/**
 * Call /chat/completions with a base64-encoded image for analysis/understanding.
 */
export async function callChatCompletionsWithImageBase64(baseUrl: string, apiKey: string, model: string, base64Data: string, mimeType: string, prompt: string): Promise<string> {
  let effectiveBase64 = base64Data;
  let effectiveMimeType = mimeType;

  try {
    const rawBuffer = Buffer.from(base64Data, 'base64');
    if (rawBuffer.length > IMAGE_TARGET_RAW_SIZE) {
      const { resizeImageForContext } = await import('@/common/imageUtils');
      const result = await resizeImageForContext(rawBuffer);
      if (result.buffer.length < rawBuffer.length) {
        effectiveBase64 = result.buffer.toString('base64');
        effectiveMimeType = result.mediaType;
        console.log('[ImageAnalyze] resized image from', rawBuffer.length, 'to', result.buffer.length, 'bytes for', model);
      }
    }
  } catch (resizeErr) {
    console.log('[ImageAnalyze] image resize skipped:', resizeErr instanceof Error ? resizeErr.message : String(resizeErr));
  }

  const endpoint = `${baseUrl}/chat/completions`;
  console.log('[ImageAnalyze] POST', endpoint, 'model:', model, 'image: (base64)', 'mime:', effectiveMimeType);
  console.log('[ImageAnalyze] prompt:', prompt.slice(0, 80));

  const body = JSON.stringify({
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${effectiveMimeType};base64,${effectiveBase64}` } },
        ],
      },
    ],
  });

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body,
  });

  console.log('[ImageAnalyze] response status:', response.status);

  if (!response.ok) {
    const errText = await response.text().catch(() => response.statusText);
    console.log('[ImageAnalyze] error body:', errText.slice(0, 200));
    throw new Error(`Image analysis API error ${response.status}: ${errText}`);
  }

  const json = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = json?.choices?.[0]?.message?.content;
  console.log('[ImageAnalyze] response content length:', content?.length ?? 0);

  if (!content) {
    throw new Error('Image analysis returned no content');
  }

  return content;
}

/**
 * Call /chat/completions with an image for analysis/understanding.
 */
export async function callChatCompletionsWithImage(baseUrl: string, apiKey: string, model: string, imagePath: string, prompt: string): Promise<string> {
  const imageBuffer = await fs.readFile(imagePath);
  const { mime } = detectMimeType(imageBuffer);
  const b64 = imageBuffer.toString('base64');
  console.log('[ImageAnalyze] POST', `${baseUrl}/chat/completions`, 'model:', model, 'image:', imagePath, 'size:', imageBuffer.length, 'mime:', mime);

  return callChatCompletionsWithImageBase64(baseUrl, apiKey, model, b64, mime, prompt);
}

/**
 * Generate a user-center avatar image.
 * Reuses readSudorouterCredentials / callImagesGenerations / saveImageResult.
 * Unlike generateImage, this does NOT emit any tool_group message into a conversation.
 */
async function generateUserAvatar({ prompt }: { prompt: string }): Promise<IBridgeResponse<{ localPath: string; dataUrl: string }>> {
  try {
    const config = await resolveImageConfig();
    if (!config) {
      return { success: false, msg: '图像生成功能尚未配置，无法生成头像' };
    }

    const imageUrl = await callImagesGenerations(config.baseUrl, config.apiKey, config.model, prompt, '1024x1024', 1);

    const saveDir = path.join(app.getPath('userData'), 'user-avatars');
    const saved = await saveImageResult(imageUrl, saveDir);

    // b64_json 路径返回的已是带前缀的 dataURL，直接透传；remote URL 路径则读盘转 dataURL
    let dataUrl: string;
    if (imageUrl.startsWith('data:')) {
      dataUrl = imageUrl;
    } else {
      const buf = await fs.readFile(saved.imgUrl);
      const mime = detectMimeType(buf).mime;
      dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
    }

    return { success: true, data: { localPath: saved.imgUrl, dataUrl } };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[generateUserAvatar]', msg);
    return { success: false, msg };
  }
}

export function initImageGenerationBridge(): void {
  ipcBridge.tools.generateImage.provider(async ({ prompt, conversation_id, workspace, size = '1024x1024', n = 1 }) => {
    try {
      const config = await resolveImageConfig();
      if (!config) {
        return { success: false, msg: '未找到可用的图像生成模型配置，请在工具设置中配置图像模型。' };
      }

      const imageUrl = await callImagesGenerations(config.baseUrl, config.apiKey, config.model, prompt, size, n);
      const { imgUrl, relativePath } = await saveImageResult(imageUrl, workspace || '.');

      // Emit tool_group message with ImageGeneration result
      const msg_id = `img-gen-${Date.now()}`;
      ipcBridge.conversation.responseStream.emit({
        type: 'tool_group',
        conversation_id,
        msg_id,
        data: [
          {
            callId: msg_id,
            name: 'ImageGeneration',
            description: prompt,
            renderOutputAsMarkdown: false,
            status: 'Success',
            resultDisplay: { img_url: imgUrl, relative_path: relativePath },
          },
        ],
      });

      return { success: true, data: { img_url: imgUrl, relative_path: relativePath } };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[ImageGenerationBridge]', msg);
      return { success: false, msg };
    }
  });

  ipcBridge.tools.generateUserAvatar.provider(generateUserAvatar);
}
