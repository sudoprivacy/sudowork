import type { AcpQuestionAnswerItem, AcpQuestionItem, AcpQuestionItemOption, IMessageAcpQuestion } from '@/common/chatLib';

export interface INormalizedAcpQuestionItem extends AcpQuestionItem {
  options: AcpQuestionItemOption[];
}

export function normalizeAcpQuestionItems(message: IMessageAcpQuestion, booleanFallback: { yes: string; no: string }): INormalizedAcpQuestionItem[] {
  const items = message.content?.items;
  if (items?.length) {
    return items.map((item, index) => normalizeItem(item, index, booleanFallback));
  }

  const options = (message.content?.options || []).map((option) => ({ label: option, value: option }));
  return [
    {
      id: 'q1',
      prompt: message.content?.question || '',
      kind: options.length > 0 ? 'single_select' : 'text',
      options,
      allowCustomInput: true,
      optional: false,
    },
  ];
}

export function resolveAcpQuestionKind(item: INormalizedAcpQuestionItem): 'single_select' | 'multi_select' | 'text' {
  if (item.kind === 'boolean') return 'single_select';
  if (item.kind) return item.kind;
  return item.options.length > 0 ? 'single_select' : 'text';
}

export function normalizeAcpQuestionAnswerValue(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' / ');
}

export function parseAcpQuestionAnswer(answer: string, items: INormalizedAcpQuestionItem[]): AcpQuestionAnswerItem[] {
  const normalized = answer.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const structured = normalized
    .split('\n')
    .map((line) => line.trim().match(/^Q(\d+):\s*(.*)$/i))
    .map((match) => {
      if (!match) return null;
      const index = Number(match[1]);
      const item = items[index - 1];
      if (!item) return null;
      const submissionValue = (match[2] || '').trim();
      return {
        id: item.id,
        index,
        submissionValue,
        displayValue: submissionValue === '[skipped]' ? '' : submissionValue,
        skipped: submissionValue === '[skipped]',
      };
    })
    .filter(Boolean) as AcpQuestionAnswerItem[];

  if (structured.length > 0) return structured;
  if (items.length !== 1) return [];

  return [
    {
      id: items[0].id,
      index: 1,
      submissionValue: normalized,
      displayValue: normalized === '[skipped]' ? '' : normalized,
      skipped: normalized === '[skipped]',
    },
  ];
}

function normalizeItem(item: AcpQuestionItem, index: number, booleanFallback: { yes: string; no: string }): INormalizedAcpQuestionItem {
  let options = ((item.options as unknown[] | undefined) || []).map(toOption).filter((option): option is AcpQuestionItemOption => Boolean(option));
  if (item.kind === 'boolean' && options.length === 0) {
    options = [
      { label: booleanFallback.yes, value: 'true' },
      { label: booleanFallback.no, value: 'false' },
    ];
  }
  return { ...item, id: item.id || `q${index + 1}`, options, allowCustomInput: item.allowCustomInput !== false };
}

function toOption(raw: unknown): AcpQuestionItemOption | null {
  if (typeof raw === 'string') {
    const value = raw.trim();
    return value ? { label: value, value } : null;
  }
  if (!raw || typeof raw !== 'object') return null;

  const record = raw as Record<string, unknown>;
  const label = typeof record.label === 'string' ? record.label : typeof record.value === 'string' ? record.value : '';
  const value = typeof record.value === 'string' ? record.value : label;
  if (!label && !value) return null;
  return {
    label: label || value,
    value: value || label,
    description: typeof record.description === 'string' ? record.description : undefined,
    recommended: record.recommended === true,
  };
}
