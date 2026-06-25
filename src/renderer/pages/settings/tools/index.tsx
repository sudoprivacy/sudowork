import { Form, Message, Select, Switch } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { migrateImageGenerationModelConfig, pickImageGenerationModelId } from '@/common/imageGenerationModelConfig';
import { scode } from '@/common/ipcBridge';
import { ConfigStorage, DEFAULT_IMAGE_GENERATION_MODEL, type IConfigStorageRefer } from '@/common/storage';
import AionScrollArea from '@renderer/components/base/AionScrollArea';
import PageWrapper from '@renderer/components/base/PageWrapper';
import McpManagementSection from './components/McpManagementSection';

type ImageGenerationModelOption = {
  label: string;
  value: string;
};

const IMAGE_GENERATION_MODEL_OPTIONS: ImageGenerationModelOption[] = [
  { label: 'gemini-3.1-flash-image', value: 'gemini-3.1-flash-image' },
  { label: 'gemini-3-pro-image', value: 'gemini-3-pro-image' },
  { label: 'gemini-2.5-flash-image', value: 'gemini-2.5-flash-image' },
  { label: 'gpt-image-1.5', value: 'gpt-image-1.5' },
  { label: 'gpt-image-1', value: 'gpt-image-1' },
  { label: 'doubao-seedream-4-0-250828', value: 'doubao-seedream-4-0-250828' },
];

export default function ToolsSettings() {
  const { t } = useTranslation();
  const [mcpMessage, mcpMessageContext] = Message.useMessage({ maxCount: 10 });
  const [imageGenerationModel, setImageGenerationModel] = useState<IConfigStorageRefer['tools.imageGenerationModel'] | undefined>();

  const syncImageGenerationModel = useCallback((modelConfig: IConfigStorageRefer['tools.imageGenerationModel']) => {
    const modelId = pickImageGenerationModelId(modelConfig);
    return scode.setImageModel.invoke({ modelId }).catch(console.error);
  }, []);

  useEffect(() => {
    const loadConfigs = async () => {
      try {
        const saved = await ConfigStorage.get('tools.imageGenerationModel');
        const alreadyMigrated = (await ConfigStorage.get('migration.imageGenerationModelDefaultMigrated').catch((): boolean => false)) === true;
        const { config, changed } = migrateImageGenerationModelConfig(saved, alreadyMigrated);

        setImageGenerationModel(config);
        if (changed) {
          await ConfigStorage.set('tools.imageGenerationModel', config).catch(() => {});
          await syncImageGenerationModel(config);
        }
        if (!alreadyMigrated) {
          await ConfigStorage.set('migration.imageGenerationModelDefaultMigrated', true).catch(() => {});
        }
      } catch (error) {
        console.error('Failed to load image generation model config:', error);
      }
    };

    void loadConfigs();
  }, [syncImageGenerationModel]);

  const onImageGenerationModelChange = (value: Partial<IConfigStorageRefer['tools.imageGenerationModel']>) => {
    setImageGenerationModel((prev) => {
      const newImageGenerationModel = { ...prev, ...value } as IConfigStorageRefer['tools.imageGenerationModel'];
      ConfigStorage.set('tools.imageGenerationModel', newImageGenerationModel).catch((error) => {
        console.error('Failed to update image generation model config:', error);
      });
      void syncImageGenerationModel(newImageGenerationModel);
      return newImageGenerationModel;
    });
  };

  return (
    <PageWrapper contentClassName='max-w-300' title={t('settings.tools')}>
      <div className='flex flex-col h-full w-full'>
        {mcpMessageContext}

        <AionScrollArea className='flex-1 min-h-0 pb-16px' disableOverflow>
          <div className='space-y-16px'>
            <div className='px-[12px] md:px-[32px] py-[24px] bg-2 rd-12px md:rd-16px flex flex-col min-h-0 border border-light'>
              <div className='flex-1 min-h-0'>
                <AionScrollArea className='h-full overflow-visible' disableOverflow>
                  <McpManagementSection message={mcpMessage} />
                </AionScrollArea>
              </div>
            </div>

            <div className='px-[12px] md:px-[32px] py-[24px] bg-2 rd-12px md:rd-16px border border-light'>
              <div className='flex items-center justify-between'>
                <span className='text-14px text-foreground'>{t('settings.imageGeneration')}</span>
                <Switch checked={imageGenerationModel?.switch} onChange={(checked) => onImageGenerationModelChange({ switch: checked })} className='settings-accent-switch' style={imageGenerationModel?.switch ? { backgroundColor: 'var(--ui-accent-orange)' } : undefined} />
              </div>

              <div className='my-5 border-b border-light' />

              <Form layout='horizontal' labelAlign='left' className='space-y-12px'>
                <Form.Item label={t('settings.imageGenerationModel')}>
                  <Select
                    value={imageGenerationModel?.useModel || DEFAULT_IMAGE_GENERATION_MODEL}
                    disabled={!imageGenerationModel?.switch}
                    onChange={(val) => {
                      onImageGenerationModelChange({ useModel: val as string });
                    }}
                    options={IMAGE_GENERATION_MODEL_OPTIONS}
                    style={{ minWidth: 260 }}
                  />
                </Form.Item>
              </Form>
            </div>
          </div>
        </AionScrollArea>
      </div>
    </PageWrapper>
  );
}
