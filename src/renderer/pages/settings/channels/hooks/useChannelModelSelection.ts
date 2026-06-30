import { Message } from '@arco-design/web-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { channel } from '@/common/ipcBridge';
import { ConfigStorage } from '@/common/storage';
import type { IProvider, TProviderWithModel } from '@/common/storage';
import type { ChannelModelConfigKey, GeminiModelSelection } from '../types';
import { useGeminiModelSelection } from './useGeminiModelSelection';
import { useModelProviderList } from './useModelProviderList';

export function useChannelModelSelection(configKey: ChannelModelConfigKey): GeminiModelSelection {
  const { t } = useTranslation();

  // Resolve persisted model into a full TProviderWithModel for initialModel.
  // useModelProviderList is SWR-backed so the duplicate call inside
  // useGeminiModelSelection is deduplicated automatically.
  const { providers } = useModelProviderList();
  const [resolvedInitialModel, setResolvedInitialModel] = useState<TProviderWithModel | undefined>(undefined);
  const [isRestored, setIsRestored] = useState(false);

  useEffect(() => {
    if (isRestored || providers.length === 0) return;

    const restore = async () => {
      try {
        const saved = (await ConfigStorage.get(configKey)) as { id: string; useModel: string } | undefined;
        if (!saved?.id || !saved?.useModel) {
          // Nothing saved - mark restored so we don't keep retrying.
          setIsRestored(true);
          return;
        }

        const provider = providers.find((p) => p.id === saved.id);
        if (!provider) {
          // Provider not found in current list - don't mark as restored.
          // The Google Auth provider may load after API-key providers;
          // leaving isRestored=false lets this effect re-run when providers update.
          return;
        }

        // Google Auth provider's model array only contains top-level modes
        // ('auto', 'auto-gemini-2.5', 'manual'), but sub-model values like
        // 'gemini-2.5-flash' are also valid - skip strict membership check.
        const isGoogleAuth = provider.platform?.toLowerCase().includes('gemini-with-google-auth');
        if (isGoogleAuth || provider.model?.includes(saved.useModel)) {
          setResolvedInitialModel({
            ...provider,
            useModel: saved.useModel,
          } as TProviderWithModel);
        }
        setIsRestored(true);
      } catch (error) {
        console.error(`[ChannelSettings] Failed to restore model for ${configKey}:`, error);
        setIsRestored(true);
      }
    };

    void restore();
  }, [configKey, providers, isRestored]);

  const onSelectModel = useCallback(
    async (provider: IProvider, modelName: string) => {
      try {
        const modelRef = { id: provider.id, useModel: modelName };
        await ConfigStorage.set(configKey, modelRef);

        const platform = configKey.replace('assistant.', '').replace('.defaultModel', '') as 'telegram' | 'lark' | 'dingtalk' | 'wechat';
        const agentKey = `assistant.${platform}.agent` as const;
        const currentAgent = await ConfigStorage.get(agentKey);
        await channel.syncChannelSettings
          .invoke({
            platform,
            agent: (currentAgent as { backend: string; customAgentId?: string; name?: string }) || { backend: 'gemini' },
            model: modelRef,
          })
          .catch((err) => console.warn(`[ChannelSettings] syncChannelSettings failed for ${platform}:`, err));

        return true;
      } catch (error) {
        console.error(`[ChannelSettings] Failed to save model for ${configKey}:`, error);
        Message.error(t('settings.assistant.modelSaveFailed', 'Failed to save model'));
        return false;
      }
    },
    [configKey, t]
  );

  return useGeminiModelSelection({ initialModel: resolvedInitialModel, onSelectModel });
}
