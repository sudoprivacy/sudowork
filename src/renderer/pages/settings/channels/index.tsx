import { Tabs } from '@arco-design/web-react';
import { Communication } from '@icon-park/react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PageWrapper from '@renderer/components/base/PageWrapper';
import { useAppMode } from '@/renderer/hooks/useAppMode';
import { CHANNEL_LOGOS } from './utils';
import SecretPanel from './components/SecretPanel';
import ChannelPanel from './components/ChannelPanel';

const Page: React.FC = () => {
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
                  <span>{t('settings.channels.title', '渠道配置')}</span>
                  <span className='inline-flex items-center gap-4px ml-2px'>
                    {CHANNEL_LOGOS.map((item) => (
                      <span key={item.alt} className='inline-flex items-center justify-center w-16px h-16px' title={item.alt} aria-label={item.alt}>
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

        <div className='flex-1 min-h-0 pb-4'>{activeTab === 'secrets' ? <SecretPanel /> : <ChannelPanel />}</div>
      </div>
    </PageWrapper>
  );
};

export default Page;
