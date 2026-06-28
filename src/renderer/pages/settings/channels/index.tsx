import { Tabs } from '@arco-design/web-react';
import { Communication } from '@icon-park/react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import ChannelModalContent from '@/renderer/components/SettingsModal/contents/ChannelModalContent';
import SecretModalContent from '@/renderer/components/SettingsModal/contents/secrets/SecretModalContent';
import PageWrapper from '@renderer/components/base/PageWrapper';
import ChannelDingTalkLogo from '@/renderer/assets/channel-logos/dingtalk.svg';
import ChannelLarkLogo from '@/renderer/assets/channel-logos/lark.svg';
import ChannelTelegramLogo from '@/renderer/assets/channel-logos/telegram.svg';
import ChannelWeChatLogo from '@/renderer/assets/channel-logos/wechat.svg';
import { useAppMode } from '@/renderer/hooks/useAppMode';
import { isElectronDesktop } from '@/renderer/utils/platform';

const CHANNEL_LOGOS = [
  { src: ChannelWeChatLogo, alt: 'WeChat' },
  { src: ChannelTelegramLogo, alt: 'Telegram' },
  { src: ChannelLarkLogo, alt: 'Lark' },
  { src: ChannelDingTalkLogo, alt: 'DingTalk' },
] as const;

const WebuiSettings: React.FC = () => {
  const { t } = useTranslation();
  const { isEnterprise } = useAppMode();
  const [activeTab, setActiveTab] = useState<'channels' | 'secrets'>('channels');

  const onTabChange = useCallback((key: string) => {
    setActiveTab(key === 'channels' ? 'channels' : 'secrets');
  }, []);

  const isDesktop = isElectronDesktop();

  return (
    <PageWrapper title={t('common.siderMenu.webui')}>
      {!isDesktop ? (
        <div className='flex flex-col h-full w-full'>
          <AionScrollArea className='flex-1 min-h-0 pb-16px' disableOverflow>
            <div className='space-y-16px'>
              <h2 className='text-20px font-500 text-foreground m-0'>Channels</h2>
              <ChannelModalContent />
            </div>
          </AionScrollArea>
        </div>
      ) : (
        <div className='flex flex-col h-full w-full'>
          <div className='settings-remote-tabs mb-12px'>
            <Tabs activeTab={activeTab} onChange={onTabChange} type='line'>
              <Tabs.TabPane
                key='channels'
                title={
                  <span data-webui-tab='channels' className={`inline-flex items-center gap-6px leading-none transition-colors ${activeTab === 'channels' ? 'text-foreground font-600' : 'text-secondary'}`}>
                    <Communication theme='outline' size='15' />
                    <span>Channels</span>
                    <span className='inline-flex items-center gap-4px ml-2px'>
                      {CHANNEL_LOGOS.map((item) => (
                        <span key={item.alt} className='inline-flex items-center justify-center w-16px h-16px rd-50% border bg-fill-1' title={item.alt} aria-label={item.alt}>
                          <img src={item.src} alt={item.alt} className='w-14px h-14px object-contain' />
                        </span>
                      ))}
                    </span>
                  </span>
                }
              />
              <Tabs.TabPane
                key='secrets'
                title={
                  <span data-webui-tab='secrets' className={`inline-flex items-center gap-6px leading-none transition-colors ${activeTab === 'secrets' ? 'text-foreground font-600' : 'text-secondary'}`}>
                    <span className='text-14px'>{isEnterprise ? t('settings.secrets.enterprise', '我的凭据') : t('settings.secrets', '秘钥管理')}</span>
                  </span>
                }
              />
            </Tabs>
          </div>

          <div className='flex-1 min-h-0 py-4 px-6'>{activeTab === 'secrets' ? <SecretModalContent /> : <ChannelModalContent />}</div>
        </div>
      )}
    </PageWrapper>
  );
};

export default WebuiSettings;
