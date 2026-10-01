import type { IncomingMessage, ServerResponse } from 'http';
import { ZodError } from 'zod';
import { SubtitleBusyError, subtitleService, subtitleTranscribeSchema, subtitleBurnSchema } from '@process/services/transcription/SubtitleService';

const MAX_BODY_BYTES = 16 * 1024;

/** Handle media operations after AuthProxyServer validates the agent token. */
export async function onSubtitleRequest(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
  if (req.method !== 'POST' || !['/subtitles/transcribe', '/subtitles/burn'].includes(pathname)) {
    respond(res, 404, { success: false, msg: 'Unknown subtitle operation.' });
    return;
  }
  const controller = new AbortController();
  const onClose = () => controller.abort();
  res.once('close', onClose);
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        respond(res, 413, { success: false, msg: 'Request is too large.' });
        return;
      }
      chunks.push(Buffer.from(chunk));
    }
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      respond(res, 400, { success: false, msg: 'Invalid JSON.' });
      return;
    }
    const data = pathname === '/subtitles/transcribe' ? await subtitleService.transcribe(subtitleTranscribeSchema.parse(body), controller.signal) : await subtitleService.burn(subtitleBurnSchema.parse(body), controller.signal);
    respond(res, 200, { success: true, data });
  } catch (err) {
    const status = err instanceof ZodError ? 400 : err instanceof SubtitleBusyError ? 409 : 422;
    const msg = err instanceof ZodError ? err.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') : err instanceof Error ? err.message : 'Subtitle operation failed.';
    respond(res, status, { success: false, msg });
  } finally {
    res.off('close', onClose);
  }
}

function respond(res: ServerResponse, status: number, body: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}
