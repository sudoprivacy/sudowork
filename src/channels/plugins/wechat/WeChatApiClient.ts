/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BaseInfo, IWeChatGetConfigResponse, IWeChatGetUpdatesResponse, IWeChatQrCodeResponse, IWeChatQrStatusResponse, IWeChatSendMessagePayload, IWeChatSendTypingPayload } from './types';
import { WECHAT_API_BASE_URL, WECHAT_API_TIMEOUT_MS, WECHAT_CHANNEL_VERSION, WECHAT_LONG_POLL_TIMEOUT_MS } from './types';
import { decryptAesEcb, normalizeAesKey } from './WeChatCrypto';

/**
 * WeChatApiClient - HTTP client for iLink Bot API (protobuf-over-JSON).
 */
export class WeChatApiClient {
  private token: string;
  private baseUrl: string;

  constructor(token: string, baseUrl?: string) {
    this.token = token;
    this.baseUrl = (baseUrl || WECHAT_API_BASE_URL).replace(/\/+$/, '');
  }

  setToken(token: string): void {
    this.token = token;
  }

  private buildBaseInfo(): BaseInfo {
    return { channel_version: WECHAT_CHANNEL_VERSION };
  }

  /** Random X-WECHAT-UIN: uint32 -> decimal string -> base64 */
  private randomUin(): string {
    const uint32 = Math.floor(Math.random() * 0xffffffff);
    return Buffer.from(String(uint32), 'utf-8').toString('base64');
  }

  private getHeaders(body: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      AuthorizationType: 'ilink_bot_token',
      'Content-Length': String(Buffer.byteLength(body, 'utf-8')),
      'X-WECHAT-UIN': this.randomUin(),
    };
    if (this.token?.trim()) {
      headers.Authorization = `Bearer ${this.token.trim()}`;
    }
    return headers;
  }

  private async safeJson<T>(response: Response): Promise<T> {
    const text = await response.text();
    if (!text) {
      return { errcode: -1, errmsg: `Empty response (HTTP ${response.status})` } as T;
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      return { errcode: -1, errmsg: `Invalid JSON (HTTP ${response.status}): ${text.slice(0, 200)}` } as T;
    }
  }

  private async apiFetch<T>(endpoint: string, body: Record<string, unknown>, timeoutMs: number): Promise<T> {
    const url = `${this.baseUrl}/${endpoint}`;
    const bodyStr = JSON.stringify({ ...body, base_info: this.buildBaseInfo() });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(bodyStr),
        body: bodyStr,
        signal: controller.signal,
      });
      clearTimeout(timer);
      return await this.safeJson<T>(response);
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof Error && error.name === 'AbortError') {
        throw error;
      }
      return { errcode: -1, errmsg: `Fetch failed: ${error instanceof Error ? error.message : String(error)}` } as T;
    }
  }

  // ==================== QR Login (no auth) ====================

  async startQrLogin(): Promise<IWeChatQrCodeResponse> {
    const url = `${this.baseUrl}/ilink/bot/get_bot_qrcode?bot_type=3`;
    const response = await fetch(url, { method: 'GET' });
    return await this.safeJson<IWeChatQrCodeResponse>(response);
  }

  async pollQrStatus(qrcodeToken: string): Promise<IWeChatQrStatusResponse> {
    const url = `${this.baseUrl}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcodeToken)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WECHAT_LONG_POLL_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'iLink-App-ClientVersion': '1' },
        signal: controller.signal,
      });
      clearTimeout(timer);
      return await this.safeJson<IWeChatQrStatusResponse>(response);
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof Error && error.name === 'AbortError') {
        return { status: 'wait' };
      }
      throw error;
    }
  }

  // ==================== Authenticated API ====================

  async getUpdates(getUpdatesBuf?: string, signal?: AbortSignal): Promise<IWeChatGetUpdatesResponse> {
    const url = `${this.baseUrl}/ilink/bot/getupdates`;
    const body: Record<string, unknown> = {
      get_updates_buf: getUpdatesBuf || '',
      base_info: this.buildBaseInfo(),
    };
    const bodyStr = JSON.stringify(body);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WECHAT_LONG_POLL_TIMEOUT_MS + 10_000);
    if (signal) {
      signal.addEventListener('abort', () => controller.abort());
    }
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(bodyStr),
        body: bodyStr,
        signal: controller.signal,
      });
      clearTimeout(timer);
      return await this.safeJson<IWeChatGetUpdatesResponse>(response);
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof Error && error.name === 'AbortError') {
        if (signal?.aborted) throw error;
        // Client-side timeout is normal for long-poll
        return { ret: 0, msgs: [], get_updates_buf: getUpdatesBuf };
      }
      return { errcode: -1, errmsg: `getUpdates failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  async sendMessage(payload: IWeChatSendMessagePayload): Promise<void> {
    await this.apiFetch('ilink/bot/sendmessage', payload as unknown as Record<string, unknown>, WECHAT_API_TIMEOUT_MS);
  }

  async getConfig(userId: string, contextToken?: string): Promise<IWeChatGetConfigResponse> {
    const body: Record<string, unknown> = { ilink_user_id: userId };
    if (contextToken) {
      body.context_token = contextToken;
    }
    return await this.apiFetch<IWeChatGetConfigResponse>('ilink/bot/getconfig', body, WECHAT_API_TIMEOUT_MS);
  }

  async sendTyping(payload: IWeChatSendTypingPayload): Promise<void> {
    try {
      await this.apiFetch('ilink/bot/sendtyping', payload as unknown as Record<string, unknown>, WECHAT_API_TIMEOUT_MS);
    } catch {
      // Best-effort
    }
  }

  // ==================== Media Download ====================

  /**
   * Download a media file from a CDN URL, with optional AES-128-ECB decryption.
   *
   * WeChat CDN media files are typically AES-encrypted. When an AES key is provided,
   * the downloaded ciphertext is decrypted before being returned.
   *
   * @param url - The CDN download URL (full_url or constructed from encrypt_query_param)
   * @param aesKey - Optional AES key string for decryption
   * @param aesKeyIsHex - Whether the AES key is hex-encoded (ImageItem.aeskey) vs base64 (media.aes_key)
   * @returns The decrypted (or raw, if no key) binary data as a Buffer
   */
  async downloadMedia(url: string, aesKey?: string | null, aesKeyIsHex = false): Promise<Buffer> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WECHAT_LONG_POLL_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) {
        throw new Error(`Media download failed: HTTP ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      let data: Buffer = Buffer.from(arrayBuffer);

      // Decrypt if AES key is provided
      if (aesKey) {
        const keyBuffer = normalizeAesKey(aesKey, aesKeyIsHex);
        if (keyBuffer) {
          try {
            data = decryptAesEcb(data, keyBuffer);
          } catch (decryptError) {
            console.warn(`[WeChatApiClient] AES decryption failed, returning raw data:`, decryptError);
            // Return raw data as fallback — some media may not actually be encrypted
          }
        } else {
          console.warn(`[WeChatApiClient] Invalid AES key format, returning raw data`);
        }
      }

      return data;
    } catch (error) {
      clearTimeout(timer);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Media download timed out');
      }
      throw error;
    }
  }

  /**
   * Get the API base URL (used for CDN URL construction fallback).
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }
}
