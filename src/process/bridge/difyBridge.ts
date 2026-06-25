/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Dify integration bridge.
 *
 * Talks to sudowork-server (NOT Dify directly) so the user JWT and the per-tenant
 * Dify Service API key never leak to the renderer. sudowork-server enforces the
 * visibility ACL and proxies SSE frames; we just stream them on to the renderer.
 *
 * Chat lifecycle:
 *   1. renderer  → ipcBridge.dify.startChat({ accessToken, assistantId, query }) → { streamId }
 *   2. main process opens fetch(POST /api/v1/agents/:id/chat), parses SSE in chunks
 *   3. for each frame  → ipcBridge.dify.chunk.emit({ streamId, event, data })
 *   4. on completion / error  → ipcBridge.dify.end.emit({ streamId, ok, error? })
 *   5. renderer may call ipcBridge.dify.cancelChat({ streamId }) to abort early
 *
 * All non-streaming methods are thin wrappers around the matching sudowork-server
 * route under /api/v1/agents/:assistantId/*. We never call Dify directly.
 */

import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as joinPath, basename } from 'node:path';
import { randomUUID } from 'node:crypto';

import { mainError, mainLog, mainWarn } from '@process/utils/mainLogger';
import { bindSession as orchestratorBind, unbindSession as orchestratorUnbind } from '@process/services/dify/enhancementOrchestrator';
import { dify } from '@/common/ipcBridge';
import type { IBridgeResponse, IDifyAgent, IDifyChatChunk, IDifyChatStreamStart, IDifyConversation, IDifyConversationList, IDifyFileUploadResult, IDifyMessageList, IDifyMeta, IDifyParameters } from '@/common/ipcBridge';
import { SUDOWORK_SERVER_BASE_URL } from '@/common/sudoworkServer';

const API_BASE = `${SUDOWORK_SERVER_BASE_URL}/api/v1/agents`;

function agentUrl(assistantId: string, suffix = ''): string {
  return `${API_BASE}/${encodeURIComponent(assistantId)}${suffix}`;
}

interface ActiveStream {
  controller: AbortController;
  started: number;
}

const activeStreams = new Map<string, ActiveStream>();

function jsonHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function bareAuth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

interface ServerEnvelope<T> {
  success: boolean;
  data?: T;
  msg?: string;
}

/**
 * Issue a request to sudowork-server and normalize the response into a
 * renderer-facing IBridgeResponse. The shape contract: the server already
 * wraps everything in `{ success, data, msg }`; we just relay.
 */
async function sudoworkServerCall<T>(url: string, init: RequestInit): Promise<IBridgeResponse<T>> {
  let resp: Response;
  try {
    resp = await fetch(url, init);
  } catch (err) {
    return { success: false, msg: `network: ${(err as Error).message}` };
  }
  let body: unknown = null;
  try {
    body = await resp.json();
  } catch {
    /* non-JSON; treat as raw error below */
  }
  if (!resp.ok) {
    const msg = (body && typeof body === 'object' && 'msg' in (body as any) && String((body as any).msg)) || `sudowork-server ${resp.status}`;
    return { success: false, msg };
  }
  const envelope = body as ServerEnvelope<T>;
  if (!envelope || envelope.success !== true) {
    return { success: false, msg: envelope?.msg || 'sudowork-server returned non-success' };
  }
  return { success: true, data: envelope.data };
}

/**
 * Parse an SSE byte stream from sudowork-server and emit each event as an IPC
 * chunk. Dify formats frames as `data: <json>\n\n` (with an optional `event:`
 * line); we keep the parser tolerant of either layout.
 */
async function pumpSse(streamId: string, assistantId: string, reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep = buffer.indexOf('\n\n');
      while (sep !== -1) {
        const rawFrame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        sep = buffer.indexOf('\n\n');

        let event = '';
        const dataLines: string[] = [];
        for (const line of rawFrame.split('\n')) {
          if (line.startsWith(':')) continue;
          if (line.startsWith('event:')) {
            event = line.slice(6).trim();
            continue;
          }
          if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trim());
            continue;
          }
        }
        if (dataLines.length === 0) continue;
        const dataStr = dataLines.join('\n');
        if (dataStr === '[DONE]') continue;

        let data: Record<string, unknown> = {};
        try {
          data = JSON.parse(dataStr);
        } catch {
          data = { raw: dataStr };
        }
        if (!event && typeof data['event'] === 'string') {
          event = data['event'] as string;
        }
        const chunk: IDifyChatChunk = { streamId, event, data };
        dify.chunk.emit(chunk);
      }
    }
    dify.end.emit({ streamId, ok: true });
    mainLog('DifyBridge', `stream ${streamId} (assistant=${assistantId}) finished`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if ((err as Error).name === 'AbortError') {
      dify.end.emit({ streamId, ok: false, error: 'aborted' });
    } else {
      mainError('DifyBridge', `stream ${streamId} failed:`, err);
      dify.end.emit({ streamId, ok: false, error: message });
    }
  } finally {
    activeStreams.delete(streamId);
  }
}

/**
 * Parse the enhancement SSE stream from sudowork-server. Frames carry our
 * already-transformed events: `progress` (per-node), `result` (final
 * injection text), `error`.
 */
async function pumpEnhancementSse(streamId: string, reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let sep = buffer.indexOf('\n\n');
      while (sep !== -1) {
        const rawFrame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        sep = buffer.indexOf('\n\n');

        let event = '';
        const dataLines: string[] = [];
        for (const line of rawFrame.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        }
        if (dataLines.length === 0) continue;
        let payload: Record<string, unknown> = {};
        try {
          payload = JSON.parse(dataLines.join('\n'));
        } catch {
          continue;
        }
        if (event === 'progress' || payload.kind === 'progress') {
          dify.enhancementProgress.emit({
            streamId,
            step: String(payload.step ?? ''),
            nodeId: payload.nodeId as string | undefined,
            nodeType: payload.nodeType as string | undefined,
          });
        } else if (event === 'result' || payload.kind === 'result') {
          dify.enhancementResult.emit({
            streamId,
            text: String(payload.text ?? ''),
            mode: (payload.mode as 'agent-chat' | 'workflow' | 'rag-only') ?? 'workflow',
            elapsedMs: Number(payload.elapsedMs ?? 0),
            citations: payload.citations as unknown[] | undefined,
          });
        } else if (event === 'error' || payload.kind === 'error') {
          dify.enhancementEnd.emit({
            streamId,
            ok: false,
            error: String(payload.message ?? 'enhancement error'),
          });
          return;
        }
      }
    }
    dify.enhancementEnd.emit({ streamId, ok: true });
    mainLog('DifyBridge', `enhancement stream ${streamId} finished`);
  } catch (err) {
    mainError('DifyBridge', `enhancement stream ${streamId} failed:`, err);
    dify.enhancementEnd.emit({
      streamId,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function initDifyBridge(): void {
  // ============================================================================
  // Discovery
  // ============================================================================

  dify.getVisibleAgents.provider(async ({ accessToken }): Promise<IBridgeResponse<IDifyAgent[]>> => {
    if (!accessToken) return { success: false, msg: 'accessToken is required', data: [] };
    const res = await sudoworkServerCall<IDifyAgent[]>(`${API_BASE}/visible`, {
      headers: jsonHeaders(accessToken),
    });
    return { ...res, data: res.data ?? [] };
  });

  // ============================================================================
  // Chat (streaming) + stop
  // ============================================================================

  dify.startChat.provider(async ({ accessToken, assistantId, query, conversationId, inputs, files, autoGenerateName }): Promise<IBridgeResponse<IDifyChatStreamStart>> => {
    if (!accessToken) return { success: false, msg: 'accessToken is required' };
    if (!assistantId) return { success: false, msg: 'assistantId is required' };
    if (!query) return { success: false, msg: 'query is required' };

    const streamId = randomUUID();
    const controller = new AbortController();

    let resp: Response;
    try {
      resp = await fetch(agentUrl(assistantId, '/chat'), {
        method: 'POST',
        headers: jsonHeaders(accessToken),
        body: JSON.stringify({
          query,
          conversation_id: conversationId ?? '',
          inputs: inputs ?? {},
          files: files ?? [],
          auto_generate_name: autoGenerateName ?? true,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      return { success: false, msg: `connect failed: ${(err as Error).message}` };
    }

    if (!resp.ok || !resp.body) {
      const detail = await resp.text().catch(() => '');
      return { success: false, msg: `upstream ${resp.status}: ${detail.slice(0, 200)}` };
    }

    activeStreams.set(streamId, { controller, started: Date.now() });
    void pumpSse(streamId, assistantId, resp.body.getReader());

    return { success: true, data: { streamId, assistantId } };
  });

  dify.bindSession.provider(async ({ conversationId, accessToken, assistantId }) => {
    if (!conversationId || !accessToken || !assistantId) {
      return { success: false, msg: 'conversationId, accessToken and assistantId required' };
    }
    orchestratorBind({ conversationId, accessToken, assistantId });
    return { success: true };
  });

  dify.unbindSession.provider(async ({ conversationId }) => {
    orchestratorUnbind(conversationId);
    return { success: true };
  });

  dify.cancelChat.provider(async ({ streamId }): Promise<IBridgeResponse<void>> => {
    const stream = activeStreams.get(streamId);
    if (!stream) return { success: true };
    try {
      stream.controller.abort();
    } catch (err) {
      mainWarn('DifyBridge', `abort failed for ${streamId}:`, err);
    }
    activeStreams.delete(streamId);
    return { success: true };
  });

  dify.stopChatTask.provider(async ({ accessToken, assistantId, taskId }) => {
    if (!accessToken || !assistantId || !taskId) {
      return { success: false, msg: 'accessToken, assistantId, taskId are required' };
    }
    return sudoworkServerCall<unknown>(agentUrl(assistantId, `/chat/${encodeURIComponent(taskId)}/stop`), {
      method: 'POST',
      headers: jsonHeaders(accessToken),
    });
  });

  // ============================================================================
  // Conversations
  // ============================================================================

  dify.listConversations.provider(async ({ accessToken, assistantId, lastId, limit, sortBy }) => {
    if (!accessToken || !assistantId) {
      return { success: false, msg: 'accessToken and assistantId required' };
    }
    const params = new URLSearchParams();
    if (lastId) params.set('last_id', lastId);
    if (limit) params.set('limit', String(limit));
    if (sortBy) params.set('sort_by', sortBy);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return sudoworkServerCall<IDifyConversationList>(agentUrl(assistantId, `/conversations${qs}`), {
      headers: jsonHeaders(accessToken),
    });
  });

  dify.renameConversation.provider(async ({ accessToken, assistantId, conversationId, name, autoGenerate }) => {
    if (!accessToken || !assistantId || !conversationId) {
      return { success: false, msg: 'accessToken, assistantId, conversationId required' };
    }
    return sudoworkServerCall<IDifyConversation>(agentUrl(assistantId, `/conversations/${encodeURIComponent(conversationId)}`), {
      method: 'PATCH',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ name: name ?? null, auto_generate: autoGenerate ?? false }),
    });
  });

  dify.deleteConversation.provider(async ({ accessToken, assistantId, conversationId }) => {
    if (!accessToken || !assistantId || !conversationId) {
      return { success: false, msg: 'accessToken, assistantId, conversationId required' };
    }
    return sudoworkServerCall<void>(agentUrl(assistantId, `/conversations/${encodeURIComponent(conversationId)}`), { method: 'DELETE', headers: jsonHeaders(accessToken) });
  });

  // ============================================================================
  // Messages
  // ============================================================================

  dify.listMessages.provider(async ({ accessToken, assistantId, conversationId, firstId, limit }) => {
    if (!accessToken || !assistantId || !conversationId) {
      return { success: false, msg: 'accessToken, assistantId, conversationId required' };
    }
    const params = new URLSearchParams();
    if (firstId) params.set('first_id', firstId);
    if (limit) params.set('limit', String(limit));
    const qs = params.toString() ? `?${params.toString()}` : '';
    return sudoworkServerCall<IDifyMessageList>(agentUrl(assistantId, `/conversations/${encodeURIComponent(conversationId)}/messages${qs}`), { headers: jsonHeaders(accessToken) });
  });

  dify.sendFeedback.provider(async ({ accessToken, assistantId, messageId, rating, content }) => {
    if (!accessToken || !assistantId || !messageId) {
      return { success: false, msg: 'accessToken, assistantId, messageId required' };
    }
    return sudoworkServerCall<unknown>(agentUrl(assistantId, `/messages/${encodeURIComponent(messageId)}/feedback`), {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ rating, content: content ?? null }),
    });
  });

  dify.getSuggested.provider(async ({ accessToken, assistantId, messageId }) => {
    if (!accessToken || !assistantId || !messageId) {
      return { success: false, msg: 'accessToken, assistantId, messageId required' };
    }
    return sudoworkServerCall<{ result: string; data: string[] }>(agentUrl(assistantId, `/messages/${encodeURIComponent(messageId)}/suggested`), { headers: jsonHeaders(accessToken) });
  });

  // ============================================================================
  // App-level meta
  // ============================================================================

  dify.getParameters.provider(async ({ accessToken, assistantId }) => {
    if (!accessToken || !assistantId) return { success: false, msg: 'accessToken and assistantId required' };
    return sudoworkServerCall<IDifyParameters>(agentUrl(assistantId, '/parameters'), {
      headers: jsonHeaders(accessToken),
    });
  });

  dify.getMeta.provider(async ({ accessToken, assistantId }) => {
    if (!accessToken || !assistantId) return { success: false, msg: 'accessToken and assistantId required' };
    return sudoworkServerCall<IDifyMeta>(agentUrl(assistantId, '/meta'), {
      headers: jsonHeaders(accessToken),
    });
  });

  // ============================================================================
  // File upload + audio
  // ============================================================================

  async function uploadMultipart(url: string, accessToken: string, file: { name: string; type: string; data: Blob }): Promise<IBridgeResponse<IDifyFileUploadResult>> {
    const form = new FormData();
    form.append('file', file.data, file.name);
    let resp: Response;
    try {
      resp = await fetch(url, { method: 'POST', headers: bareAuth(accessToken), body: form });
    } catch (err) {
      return { success: false, msg: `network: ${(err as Error).message}` };
    }
    let body: any = null;
    try {
      body = await resp.json();
    } catch {
      /* ignore */
    }
    if (!resp.ok) {
      return { success: false, msg: body?.msg || `sudowork-server ${resp.status}` };
    }
    if (!body?.success) {
      return { success: false, msg: body?.msg || 'upload failed' };
    }
    return { success: true, data: body.data as IDifyFileUploadResult };
  }

  dify.uploadFile.provider(async ({ accessToken, assistantId, name, mimeType, bytes }) => {
    if (!accessToken || !assistantId) return { success: false, msg: 'accessToken and assistantId required' };
    const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const blob = new Blob([buf as BlobPart], { type: mimeType || 'application/octet-stream' });
    return uploadMultipart(agentUrl(assistantId, '/files'), accessToken, {
      name,
      type: mimeType,
      data: blob,
    });
  });

  dify.uploadFileFromPath.provider(async ({ accessToken, assistantId, filePath, mimeType }) => {
    if (!accessToken || !assistantId || !filePath) {
      return { success: false, msg: 'accessToken, assistantId, filePath required' };
    }
    let buf: Buffer;
    try {
      buf = await fsp.readFile(filePath);
    } catch (err) {
      return { success: false, msg: `read failed: ${(err as Error).message}` };
    }
    const blob = new Blob([buf as BlobPart], { type: mimeType || 'application/octet-stream' });
    return uploadMultipart(agentUrl(assistantId, '/files'), accessToken, {
      name: basename(filePath),
      type: mimeType || 'application/octet-stream',
      data: blob,
    });
  });

  dify.audioToText.provider(async ({ accessToken, assistantId, name, mimeType, bytes }) => {
    if (!accessToken || !assistantId) return { success: false, msg: 'accessToken and assistantId required' };
    const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const blob = new Blob([buf as BlobPart], { type: mimeType || 'audio/mpeg' });
    const form = new FormData();
    form.append('file', blob, name);
    let resp: Response;
    try {
      resp = await fetch(agentUrl(assistantId, '/audio-to-text'), {
        method: 'POST',
        headers: bareAuth(accessToken),
        body: form,
      });
    } catch (err) {
      return { success: false, msg: `network: ${(err as Error).message}` };
    }
    let body: any = null;
    try {
      body = await resp.json();
    } catch {
      /* ignore */
    }
    if (!resp.ok || !body?.success) {
      return { success: false, msg: body?.msg || `audio-to-text ${resp.status}` };
    }
    return { success: true, data: body.data as { text: string } };
  });

  // ============================================================================
  // Enhancement (pre-injection)
  // ============================================================================

  dify.getEnhancement.provider(async ({ accessToken, assistantId }) => {
    if (!accessToken || !assistantId) {
      return { success: false, msg: 'accessToken and assistantId required' };
    }
    return sudoworkServerCall<{ enabled: boolean; mode?: 'agent-chat' | 'workflow' | 'rag-only' }>(agentUrl(assistantId, '/enhancement'), { headers: jsonHeaders(accessToken) });
  });

  dify.invokeEnhancement.provider(async ({ accessToken, assistantId, query, conversationId }) => {
    if (!accessToken || !assistantId || !query) {
      return { success: false, msg: 'accessToken, assistantId and query required' };
    }
    return sudoworkServerCall<{
      text: string;
      mode: 'agent-chat' | 'workflow' | 'rag-only';
      elapsedMs: number;
      citations?: unknown[];
    }>(agentUrl(assistantId, '/enhancement/invoke'), {
      method: 'POST',
      headers: jsonHeaders(accessToken),
      body: JSON.stringify({ query, conversation_id: conversationId ?? '' }),
    });
  });

  dify.startEnhancement.provider(async ({ accessToken, assistantId, query, conversationId }) => {
    if (!accessToken || !assistantId || !query) {
      return { success: false, msg: 'accessToken, assistantId and query required' };
    }

    const streamId = randomUUID();
    let resp: Response;
    try {
      resp = await fetch(agentUrl(assistantId, '/enhancement/invoke-stream'), {
        method: 'POST',
        headers: jsonHeaders(accessToken),
        body: JSON.stringify({ query, conversation_id: conversationId ?? '' }),
      });
    } catch (err) {
      return { success: false, msg: `connect failed: ${(err as Error).message}` };
    }
    if (!resp.ok || !resp.body) {
      const detail = await resp.text().catch(() => '');
      return { success: false, msg: `upstream ${resp.status}: ${detail.slice(0, 200)}` };
    }
    void pumpEnhancementSse(streamId, resp.body.getReader());
    return { success: true, data: { streamId } };
  });

  dify.textToAudio.provider(async ({ accessToken, assistantId, messageId, text, voice, streaming }) => {
    if (!accessToken || !assistantId) return { success: false, msg: 'accessToken and assistantId required' };
    let resp: Response;
    try {
      resp = await fetch(agentUrl(assistantId, '/text-to-audio'), {
        method: 'POST',
        headers: jsonHeaders(accessToken),
        body: JSON.stringify({ message_id: messageId, text, voice, streaming }),
      });
    } catch (err) {
      return { success: false, msg: `network: ${(err as Error).message}` };
    }
    if (!resp.ok || !resp.body) {
      const detail = await resp.text().catch(() => '');
      return { success: false, msg: `text-to-audio ${resp.status}: ${detail.slice(0, 200)}` };
    }
    // Write to a tmp file so the renderer can <audio src=…> it; passing
    // multi-MB binary through IPC chunking is wasteful.
    const mime = resp.headers.get('Content-Type') || 'audio/mpeg';
    const ext = mime.includes('mpeg') ? 'mp3' : mime.includes('wav') ? 'wav' : 'bin';
    const filePath = joinPath(tmpdir(), `dify-tts-${randomUUID()}.${ext}`);
    try {
      const buf = Buffer.from(await resp.arrayBuffer());
      await fsp.writeFile(filePath, buf);
    } catch (err) {
      return { success: false, msg: `write failed: ${(err as Error).message}` };
    }
    return { success: true, data: { filePath, mimeType: mime } };
  });
}
