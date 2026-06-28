import { Tabs } from '@arco-design/web-react';
import { Communication } from '@icon-park/react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PageWrapper from '@renderer/components/base/PageWrapper';
import ChannelDingTalkLogo from '@/renderer/assets/channel-logos/dingtalk.svg';
import ChannelLarkLogo from '@/renderer/assets/channel-logos/lark.svg';
import ChannelTelegramLogo from '@/renderer/assets/channel-logos/telegram.svg';
import ChannelWeChatLogo from '@/renderer/assets/channel-logos/wechat.svg';
import { useAppMode } from '@/renderer/hooks/useAppMode';
import SecretModalContent from './components/SecretModalContent';
import ChannelModalContent from './components/ChannelModalContent';

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

  return (
    <PageWrapper title={t('common.siderMenu.webui')}>
      <div className='flex flex-col h-full w-full mt-4'>
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

        <div className='flex-1 min-h-0 pb-4'>{activeTab === 'secrets' ? <SecretModalContent /> : <ChannelModalContent />}</div>
      </div>
    </PageWrapper>
  );
};

export default WebuiSettings;
