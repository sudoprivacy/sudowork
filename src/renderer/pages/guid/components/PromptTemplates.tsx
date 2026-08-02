/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Button } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import Tabs from '@/renderer/components/ui/Tabs';
import { DEFAULT_PROMPT_CATEGORIES, type BrandPromptScenario } from '../utils/constants';

/**
 * Displays prompt templates above the input card.
 *
 * - If `scenarios` is provided (from brand.config.json), renders those as flat
 *   buttons directly — no category tabs.
 * - Otherwise falls back to the original 6-category tabbed view.
 */
export default function PromptTemplates({ visible, scenarios, onSelectPrompt }: IPromptTemplatesProps) {
  const { t } = useTranslation();
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  if (!visible) return null;

  // Brand-configured flat scenarios (e.g. procurement mode)
  if (scenarios && scenarios.length > 0) {
    return (
      <div className='w-full mb-4 animate-fade-in animate-duration-400 animate-ease-out'>
        <div className='flex items-center gap-6px mb-10px'>
          <span className='text-13px text-foreground-secondary'>💡 {t('guid.promptTemplates.title')}</span>
        </div>
        <div className='flex flex-wrap gap-2'>
          {scenarios.map((s, i) => (
            <Button key={i} onClick={() => onSelectPrompt(s.content)}>
              {s.icon && <span className='mr-1'>{s.icon}</span>}
              {s.label}
            </Button>
          ))}
        </div>
      </div>
    );
  }

  // Default: 6-category tabbed view
  const currentCategory = DEFAULT_PROMPT_CATEGORIES.find((c) => c.key === activeCategory);

  return (
    <div className='w-full mb-4 animate-fade-in animate-duration-400 animate-ease-out'>
      <div className='flex items-center gap-6px mb-10px'>
        <span className='text-13px text-foreground-secondary'>💡 {t('guid.promptTemplates.title', { defaultValue: '常用提示词' })}</span>
      </div>

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

      {activeCategory && currentCategory && (
        <div className='flex flex-wrap gap-2 mt-2 animate-fade-in animate-duration-400 animate-ease-out'>
          {currentCategory.prompts.map((prompt) => (
            <Button key={prompt.labelKey} size='small' shape='square' className='border! border-border!' onClick={() => onSelectPrompt(t(prompt.contentKey))}>
              {t(prompt.labelKey)}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

interface IPromptTemplatesProps {
  visible: boolean;
  /** Brand-configured scenarios (plain strings). When provided, replaces the default category tabs. */
  scenarios?: BrandPromptScenario[];
  onSelectPrompt: (content: string) => void;
}
