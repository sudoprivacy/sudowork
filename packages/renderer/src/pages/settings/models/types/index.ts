/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ScodeCustomModelProvider } from '@sudowork/common/scodeConfig';

export type ProviderRow = {
  id: string;
  baseUrl: string;
  apiKey: string;
  modelIds: string[];
};

export type EditableModel = ScodeCustomModelProvider['models'][number];

export type EditingModelTarget =
  | {
      mode: 'model';
      provider: ProviderRow;
      modelId: string;
    }
  | {
      mode: 'provider';
      provider: ProviderRow;
    };
