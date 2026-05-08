/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createReadStream, statSync } from 'node:fs';
import { basename } from 'node:path';

/**
 * Thin HTTP client for WeCom 自建应用 (qyapi.weixin.qq.com).
 *
 * Provides:
 *   - access_token cache + refresh
 *   - message/send (text, markdown, image, file, voice, video, template_card)
 *   - media/upload (multipart)
 *   - media/get (download)
 *   - oa/applyevent (create approval), oa/getapprovaldetail
 *
 * Docs:
 *   - access_token: https://developer.work.weixin.qq.com/document/path/91039
 *   - send:        https://developer.work.weixin.qq.com/document/path/90236
 *   - upload:      https://developer.work.weixin.qq.com/document/path/90253
 *   - applyevent:  https://developer.work.weixin.qq.com/document/path/91853
 */

const QYAPI_BASE = 'https://qyapi.weixin.qq.com';

export interface WeComAppClientOptions {
  corpId: string;
  agentId: string;
  appSecret: string;
  /** Optional override base URL (for testing). */
  baseUrl?: string;
  /** Network timeout in milliseconds. */
  timeoutMs?: number;
}

export interface WeComSendTextParams {
  touser?: string;
  toparty?: string;
  totag?: string;
  content: string;
}

export interface WeComSendMarkdownParams {
  touser?: string;
  toparty?: string;
  totag?: string;
  content: string;
}

export interface WeComSendMediaParams {
  touser?: string;
  toparty?: string;
  totag?: string;
  mediaId: string;
}

export interface WeComSendTemplateCardParams {
  touser?: string;
  toparty?: string;
  totag?: string;
  templateCard: Record<string, unknown>;
}

export interface WeComSendResult {
  errcode: number;
  errmsg: string;
  msgid?: string;
  response_code?: string;
  invaliduser?: string;
  invalidparty?: string;
  invalidtag?: string;
}

export interface WeComUploadResult {
  errcode: number;
  errmsg: string;
  type?: string;
  media_id?: string;
  created_at?: string;
}

export type WeComMediaType = 'image' | 'voice' | 'video' | 'file';

export interface ApprovalApplyParams {
  creator_userid: string;
  template_id: string;
  use_template_approver?: 0 | 1;
  choose_department?: number;
  approver?: Array<{ attr: number; userid: string[] }>;
  notifyer?: string[];
  notify_type?: 1 | 2 | 3;
  apply_nickname?: string;
  apply_data: Record<string, unknown>;
  summary_list: Array<{ summary_info: Array<{ text: string; lang: string }> }>;
}

/**
 * Error raised when qyapi returns a non-zero `errcode`.
 */
export class WeComApiError extends Error {
  constructor(
    public readonly errcode: number,
    public readonly errmsg: string,
    public readonly endpoint: string,
  ) {
    super(`[WeCom ${endpoint}] ${errcode}: ${errmsg}`);
    this.name = 'WeComApiError';
  }
}

export class WeComAppClient {
  private readonly corpId: string;
  private readonly agentId: string;
  private readonly appSecret: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  private cachedToken?: { token: string; expiresAt: number };

  constructor(opts: WeComAppClientOptions) {
    this.corpId = opts.corpId;
    this.agentId = opts.agentId;
    this.appSecret = opts.appSecret;
    this.baseUrl = opts.baseUrl ?? QYAPI_BASE;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  getAgentId(): string {
    return this.agentId;
  }

  getCorpId(): string {
    return this.corpId;
  }

  /**
   * Fetch access_token, using an in-memory cache with ~10min safety margin.
   */
  async getAccessToken(force = false): Promise<string> {
    const now = Date.now();
    if (!force && this.cachedToken && this.cachedToken.expiresAt - 60_000 > now) {
      return this.cachedToken.token;
    }
    const url = `${this.baseUrl}/cgi-bin/gettoken?corpid=${encodeURIComponent(this.corpId)}&corpsecret=${encodeURIComponent(this.appSecret)}`;
    const res = await this.fetchJson<{ errcode: number; errmsg: string; access_token?: string; expires_in?: number }>(url, {
      method: 'GET',
    }, 'gettoken');
    if (!res.access_token) {
      throw new WeComApiError(res.errcode ?? -1, res.errmsg || 'no token returned', 'gettoken');
    }
    this.cachedToken = {
      token: res.access_token,
      expiresAt: now + (res.expires_in ?? 7200) * 1000,
    };
    return res.access_token;
  }

  /**
   * Validate credentials by fetching a fresh access_token. Used by `testConnection`.
   */
  async testConnection(): Promise<void> {
    await this.getAccessToken(true);
  }

  async sendText(params: WeComSendTextParams): Promise<WeComSendResult> {
    return this.sendMessage({
      ...this.recipientFields(params),
      msgtype: 'text',
      agentid: Number(this.agentId),
      text: { content: params.content },
      safe: 0,
    });
  }

  async sendMarkdown(params: WeComSendMarkdownParams): Promise<WeComSendResult> {
    return this.sendMessage({
      ...this.recipientFields(params),
      msgtype: 'markdown',
      agentid: Number(this.agentId),
      markdown: { content: params.content },
    });
  }

  async sendImage(params: WeComSendMediaParams): Promise<WeComSendResult> {
    return this.sendMessage({
      ...this.recipientFields(params),
      msgtype: 'image',
      agentid: Number(this.agentId),
      image: { media_id: params.mediaId },
      safe: 0,
    });
  }

  async sendFile(params: WeComSendMediaParams): Promise<WeComSendResult> {
    return this.sendMessage({
      ...this.recipientFields(params),
      msgtype: 'file',
      agentid: Number(this.agentId),
      file: { media_id: params.mediaId },
      safe: 0,
    });
  }

  async sendVoice(params: WeComSendMediaParams): Promise<WeComSendResult> {
    return this.sendMessage({
      ...this.recipientFields(params),
      msgtype: 'voice',
      agentid: Number(this.agentId),
      voice: { media_id: params.mediaId },
    });
  }

  async sendTemplateCard(params: WeComSendTemplateCardParams): Promise<WeComSendResult> {
    return this.sendMessage({
      ...this.recipientFields(params),
      msgtype: 'template_card',
      agentid: Number(this.agentId),
      template_card: params.templateCard,
    });
  }

  /**
   * Upload a local file as a temporary media asset. Returns the media_id.
   * Media is valid on WeCom servers for ~3 days.
   */
  async uploadMedia(type: WeComMediaType, filePath: string, fileName?: string): Promise<string> {
    const token = await this.getAccessToken();
    const url = `${this.baseUrl}/cgi-bin/media/upload?access_token=${encodeURIComponent(token)}&type=${type}`;

    const name = fileName ?? basename(filePath);
    const stat = statSync(filePath);
    const form = new FormData();
    // Node's undici FormData accepts Blob; we use a Blob built from the file stream buffer.
    // For simplicity + correctness we read the file into a Buffer (WeCom media limit is 20MB-100MB).
    const fileBuf = await streamToBuffer(createReadStream(filePath));
    // Copy into a fresh ArrayBuffer so the BlobPart type is ArrayBuffer (not SharedArrayBuffer-compatible).
    const ab = new ArrayBuffer(fileBuf.byteLength);
    new Uint8Array(ab).set(fileBuf);
    const blob = new Blob([ab]);
    form.append('media', blob, name);
    void stat; // size is optional; some WeCom clients require `filelength` header but fetch sets Content-Length from Blob

    const res = await this.fetchJson<WeComUploadResult>(url, {
      method: 'POST',
      body: form,
    }, 'media/upload');

    if (!res.media_id) {
      throw new WeComApiError(res.errcode ?? -1, res.errmsg || 'upload failed', 'media/upload');
    }
    return res.media_id;
  }

  /**
   * Download a previously-uploaded media asset. Returns the raw bytes.
   */
  async downloadMedia(mediaId: string): Promise<Buffer> {
    const token = await this.getAccessToken();
    const url = `${this.baseUrl}/cgi-bin/media/get?access_token=${encodeURIComponent(token)}&media_id=${encodeURIComponent(mediaId)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { method: 'GET', signal: controller.signal });
      if (!res.ok) {
        throw new WeComApiError(res.status, `HTTP ${res.status}`, 'media/get');
      }
      const contentType = res.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const body = (await res.json()) as { errcode?: number; errmsg?: string };
        throw new WeComApiError(body.errcode ?? -1, body.errmsg ?? 'media/get error', 'media/get');
      }
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Create an approval (审批) application. Returns the sp_no.
   */
  async createApproval(params: ApprovalApplyParams): Promise<string> {
    const token = await this.getAccessToken();
    const url = `${this.baseUrl}/cgi-bin/oa/applyevent?access_token=${encodeURIComponent(token)}`;
    const res = await this.fetchJson<{ errcode: number; errmsg: string; sp_no?: string }>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }, 'oa/applyevent');
    if (!res.sp_no) {
      throw new WeComApiError(res.errcode ?? -1, res.errmsg || 'no sp_no returned', 'oa/applyevent');
    }
    return res.sp_no;
  }

  /**
   * Fetch approval detail by sp_no. The returned `info` field is opaquely
   * returned to callers — this method is a pass-through.
   */
  async getApprovalDetail(spNo: string): Promise<Record<string, unknown>> {
    const token = await this.getAccessToken();
    const url = `${this.baseUrl}/cgi-bin/oa/getapprovaldetail?access_token=${encodeURIComponent(token)}`;
    const res = await this.fetchJson<{ errcode: number; errmsg: string; info?: Record<string, unknown> }>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sp_no: spNo }),
    }, 'oa/getapprovaldetail');
    return res.info ?? {};
  }

  private async sendMessage(body: Record<string, unknown>): Promise<WeComSendResult> {
    const token = await this.getAccessToken();
    const url = `${this.baseUrl}/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`;
    return this.fetchJson<WeComSendResult>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, 'message/send');
  }

  private recipientFields(p: { touser?: string; toparty?: string; totag?: string }): Record<string, string> {
    const out: Record<string, string> = {};
    if (p.touser) out.touser = p.touser;
    if (p.toparty) out.toparty = p.toparty;
    if (p.totag) out.totag = p.totag;
    if (!out.touser && !out.toparty && !out.totag) {
      // Default to sending to all users of the agent if no recipient specified
      out.touser = '@all';
    }
    return out;
  }

  private async fetchJson<T extends { errcode?: number; errmsg?: string }>(
    url: string,
    init: RequestInit,
    endpoint: string,
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (!res.ok) {
        throw new WeComApiError(res.status, `HTTP ${res.status}`, endpoint);
      }
      const body = (await res.json()) as T;
      const errcode = body.errcode ?? 0;
      if (errcode !== 0) {
        // Auto-refresh on access_token expiry
        if ((errcode === 40014 || errcode === 42001) && endpoint !== 'gettoken') {
          this.cachedToken = undefined;
        }
        throw new WeComApiError(errcode, body.errmsg ?? 'unknown error', endpoint);
      }
      return body;
    } finally {
      clearTimeout(timer);
    }
  }
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
