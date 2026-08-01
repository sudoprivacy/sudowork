/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import classNames from 'classnames';
import sudoclawProDark from '@/renderer/assets/sudoclaw_transparent_large.png';

const sudoclawProWhite = sudoclawProDark;

const isDarkMode = () => {
  if (typeof document === 'undefined') return false;
  return document.documentElement.getAttribute('data-theme') === 'dark';
};

const MessageLoadingIndicator: React.FC = () => {
  const [darkMode, setDarkMode] = React.useState(() => isDarkMode());

  React.useEffect(() => {
    const observer = new MutationObserver(() => {
      setDarkMode(isDarkMode());
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const streamingAvatar = darkMode ? sudoclawProDark : sudoclawProWhite;

  return (
    <div className={classNames('min-w-0 flex w-full message-item [&>div]:max-w-full m-t-10px max-w-full md:max-w-800px mx-auto group justify-start')}>
      <div className='flex items-center text-foreground-secondary'>
        <img src={streamingAvatar} alt='AI Loading Avatar' className='loading w-40px h-40px max-w-none object-contain' />
      </div>
    </div>
  );
};

export default MessageLoadingIndicator;
