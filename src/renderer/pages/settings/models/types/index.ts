import type { ScodeCustomModelProvider } from '@/common/scodeConfig';

export type ProviderRow = {
  id: string;
  baseUrl: string;
  apiKey: string;
  modelIds: string[];
};

export type EditableModel = ScodeCustomModelProvider['models'][number];

export type EditingModelTarget = {
  provider: ProviderRow;
  modelId: string;
};
