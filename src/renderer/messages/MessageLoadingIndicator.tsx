import React from 'react';
import classNames from 'classnames';
import sudoclawProDark from '@/renderer/assets/sudoclaw_transparent_large.png';
import sudoclawProWhite from '@/renderer/assets/sudoclaw_transparent_large.png';

// Helper to detect current theme
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
    <div
      className={classNames(
        'min-w-0 flex items-start message-item [&>div]:max-w-full px-8px m-t-10px max-w-full md:max-w-780px mx-auto group',
        'justify-start'
      )}
    >
      <div className="flex-shrink-0 mr-12px mt-4px w-24px h-24px relative">
        <img
          src={streamingAvatar}
          alt='AI Loading Avatar'
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-40px h-40px max-w-none object-contain"
        />
      </div>
      {/* Intentionally left empty - we do NOT want a message bubble, just the pulsing avatar */}
    </div>
  );
};

export default MessageLoadingIndicator;
