/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo } from 'react';
import { useAuth } from '@/renderer/context/AuthContext';
import { createEnterpriseMcpClient } from '@/renderer/pages/settings/enterprise_mcps/api/client';
import { createWikiApi, type WikiApi } from '../api/wikiApi';

/** Moss wiki API bound to the current enterprise session (token refresh + one 401 retry). */
export function useWikiApi(): WikiApi {
  const { ensureValidToken } = useAuth();
  return useMemo(() => createWikiApi(createEnterpriseMcpClient((forceRefresh) => ensureValidToken(forceRefresh))), [ensureValidToken]);
}
