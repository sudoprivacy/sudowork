/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Input, Message, Spin } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import brand from '@brand';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import PageWrapper from '@/renderer/components/base/PageWrapper';

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
      title={t('settings.systemPrompt')}
      subtitle={t('settings.systemPromptEditor.description')}
      actions={
        <Button type='primary' loading={isSaving} disabled={isSaveDisabled} onClick={onSave}>
          {t('common.save')}
        </Button>
      }
    >
      <AionScrollArea className='h-full pb-4' disableOverflow>
        <div className='flex min-h-120 flex-col gap-3 border border-border bg-card p-6 rd-16px'>
          <div className='text-13px text-foreground-secondary'>{t('settings.systemPromptEditor.currentAssistant', { agentId: brand.displayName })}</div>
          {isLoading ? (
            <div className='flex flex-1 items-center justify-center'>
              <Spin />
            </div>
          ) : (
            <Input.TextArea value={content} onChange={setContent} placeholder={t('settings.systemPromptEditor.placeholder')} autoSize={false} className='min-h-100 flex-1 font-mono resize-none' />
          )}
        </div>
      </AionScrollArea>
    </PageWrapper>
  );
}
