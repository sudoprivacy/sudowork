/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

export const DEFAULT_SCODE_MODEL_ID = 'gemini-3-flash';

export function getDefaultAcpModelId(backend: string | null | undefined): string | null {
  switch (backend) {
    case 'scode':
      return DEFAULT_SCODE_MODEL_ID;
    default:
      return null;
  }
}

type ResolvePreferredAcpModelIdParams = {
  backend: string | null | undefined;
  explicitModelId?: string | null;
  preferredModelId?: string | null;
  cachedModelId?: string | null;
};

export function resolvePreferredAcpModelId(params: ResolvePreferredAcpModelIdParams): string | null {
  return params.explicitModelId || params.preferredModelId || params.cachedModelId || getDefaultAcpModelId(params.backend);
}
