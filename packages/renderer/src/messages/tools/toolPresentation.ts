import type { ToolCallContentItem } from '@sudowork/common/acpTypes';

export type ToolState = 'pending' | 'running' | 'success' | 'error' | 'canceled' | 'unknown';
export type ToolContent = { kind: 'text' | 'markdown' | 'code'; text: string; language?: string } | { kind: 'diff'; oldText: string; newText: string; path: string };

/** Protocol adapters share one status vocabulary and preserve unknown states. */
export function normalizeToolState(status: string): ToolState {
  switch (status.toLowerCase()) {
    case 'pending':
    case 'confirming':
      return 'pending';
    case 'executing':
    case 'in_progress':
    case 'running':
      return 'running';
    case 'success':
    case 'completed':
      return 'success';
    case 'error':
    case 'failed':
      return 'error';
    case 'canceled':
    case 'cancelled':
      return 'canceled';
    default:
      return 'unknown';
  }
}

export function isToolActive(status: string): boolean {
  const state = normalizeToolState(status);
  return state === 'pending' || state === 'running';
}

export function isToolFinished(status: string): boolean {
  const state = normalizeToolState(status);
  return state === 'success' || state === 'error' || state === 'canceled';
}

export function formatToolValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return String(value);
  }
}

export function projectAcpToolContent(items: ToolCallContentItem[] = []): ToolContent[] {
  return items.flatMap((item): ToolContent[] => {
    if (item.type === 'diff') return [{ kind: 'diff', path: item.path || '', oldText: item.oldText || '', newText: item.newText || '' }];
    if (item.content?.type === 'text' && typeof item.content.text === 'string') return [{ kind: 'text', text: item.content.text }];
    return [];
  });
}
