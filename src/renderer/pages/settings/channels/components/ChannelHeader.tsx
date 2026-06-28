import { Switch, Tag } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import ChannelDingTalkLogo from '@/renderer/assets/channel-logos/dingtalk.svg';
import ChannelLarkLogo from '@/renderer/assets/channel-logos/lark.svg';
import ChannelTelegramLogo from '@/renderer/assets/channel-logos/telegram.svg';
import ChannelWeChatLogo from '@/renderer/assets/channel-logos/wechat.svg';
import ChannelWeComLogo from '@/renderer/assets/channel-logos/wecom.svg';
import ChannelZentaoLogo from '@/renderer/assets/channel-logos/zentao.svg';
import { resolveExtensionAssetUrl } from '@/renderer/utils/platform';
import type { ChannelConfig } from '../types';

interface ChannelHeaderProps {
  channel: ChannelConfig;
  onToggleEnabled?: (enabled: boolean) => void;
  collapsed?: boolean;
}

const ChannelHeader: React.FC<ChannelHeaderProps> = ({ channel, onToggleEnabled }) => {
  const { t } = useTranslation();
  const channelLogoMap: Record<string, { src: string; alt: string }> = {
    telegram: { src: ChannelTelegramLogo, alt: 'Telegram' },
    lark: { src: ChannelLarkLogo, alt: 'Lark' },
    dingtalk: { src: ChannelDingTalkLogo, alt: 'DingTalk' },
    wechat: { src: ChannelWeChatLogo, alt: 'WeChat' },
    wecom: { src: ChannelWeComLogo, alt: 'WeCom' },
    zentao: { src: ChannelZentaoLogo, alt: 'Zentao' },
  };
  const builtinLogo = channelLogoMap[channel.id];
  // Extension channels may provide a custom icon via ChannelConfig
  // Resolve aion-asset:// or file:// URLs for the current environment
  const logoSrc = builtinLogo?.src || resolveExtensionAssetUrl(channel.icon);
  const logoAlt = builtinLogo?.alt || channel.title;
  const isDisabled = channel.status === 'coming_soon' || channel.disabled;

  const statusText = channel.isConnected ? t('settings.channels.connected', { defaultValue: '已连接' }) : channel.enabled ? t('settings.channels.enabled', { defaultValue: '已启用' }) : t('settings.channels.disabled', { defaultValue: '未启用' });

  return (
    <div className='flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 md:px-4 group min-h-11' data-channel-header={channel.id}>
      <div className='ml-4 flex size-7 items-center justify-center rd-7px'>{logoSrc && <img src={logoSrc} alt={logoAlt} className='size-4.5 object-contain shrink-0' />}</div>
      <div className='flex min-w-30 flex-1 items-center gap-2'>
        <span className='truncate text-14px font-600 leading-none text-foreground'>{channel.title}</span>
        {channel.status === 'coming_soon' && (
          <Tag size='small' color='gray'>
            {t('settings.channels.comingSoon', 'Coming Soon')}
          </Tag>
        )}
      </div>
      <span className={channel.isConnected ? 'whitespace-nowrap text-13px font-500 leading-none text-success' : 'whitespace-nowrap text-13px leading-none text-secondary'}>
        <span className={channel.isConnected ? 'mr-1.5 inline-block size-[5px] rd-full bg-success align-middle' : 'mr-1.5 inline-block size-[5px] rd-full bg-warning align-middle'} />
        {statusText}
      </span>
      <div className='ml-auto flex items-center justify-end' onClick={(e) => e.stopPropagation()}>
        <Switch
          data-channel-switch-for={channel.id}
          data-channel-switch-disabled={isDisabled ? 'true' : 'false'}
          aria-disabled={isDisabled ? 'true' : undefined}
          checked={channel.enabled}
          onChange={onToggleEnabled}
          size='small'
          disabled={isDisabled}
          className='settings-accent-switch'
          style={channel.enabled ? { backgroundColor: 'var(--ui-accent-orange)' } : undefined}
        />
      </div>
    </div>
  );
};

export default ChannelHeader;
