/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

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
