/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Button } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import Tabs from '@/renderer/components/ui/Tabs';
import { DEFAULT_PROMPT_CATEGORIES } from '../constants';

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
    <div className='w-full mb-4 [animation:fade-in_0.3s_ease-out]'>
      {/* Title */}
      <div className='flex items-center gap-6px mb-10px'>
        <span className='text-13px text-secondary'>💡 {t('guid.promptTemplates.title', { defaultValue: '常用提示词' })}</span>
      </div>

      {/* Category tags */}
      <Tabs
        className='mb-1'
        value={activeCategory ?? ''}
        items={DEFAULT_PROMPT_CATEGORIES.map((category) => ({
          value: category.key,
          label: t(category.labelKey),
          icon: category.icon,
        }))}
        onChange={(value) => setActiveCategory(activeCategory === value ? null : value)}
      />

      {/* Expanded prompt list */}
      {activeCategory && currentCategory && (
        <div className='flex flex-wrap gap-2 mt-2 [animation:panel-slide-in_0.25s_ease-out]'>
          {currentCategory.prompts.map((prompt) => (
            <Button key={prompt.labelKey} size='small' shape='square' className='!border !border-[var(--border-default)]' onClick={() => onSelectPrompt(t(prompt.contentKey))}>
              {t(prompt.labelKey)}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
};

export default PromptTemplates;
