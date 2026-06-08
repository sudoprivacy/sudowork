import React from 'react';
import classNames from 'classnames';
import sudoclawProDark from '@/renderer/assets/sudoclaw_transparent_large.png';
import { useTranslation } from 'react-i18next';

const sudoclawProWhite = sudoclawProDark;

const isDarkMode = () => {
  if (typeof document === 'undefined') return false;
  return document.documentElement.getAttribute('data-theme') === 'dark';
};

const MessageLoadingIndicator: React.FC = () => {
  const { t } = useTranslation();
  const [darkMode, setDarkMode] = React.useState(() => isDarkMode());

  React.useEffect(() => {
    const observer = new MutationObserver(() => {
      setDarkMode(isDarkMode());
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const streamingAvatar = darkMode ? sudoclawProDark : sudoclawProWhite;
  const thinkingLabel = t('codex.thinking.processing', { defaultValue: '正在思考...' })
    .replace(/^🤔\s*/u, '')
    .replace(/^Codex\s*/u, '');

  return (
    <div className={classNames('min-w-0 flex w-full message-item [&>div]:max-w-full m-t-10px max-w-full md:max-w-800px mx-auto group justify-start')}>
      <div className='flex items-center gap-8px text-t-secondary'>
        <img src={streamingAvatar} alt='AI Loading Avatar' className='loading w-40px h-40px max-w-none object-contain' />
        <span className='text-13px leading-20px'>{thinkingLabel}</span>
      </div>
    </div>
  );
};

export default MessageLoadingIndicator;
