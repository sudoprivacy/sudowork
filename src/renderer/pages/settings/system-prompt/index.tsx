/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Message, Spin } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import brand from '@brand';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import Markdown from '@/renderer/components/Markdown';
import PageWrapper from '@/renderer/components/base/PageWrapper';
import MarkdownEditor from '@/renderer/pages/conversation/preview/components/editors/MarkdownEditor';

export default function SystemPromptSettings() {
  const { t } = useTranslation();
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    const loadSystemPrompt = async () => {
      try {
        const { content: loadedContent } = await ipcBridge.systemSettings.getDefaultAssistantSystemPrompt.invoke();
        setContent(loadedContent);
        setSavedContent(loadedContent);
      } catch {
        Message.error(t('settings.systemPromptEditor.loadFailed'));
      } finally {
        setIsLoading(false);
      }
    };

    void loadSystemPrompt();
  }, [t]);

  const onSave = async () => {
    if (!content.trim()) {
      Message.warning(t('settings.systemPromptEditor.emptyError'));
      return;
    }

    setIsSaving(true);
    try {
      await ipcBridge.systemSettings.setDefaultAssistantSystemPrompt.invoke({ content });
      setSavedContent(content);
      Message.success(t('settings.systemPromptEditor.saveSuccess'));
    } catch {
      Message.error(t('settings.systemPromptEditor.saveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const isSaveDisabled = isLoading || isSaving || !content.trim() || content === savedContent;

  return (
    <PageWrapper
      isFullWidth
      className='h-full overflow-hidden'
      contentClassName='h-full flex flex-col'
      title={t('settings.systemPrompt')}
      subtitle={t('settings.systemPromptEditor.description')}
      actions={
        <Button type='primary' loading={isSaving} disabled={isSaveDisabled} onClick={onSave}>
          {t('common.save')}
        </Button>
      }
    >
      <AionScrollArea className='min-h-0 flex-1 pb-4' disableOverflow>
        <div className='flex h-full min-h-0 flex-col gap-3'>
          <div className='text-13px text-foreground-secondary'>{t('settings.systemPromptEditor.currentAssistant', { agentId: brand.displayName })}</div>
          {isLoading ? (
            <div className='flex flex-1 items-center justify-center'>
              <Spin />
            </div>
          ) : (
            <div className='grid min-h-0 flex-1 grid-cols-2 overflow-hidden border border-border rd-8px'>
              <div className='min-w-0 overflow-hidden border-r border-border'>
                <MarkdownEditor value={content} onChange={setContent} />
              </div>
              <div className='min-w-0 overflow-auto p-4'>
                <Markdown>{content}</Markdown>
              </div>
            </div>
          )}
        </div>
      </AionScrollArea>
    </PageWrapper>
  );
}
