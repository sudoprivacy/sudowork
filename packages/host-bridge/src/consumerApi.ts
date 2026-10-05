import { z } from 'zod';
import { sudoworkServer } from './ipcBridge.js';

const responseSchema = z.object({ success: z.boolean(), data: z.unknown().optional(), msg: z.string().optional() });
export const CONSUMER_REQUEST_TIMEOUT_MS = 15_000;

interface IConsumerResponse<T> {
  success: boolean;
  data: T;
  msg?: string;
}

/** One authenticated request path for desktop and web account pages, including IPC and body deadlines. */
export async function requestConsumerApi<T>(authFetch: (url: string, options?: RequestInit) => Promise<Response>, path: string, options: RequestInit = {}): Promise<IConsumerResponse<T>> {
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal;
  const timer = setTimeout(() => controller.abort(new DOMException('Account request timed out', 'TimeoutError')), CONSUMER_REQUEST_TIMEOUT_MS);
  let onAbort: () => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    return await Promise.race([
      aborted,
      (async () => {
        signal.throwIfAborted();
        const { baseUrl } = await sudoworkServer.getConfig.invoke();
        signal.throwIfAborted();
        const response = await authFetch(`${baseUrl}${path}`, { ...options, signal });
        signal.throwIfAborted();
        const body = responseSchema.parse(await response.json());
        signal.throwIfAborted();
        // Preserve actionable business rejections (for example, invalid order amounts).
        if (!response.ok && body.success) throw new Error(`Account request failed (${response.status})`);
        return body as IConsumerResponse<T>;
      })(),
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}
