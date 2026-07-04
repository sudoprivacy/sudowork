/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { normalizeSkillVersion } from '@/renderer/utils/skillDisplay';

export const normalizeAssistantVersion = (version?: string | null) => normalizeSkillVersion(version).replace(/^v(?=\d)/i, '');
