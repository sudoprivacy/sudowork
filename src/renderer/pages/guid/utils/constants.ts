/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import coworkSvg from '@/renderer/assets/cowork.svg';
import type { PromptTemplate } from '../types';

/**
 * Map custom avatar identifiers to their resolved image URLs.
 */
export const CUSTOM_AVATAR_IMAGE_MAP: Record<string, string> = {
  'cowork.svg': coworkSvg,
  '\u{1F6E0}\u{FE0F}': coworkSvg,
};

/**
 * Procurement scenario prompt templates shown on the Guide page.
 */
export const DEFAULT_PROMPT_SCENARIOS: PromptTemplate[] = [
  {
    labelKey: 'guid.promptTemplates.scenarios.sourcePrice',
    contentKey: 'guid.promptTemplates.scenarios.sourcePriceContent',
    icon: '🔍',
  },
  {
    labelKey: 'guid.promptTemplates.scenarios.preBidCheck',
    contentKey: 'guid.promptTemplates.scenarios.preBidCheckContent',
    icon: '📋',
  },
  {
    labelKey: 'guid.promptTemplates.scenarios.preAwardVerify',
    contentKey: 'guid.promptTemplates.scenarios.preAwardVerifyContent',
    icon: '🔎',
  },
  {
    labelKey: 'guid.promptTemplates.scenarios.controlPrice',
    contentKey: 'guid.promptTemplates.scenarios.controlPriceContent',
    icon: '💰',
  },
];
