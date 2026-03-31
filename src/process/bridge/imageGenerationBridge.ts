/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { DEFAULT_IMAGE_BASE_URL, DEFAULT_IMAGE_MODEL } from '../../common/storage';
import { ipcBridge } from '../../common';
import { ProcessConfig } from '../initStorage';
import { SUDOCLAW_DIR } from '../services/sudoclaw/SudoclawInstallService';
const SUDOCLAW_CONFIG_PATH = path.join(SUDOCLAW_DIR, 'sudoclaw.json');

/**
 * Resolve baseUrl and apiKey for image generation.
 * Priority:
 * 1. User-configured imageGenerationModel (switch must be on)
 * 2. sudorouter provider in sudoclaw.json
 * 3. Any model.config provider whose baseUrl contains sudorouter.ai
 */
function readSudorouterCredentials(): { baseUrl: string; apiKey: string } | null {
  try {
    const raw = fsSync.readFileSync(SUDOCLAW_CONFIG_PATH, 'utf-8');
    const config = JSON.parse(raw) as { models?: { providers?: Record<string, { baseUrl?: string; apiKey?: string }> } };
    const sr = config?.models?.providers?.sudorouter;
    if (sr?.apiKey) {
      const baseUrl = (sr.baseUrl || DEFAULT_IMAGE_BASE_URL).replace(/\/+$/, '');
      return { baseUrl, apiKey: sr.apiKey };
    }
  } catch (e) {
    console.log('[ImageGen] sudoclaw.json read failed:', e instanceof Error ? e.message : String(e));
  }
  return null;
}

export async function resolveImageConfig(): Promise<{ baseUrl: string; apiKey: string; model: string } | null> {
  // 1. Switch is on: use user-selected model routed through sudorouter
  const imageModel = await ProcessConfig.get('tools.imageGenerationModel').catch((): null => null);
  if (imageModel?.switch && imageModel.useModel) {
    // Route user-selected model through sudorouter
    const sr = readSudorouterCredentials();
    if (sr) {
      return { baseUrl: sr.baseUrl, apiKey: sr.apiKey, model: imageModel.useModel };
    }
    // Fall back to model.config sudorouter provider
    const providers = (await ProcessConfig.get('model.config').catch((): null => null)) || [];
    for (const provider of providers) {
      if (provider.baseUrl?.includes('sudorouter.ai') && provider.apiKey) {
        const baseUrl = provider.baseUrl.replace(/\/+$/, '');
        console.log('[ImageGen] switch on, routing user model via model.config sudorouter:', imageModel.useModel);
        return { baseUrl, apiKey: provider.apiKey, model: imageModel.useModel };
      }
    }
  }

  // 2. Switch off or no model selected: try sudorouter from sudoclaw.json with default model
  const sr = readSudorouterCredentials();
  if (sr) {
    console.log('[ImageGen] using sudoclaw sudorouter with default model, baseUrl:', sr.baseUrl);
    return { baseUrl: sr.baseUrl, apiKey: sr.apiKey, model: DEFAULT_IMAGE_MODEL };
  }

  // 3. Fall back: any model.config provider with sudorouter.ai baseUrl
  const providers = (await ProcessConfig.get('model.config').catch((): null => null)) || [];
  console.log('[ImageGen] model.config providers:', providers.map((p) => ({ baseUrl: p.baseUrl, hasKey: !!p.apiKey })));
  for (const provider of providers) {
    if (provider.baseUrl?.includes('sudorouter.ai') && provider.apiKey) {
      const baseUrl = provider.baseUrl.replace(/\/+$/, '');
      console.log('[ImageGen] using model.config sudorouter baseUrl:', baseUrl);
      return { baseUrl, apiKey: provider.apiKey, model: DEFAULT_IMAGE_MODEL };
    }
  }

  console.log('[ImageGen] no config found, returning null');
  return null;
}

/**
 * Save an image URL (data: or remote) to saveDir and return { imgUrl, relativePath }.
 */
export async function saveImageResult(imageUrl: string, saveDir: string): Promise<{ imgUrl: string; relativePath: string }> {
  const fileName = `image_${Date.now()}.png`;
  await fs.mkdir(saveDir, { recursive: true });
  const filePath = path.join(saveDir, fileName);

  if (!imageUrl.startsWith('data:')) {
    const imageResp = await fetch(imageUrl);
    const imageBuffer = Buffer.from(await imageResp.arrayBuffer());
    await fs.writeFile(filePath, imageBuffer);
  } else {
    const base64Data = imageUrl.replace(/^data:image\/\w+;base64,/, '');
    const imageBuffer = Buffer.from(base64Data, 'base64');
    await fs.writeFile(filePath, imageBuffer);
  }

  return { imgUrl: filePath, relativePath: fileName };
}

/**
 * Call /images/generations and return a data URL or remote URL of the generated image.
 */
export async function callImagesGenerations(baseUrl: string, apiKey: string, model: string, prompt: string, size: string, n: number): Promise<string> {
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
    return `data:image/png;base64,${item.b64_json}`;
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
export async function callImageEdits(baseUrl: string, apiKey: string, model: string, imagePath: string, prompt: string, size: string, n: number): Promise<string> {
  const endpoint = `${baseUrl}/images/edits`;
  console.log('[ImageGen] POST', endpoint, 'model:', model, 'prompt:', prompt.slice(0, 80));

  const formData = new FormData();
  const imageBuffer = await fs.readFile(imagePath);
  const imageBlob = new Blob([imageBuffer], { type: 'image/png' });
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
  if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
  if (item?.url) return item.url;

  throw new Error('Image edit returned no image data');
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
}
