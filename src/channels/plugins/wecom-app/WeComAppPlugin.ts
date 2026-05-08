/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { IncomingMessage, ServerResponse } from 'node:http';

import type { BotInfo, IChannelPluginConfig, IUnifiedOutgoingMessage, PluginType } from '../../types';
import { getDataPath } from '../../../process/utils';
import { BasePlugin } from '../BasePlugin';
import { decryptCallback, encryptCallback, verifySignature } from './WeComAppCrypto';
import type { WeComAppCallbackXml } from './WeComAppAdapter';
import {
  encodeChatId,
  parseChatId,
  parseCallbackXml,
  splitMarkdown,
  toSendDescriptor,
  toUnifiedIncomingMessage,
  WECOM_APP_MSG_LIMIT,
} from './WeComAppAdapter';
import {
  buildApprovalCreatedCard,
  buildApprovalStatusCard,
  translateApprovalStatus,
  type ApprovalCardParams,
} from './WeComAppCards';
import { WeComAppClient, type ApprovalApplyParams } from './WeComAppClient';

/**
 * WeCom 自建应用 plugin.
 *
 * Unlike the existing WeCom AI-bot plugin (WebSocket), 自建应用 requires:
 *   - A publicly reachable HTTPS URL to receive callbacks (handled by the
 *     Express server route; see registerChannelCallbackRoutes).
 *   - access_token flow for outbound API calls.
 *
 * The plugin does not open its own network listener. It exposes a
 * `handleCallback(req, res)` method that the Express route calls.
 */
export class WeComAppPlugin extends BasePlugin {
  readonly type: PluginType = 'wecom-app';

  private client: WeComAppClient | null = null;

  // Credentials resolved in onInitialize
  private corpId = '';
  private agentId = '';
  private appSecret = '';
  private encodingAesKey = '';
  private callbackToken = '';

  private activeUsers: Set<string> = new Set();

  // sp_no -> chatId mapping so approval-change events can be routed back to
  // the conversation that initiated the approval.
  private approvalChatMap: Map<string, string> = new Map();

  // sha1(file) -> media_id cache with expiry. WeCom media_ids are valid for 3 days.
  private mediaCache: Map<string, { mediaId: string; expiresAt: number }> = new Map();
  private static readonly MEDIA_TTL_MS = 2.5 * 24 * 60 * 60 * 1000; // 2.5 days, safety margin

  private mediaDir: string | null = null;

  // ==================== Lifecycle ====================

  protected async onInitialize(config: IChannelPluginConfig): Promise<void> {
    const c = config.credentials ?? {};
    const corpId = (c.corpId as string | undefined) ?? '';
    const agentId = (c.agentId as string | undefined) ?? '';
    const appSecret = (c.appSecret as string | undefined) ?? '';
    const encodingAesKey = (c.encodingAesKey as string | undefined) ?? '';
    const callbackToken = (c.callbackToken as string | undefined) ?? '';

    if (!corpId || !agentId || !appSecret) {
      throw new Error('WeCom App credentials required: corpId, agentId, appSecret');
    }

    this.corpId = corpId;
    this.agentId = agentId;
    this.appSecret = appSecret;
    this.encodingAesKey = encodingAesKey;
    this.callbackToken = callbackToken;

    this.client = new WeComAppClient({ corpId, agentId, appSecret });
  }

  protected async onStart(): Promise<void> {
    if (!this.client) throw new Error('WeCom App client not initialized');
    // Validate credentials by fetching an access_token.
    await this.client.getAccessToken(true);
    console.log(`[WeComAppPlugin] Started for corpId=${this.corpId}, agentId=${this.agentId}`);
  }

  protected async onStop(): Promise<void> {
    this.activeUsers.clear();
    this.approvalChatMap.clear();
    this.mediaCache.clear();
    this.mediaDir = null;
    this.client = null;
  }

  getActiveUserCount(): number {
    return this.activeUsers.size;
  }

  getBotInfo(): BotInfo | null {
    if (!this.agentId) return null;
    return {
      id: this.agentId,
      displayName: 'WeCom App',
    };
  }

  // ==================== Callback (HTTP) ====================

  /**
   * Handle an inbound HTTP callback request from WeCom. Reads the raw XML body
   * (if POST), verifies the signature, decrypts the envelope, parses the
   * payload, and either (a) responds to the URL-verification handshake (GET),
   * or (b) routes the message / approval event.
   */
  async handleCallback(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const signature = url.searchParams.get('msg_signature') ?? '';
      const timestamp = url.searchParams.get('timestamp') ?? '';
      const nonce = url.searchParams.get('nonce') ?? '';
      const echostr = url.searchParams.get('echostr');

      // URL verification handshake (GET /callback?...&echostr=...)
      if (req.method === 'GET' && echostr) {
        const ok = verifySignature(signature, this.callbackToken, timestamp, nonce, echostr);
        if (!ok) {
          res.writeHead(401);
          res.end('signature mismatch');
          return;
        }
        // WeCom expects the decrypted echostr content back in the response body
        const { message } = decryptCallback(echostr, this.encodingAesKey, this.corpId);
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(message);
        return;
      }

      if (req.method !== 'POST') {
        res.writeHead(405);
        res.end('method not allowed');
        return;
      }

      const rawBody = await readRequestBody(req);
      const encryptMatch = rawBody.match(/<Encrypt>(?:<!\[CDATA\[)?([^<\]]+)(?:]]>)?<\/Encrypt>/);
      if (!encryptMatch) {
        res.writeHead(400);
        res.end('missing Encrypt');
        return;
      }
      const encrypt = encryptMatch[1];
      if (!verifySignature(signature, this.callbackToken, timestamp, nonce, encrypt)) {
        res.writeHead(401);
        res.end('signature mismatch');
        return;
      }

      const { message } = decryptCallback(encrypt, this.encodingAesKey, this.corpId);
      const xml = parseCallbackXml(message);

      // Respond 200 early — our processing is async and should not block WeCom's retry
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('success');

      await this.dispatchCallback(xml);
    } catch (error) {
      console.error('[WeComAppPlugin] handleCallback error:', error);
      try {
        res.writeHead(500);
        res.end('error');
      } catch {
        // response may already be written
      }
    }
  }

  private async dispatchCallback(xml: WeComAppCallbackXml): Promise<void> {
    if (xml.MsgType === 'event') {
      await this.handleEventCallback(xml);
      return;
    }

    // Chat message
    let mediaLocalPath: string | undefined;
    if (['image', 'voice', 'video', 'file'].includes(xml.MsgType) && xml.MediaId) {
      mediaLocalPath = await this.downloadMediaToLocal(xml.MediaId, xml.MsgType).catch((err): string | undefined => {
        console.warn(`[WeComAppPlugin] media download failed: ${err?.message ?? err}`);
        return undefined;
      });
    }

    const unified = toUnifiedIncomingMessage(xml, { mediaLocalPath });
    if (!unified) return;

    this.activeUsers.add(xml.FromUserName);
    await this.emitMessage(unified);
  }

  private async handleEventCallback(xml: WeComAppCallbackXml): Promise<void> {
    const event = (xml.Event as string | undefined) ?? '';
    // Support both sys_approval_change (legacy) and open_approval_change (new)
    if (event === 'sys_approval_change' || event === 'open_approval_change') {
      await this.handleApprovalChange(xml, event);
      return;
    }
    // Other events are ignored silently
  }

  private async handleApprovalChange(xml: WeComAppCallbackXml, eventName: string): Promise<void> {
    // Extract sp_no + status from either schema
    let spNo = '';
    let spStatus: string | number | undefined;
    const approvalInfo = (xml.ApprovalInfo ?? xml.ApprovalData ?? {}) as Record<string, unknown>;

    if (typeof approvalInfo === 'object' && approvalInfo !== null) {
      spNo =
        (approvalInfo.SpNo as string | undefined) ||
        (approvalInfo.sp_no as string | undefined) ||
        (approvalInfo.ThirdNo as string | undefined) ||
        '';
      spStatus =
        (approvalInfo.SpStatus as string | number | undefined) ||
        (approvalInfo.OpenSpStatus as string | number | undefined);
    }

    if (!spNo) {
      console.warn(`[WeComAppPlugin] approval event missing sp_no (event=${eventName})`);
      return;
    }

    const chatId = this.approvalChatMap.get(spNo);
    if (!chatId) {
      console.warn(`[WeComAppPlugin] no chatId mapped for approval ${spNo}; event dropped`);
      return;
    }

    const statusLabel = translateApprovalStatus(spStatus);
    const card = buildApprovalStatusCard({
      spNo,
      status: statusLabel,
      summary: `审批 ${spNo} 状态更新为：${statusLabel}`,
    });
    try {
      await this.sendTemplateCardToChat(chatId, card);
    } catch (error) {
      console.warn(`[WeComAppPlugin] failed to push status card for ${spNo}:`, error);
    }

    // Emit an action message so the agent can react
    await this.emitMessage({
      id: `approval-${spNo}-${Date.now()}`,
      platform: this.type,
      chatId,
      user: { id: 'wecom-app', displayName: 'WeCom Approval' },
      content: { type: 'action', text: `approval.status_changed:${statusLabel}` },
      action: {
        type: 'platform',
        name: 'approval.status_changed',
        params: { spNo, status: String(spStatus ?? ''), statusLabel, event: eventName },
      },
      timestamp: Date.now(),
      raw: xml,
    });
  }

  // ==================== Outbound messages ====================

  async sendMessage(chatId: string, message: IUnifiedOutgoingMessage): Promise<string> {
    if (!this.client) throw new Error('WeCom App client not initialized');
    const descriptor = toSendDescriptor(message);
    return this.sendByDescriptor(chatId, descriptor);
  }

  async editMessage(_chatId: string, _messageId: string, _message: IUnifiedOutgoingMessage): Promise<void> {
    // WeCom 自建应用 has no edit-message API. No-op to match Lark's fallback.
    return;
  }

  /**
   * Create a WeCom approval and emit a button_interaction card in the
   * conversation. Returns the sp_no. Public so it can be exposed via the
   * channel bridge / SystemActions as a tool.
   */
  async createApproval(chatId: string, params: ApprovalApplyParams, cardOverrides?: Partial<ApprovalCardParams>): Promise<string> {
    if (!this.client) throw new Error('WeCom App client not initialized');
    const spNo = await this.client.createApproval(params);
    this.approvalChatMap.set(spNo, chatId);

    const card = buildApprovalCreatedCard({
      spNo,
      summary: cardOverrides?.summary ?? flattenSummary(params.summary_list) ?? '审批已提交',
      templateName: cardOverrides?.templateName ?? params.apply_nickname,
      creator: cardOverrides?.creator ?? params.creator_userid,
      details: cardOverrides?.details,
      sourceDesc: cardOverrides?.sourceDesc,
    });

    try {
      await this.sendTemplateCardToChat(chatId, card);
    } catch (error) {
      console.warn(`[WeComAppPlugin] failed to push created-card for ${spNo}:`, error);
    }

    return spNo;
  }

  // ==================== Helpers ====================

  private async sendByDescriptor(chatId: string, descriptor: ReturnType<typeof toSendDescriptor>): Promise<string> {
    if (!this.client) throw new Error('WeCom App client not initialized');
    const { type, id } = parseChatId(chatId);
    if (type === 'group') {
      // WeCom 自建应用 does not have a direct group-chat send; group messages
      // are delivered via appchat/send. We do not support groups in v1.
      console.warn(`[WeComAppPlugin] group send not supported; skipping chatId=${chatId}`);
      return '';
    }
    const touser = id;

    switch (descriptor.kind) {
      case 'text': {
        const res = await this.client.sendText({ touser, content: descriptor.content });
        return res.msgid ?? '';
      }
      case 'markdown': {
        const chunks = splitMarkdown(descriptor.content, WECOM_APP_MSG_LIMIT);
        let lastMsgId = '';
        for (const chunk of chunks) {
          const res = await this.client.sendMarkdown({ touser, content: chunk });
          lastMsgId = res.msgid ?? lastMsgId;
        }
        return lastMsgId;
      }
      case 'image': {
        const localPath = await this.resolveToLocalPath(descriptor.source, descriptor.sourceKind);
        const mediaId = await this.getOrUploadMedia('image', localPath);
        const res = await this.client.sendImage({ touser, mediaId });
        return res.msgid ?? '';
      }
      case 'file': {
        const localPath = await this.resolveToLocalPath(descriptor.source, descriptor.sourceKind);
        const mediaId = await this.getOrUploadMedia('file', localPath, descriptor.fileName);
        const res = await this.client.sendFile({ touser, mediaId });
        return res.msgid ?? '';
      }
      case 'template_card': {
        const res = await this.client.sendTemplateCard({ touser, templateCard: descriptor.templateCard });
        return res.msgid ?? '';
      }
      default:
        return '';
    }
  }

  private async sendTemplateCardToChat(chatId: string, templateCard: Record<string, unknown>): Promise<void> {
    if (!this.client) return;
    const { type, id } = parseChatId(chatId);
    if (type !== 'user') return;
    await this.client.sendTemplateCard({ touser: id, templateCard });
  }

  private ensureMediaDir(): string {
    if (this.mediaDir) return this.mediaDir;
    const dir = path.join(getDataPath(), 'channel-media', 'wecom-app');
    fs.mkdirSync(dir, { recursive: true });
    this.mediaDir = dir;
    return dir;
  }

  private async downloadMediaToLocal(mediaId: string, msgType: string): Promise<string | undefined> {
    if (!this.client) return undefined;
    const buffer = await this.client.downloadMedia(mediaId);
    const dir = this.ensureMediaDir();
    const ext = extensionFromSignature(buffer) ?? defaultExtForType(msgType);
    const fileName = `${msgType}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    const filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, buffer);
    console.log(`[WeComAppPlugin] media downloaded: type=${msgType}, path=${filePath}, size=${buffer.length}`);
    return filePath;
  }

  private async resolveToLocalPath(source: string, sourceKind: 'local' | 'remote'): Promise<string> {
    if (sourceKind === 'local') {
      if (!fs.existsSync(source)) {
        throw new Error(`Local file not found: ${source}`);
      }
      return source;
    }
    // Remote: download to a temp file in the media dir
    const res = await fetch(source);
    if (!res.ok) throw new Error(`Failed to fetch ${source}: HTTP ${res.status}`);
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    const dir = this.ensureMediaDir();
    const ext = extensionFromSignature(buf) ?? '';
    const fileName = `download_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    const filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, buf);
    return filePath;
  }

  private async getOrUploadMedia(type: 'image' | 'voice' | 'video' | 'file', filePath: string, fileName?: string): Promise<string> {
    if (!this.client) throw new Error('WeCom App client not initialized');
    const hash = hashFile(filePath);
    const cached = this.mediaCache.get(hash);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.mediaId;
    }
    const mediaId = await this.client.uploadMedia(type, filePath, fileName);
    this.mediaCache.set(hash, { mediaId, expiresAt: Date.now() + WeComAppPlugin.MEDIA_TTL_MS });
    return mediaId;
  }

  // ==================== Static ====================

  static async testConnection(
    corpId: string,
    agentId?: string,
    appSecret?: string,
  ): Promise<{ success: boolean; botInfo?: { name?: string }; error?: string }> {
    if (!corpId || !agentId || !appSecret) {
      return { success: false, error: 'corpId, agentId, appSecret are required' };
    }
    try {
      const client = new WeComAppClient({ corpId, agentId, appSecret });
      await client.testConnection();
      return { success: true, botInfo: { name: `WeCom App ${agentId}` } };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
}

// ==================== module-local helpers ====================

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function hashFile(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return createHash('sha1').update(buf).digest('hex');
}

function extensionFromSignature(buf: Buffer): string | undefined {
  if (buf.length < 4) return undefined;
  const sig = buf.subarray(0, 4).toString('hex');
  if (sig === 'ffd8ffe0' || sig === 'ffd8ffe1' || sig === 'ffd8ffe2') return '.jpg';
  if (sig === '89504e47') return '.png';
  if (sig === '47494638') return '.gif';
  if (sig === '25504446') return '.pdf';
  return undefined;
}

function defaultExtForType(msgType: string): string {
  switch (msgType) {
    case 'image':
      return '.jpg';
    case 'voice':
      return '.amr';
    case 'video':
      return '.mp4';
    case 'file':
      return '';
    default:
      return '';
  }
}

function flattenSummary(summaryList?: ApprovalApplyParams['summary_list']): string | undefined {
  if (!summaryList || summaryList.length === 0) return undefined;
  const entries: string[] = [];
  for (const row of summaryList) {
    for (const info of row.summary_info) {
      if (info?.text) entries.push(info.text);
    }
  }
  return entries.length > 0 ? entries.join(' / ') : undefined;
}

// Keep encodeChatId as a named re-export so other modules can use the same helper
export { encodeChatId };
