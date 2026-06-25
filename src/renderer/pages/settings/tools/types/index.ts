import type { Message } from '@arco-design/web-react';

export type MessageInstance = ReturnType<typeof Message.useMessage>[0];

export type McpImportMode = 'json' | 'oneclick';

export interface IImageGenerationModelOption {
  label: string;
  value: string;
}
