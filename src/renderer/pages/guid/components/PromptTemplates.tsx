/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { DEFAULT_PROMPT_CATEGORIES } from '../constants';
import styles from '../index.module.css';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

type PromptTemplatesProps = {
  /** Whether the component should be visible */
  visible: boolean;
  /** Callback when a prompt template is selected */
  onSelectPrompt: (content: string) => void;
};

/**
 * Displays categorized prompt templates above the input card.
 * Users can click a category to expand its prompts, then click a prompt to fill the input.
 */
const PromptTemplates: React.FC<PromptTemplatesProps> = ({ visible, onSelectPrompt }) => {
  const { t } = useTranslation();
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  if (!visible) return null;

  const currentCategory = DEFAULT_PROMPT_CATEGORIES.find((c) => c.key === activeCategory);

  return (
    <div className={styles.promptTemplatesContainer}>
      {/* Title */}
      <div className='flex items-center gap-6px mb-10px'>
        <span className='text-13px' style={{ color: 'var(--color-text-3)' }}>
          💡 {t('guid.promptTemplates.title', { defaultValue: 'Prompt Templates' })}
        </span>
      </div>

      {/* Category tags */}
      <div className='flex flex-wrap gap-8px mb-4px'>
        {DEFAULT_PROMPT_CATEGORIES.map((category) => (
          <div key={category.key} className={`${styles.promptCategoryTag} ${activeCategory === category.key ? styles.promptCategoryTagActive : ''}`} onClick={() => setActiveCategory(activeCategory === category.key ? null : category.key)}>
            {category.icon} {t(category.labelKey)}
          </div>
        ))}
      </div>

      {/* Expanded prompt list */}
      {activeCategory && currentCategory && (
        <div className={styles.promptListContainer}>
          {currentCategory.prompts.map((prompt) => (
            <div key={prompt.labelKey} className={styles.promptItem} onClick={() => onSelectPrompt(t(prompt.contentKey))}>
              {t(prompt.labelKey)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PromptTemplates;
