/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import coworkSvg from '@/renderer/assets/cowork.svg';
import type { PromptCategory } from './types';

/**
 * Map custom avatar identifiers to their resolved image URLs.
 */
export const CUSTOM_AVATAR_IMAGE_MAP: Record<string, string> = {
  'cowork.svg': coworkSvg,
  '\u{1F6E0}\u{FE0F}': coworkSvg,
};

/**
 * Default prompt template categories shown on the Guide page.
 */
export const DEFAULT_PROMPT_CATEGORIES: PromptCategory[] = [
  {
    key: 'coding',
    labelKey: 'guid.promptTemplates.categories.coding',
    icon: '💻',
    prompts: [
      { labelKey: 'guid.promptTemplates.coding.writeScript', contentKey: 'guid.promptTemplates.coding.writeScriptContent' },
      { labelKey: 'guid.promptTemplates.coding.codeReview', contentKey: 'guid.promptTemplates.coding.codeReviewContent' },
      { labelKey: 'guid.promptTemplates.coding.debug', contentKey: 'guid.promptTemplates.coding.debugContent' },
      { labelKey: 'guid.promptTemplates.coding.explain', contentKey: 'guid.promptTemplates.coding.explainContent' },
    ],
  },
  {
    key: 'writing',
    labelKey: 'guid.promptTemplates.categories.writing',
    icon: '✍️',
    prompts: [
      { labelKey: 'guid.promptTemplates.writing.article', contentKey: 'guid.promptTemplates.writing.articleContent' },
      { labelKey: 'guid.promptTemplates.writing.polish', contentKey: 'guid.promptTemplates.writing.polishContent' },
      { labelKey: 'guid.promptTemplates.writing.email', contentKey: 'guid.promptTemplates.writing.emailContent' },
    ],
  },
  {
    key: 'translation',
    labelKey: 'guid.promptTemplates.categories.translation',
    icon: '🌐',
    prompts: [
      { labelKey: 'guid.promptTemplates.translation.toEnglish', contentKey: 'guid.promptTemplates.translation.toEnglishContent' },
      { labelKey: 'guid.promptTemplates.translation.toChinese', contentKey: 'guid.promptTemplates.translation.toChineseContent' },
    ],
  },
  {
    key: 'analysis',
    labelKey: 'guid.promptTemplates.categories.analysis',
    icon: '📊',
    prompts: [
      { labelKey: 'guid.promptTemplates.analysis.data', contentKey: 'guid.promptTemplates.analysis.dataContent' },
      { labelKey: 'guid.promptTemplates.analysis.summarize', contentKey: 'guid.promptTemplates.analysis.summarizeContent' },
    ],
  },
  {
    key: 'creative',
    labelKey: 'guid.promptTemplates.categories.creative',
    icon: '🎨',
    prompts: [
      { labelKey: 'guid.promptTemplates.creative.brainstorm', contentKey: 'guid.promptTemplates.creative.brainstormContent' },
      { labelKey: 'guid.promptTemplates.creative.naming', contentKey: 'guid.promptTemplates.creative.namingContent' },
    ],
  },
  {
    key: 'learning',
    labelKey: 'guid.promptTemplates.categories.learning',
    icon: '📚',
    prompts: [
      { labelKey: 'guid.promptTemplates.learning.explain', contentKey: 'guid.promptTemplates.learning.explainContent' },
      { labelKey: 'guid.promptTemplates.learning.compare', contentKey: 'guid.promptTemplates.learning.compareContent' },
    ],
  },
];
