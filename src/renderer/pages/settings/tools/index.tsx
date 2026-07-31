/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Form, Select, Switch } from '@arco-design/web-react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { migrateImageGenerationModelConfig, pickDefaultImageModelFromPricing, pickImageGenerationModelId } from '@/common/imageGenerationModelConfig';
import { scode } from '@/common/ipcBridge';
import { ConfigStorage, type IConfigStorageRefer } from '@/common/storage';
import AionScrollArea from '@renderer/components/base/AionScrollArea';
import PageWrapper from '@renderer/components/base/PageWrapper';
import McpManagementSection from './components/McpManagementSection';

export default function ToolsSettings() {
  const { t } = useTranslation();
  const [imageGenerationModel, setImageGenerationModel] = useState<IConfigStorageRefer['tools.imageGenerationModel'] | undefined>();
  const [imageOptions, setImageOptions] = useState<{ label: string; value: string }[]>([]);
  const [isImageListLoading, setIsImageListLoading] = useState(false);
  const [isImageListError, setIsImageListError] = useState(false);

  const syncImageGenerationModel = useCallback((modelConfig: IConfigStorageRefer['tools.imageGenerationModel']) => {
    const modelId = pickImageGenerationModelId(modelConfig);
    return scode.setImageModel.invoke({ modelId }).catch(console.error);
  }, []);

  useEffect(() => {
    const loadConfigs = async () => {
      try {
        setIsImageListLoading(true);
        const result = await scode.fetchSpecificImagePricing.invoke().catch((): null => null);
        setIsImageListLoading(false);

        if (result?.success && Array.isArray(result.data)) {
          setImageOptions(result.data.map((item) => ({ label: item.model_id, value: item.model_id })));
          setIsImageListError(false);

          const defaultModelId = pickDefaultImageModelFromPricing(result.data);
          const saved = await ConfigStorage.get('tools.imageGenerationModel');
          const alreadyMigrated = (await ConfigStorage.get('migration.imageGenerationModelDefaultMigrated').catch((): boolean => false)) === true;
          const { config, changed } = migrateImageGenerationModelConfig(saved, alreadyMigrated, defaultModelId);

          setImageGenerationModel(config);
          if (changed) {
            await ConfigStorage.set('tools.imageGenerationModel', config).catch(() => {});
            await syncImageGenerationModel(config);
          }
          if (!alreadyMigrated) {
            await ConfigStorage.set('migration.imageGenerationModelDefaultMigrated', true).catch(() => {});
          }
        } else {
          // Fetch failed: empty dropdown + error hint; leave ConfigStorage untouched (keep old value).
          setImageOptions([]);
          setIsImageListError(true);
          setImageGenerationModel(await ConfigStorage.get('tools.imageGenerationModel').catch((): undefined => undefined));
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
    <PageWrapper contentClassName='max-w-300' title={t('settings.tools', '工具')}>
      <div className='flex flex-col h-full w-full'>
        <AionScrollArea className='flex-1 min-h-0 pb-4' disableOverflow>
          <div className='space-y-4'>
            <div className='px-3 md:px-8 py-6 bg-muted rd-12px md:rd-16px flex flex-col min-h-0 border border-light'>
              <div className='flex-1 min-h-0'>
                <AionScrollArea className='h-full overflow-visible' disableOverflow>
                  <McpManagementSection />
                </AionScrollArea>
              </div>
            </div>

            <div className='px-3 md:px-8 py-6 bg-muted rd-12px md:rd-16px border border-light'>
              <div className='flex items-center justify-between'>
                <span className='text-14px text-foreground'>{t('settings.imageGeneration', '图像生成')}</span>
                <Switch checked={imageGenerationModel?.switch} onChange={(checked) => onImageGenerationModelChange({ switch: checked })} className='settings-accent-switch' style={imageGenerationModel?.switch ? { backgroundColor: 'var(--ui-accent-orange)' } : undefined} />
              </div>

              <div className='my-5 border-b border-light' />

              <Form layout='horizontal' labelAlign='left' className='space-y-3'>
                <Form.Item label={t('settings.imageGenerationModel', '图像模型')}>
                  <Select
                    value={imageGenerationModel?.useModel ?? ''}
                    disabled={!imageGenerationModel?.switch || isImageListLoading || isImageListError}
                    onChange={(val) => {
                      onImageGenerationModelChange({ useModel: val as string });
                    }}
                    options={imageOptions}
                    style={{ minWidth: 260 }}
                  />
                  {isImageListLoading && <div className='text-12px text-secondary mt-8px'>{t('settings.imageModelLoading')}</div>}
                  {isImageListError && <div className='text-12px text-secondary mt-8px'>{t('settings.imageModelListLoadFailed')}</div>}
                </Form.Item>
              </Form>
            </div>
          </div>
        </AionScrollArea>
      </div>
    </PageWrapper>
  );
}
