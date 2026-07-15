import { Notification } from '@arco-design/web-react';
import { Copy } from '@icon-park/react';
import React from 'react';
import { copyText } from './clipboard';

const SHARE_NOTIFY_ID = 'shareone-share';

interface ShareNotifyOptions {
  title?: string;
}

/**
 * Show loading notification for share operation
 * @returns notification id for later update
 */
export function showShareLoading(options?: ShareNotifyOptions): string {
  Notification.info({
    id: SHARE_NOTIFY_ID,
    title: options?.title || 'ShareOne',
    content: React.createElement('div', { className: 'flex items-center gap-8px' }, React.createElement('span', { className: 'arco-notification-loading-icon' }), React.createElement('span', null, '分享中...')),
    duration: 0, // Don't auto close
    closable: false,
    position: 'topRight',
  });
  return SHARE_NOTIFY_ID;
}

/**
 * Update notification to show success with share URL
 * Note: URL is automatically copied to clipboard before showing the notification
 */
export function updateShareSuccess(id: string, url: string): void {
  // Auto copy URL to clipboard
  copyText(url).catch(() => {
    // Silently ignore copy errors - user can still manually copy from notification
  });

  const handleCopy = () => {
    void copyText(url);
    Notification.success({
      id: 'shareone-copy-success',
      title: 'ShareOne',
      content: '链接已复制',
      duration: 2000,
      position: 'topRight',
    });
  };

  Notification.success({
    id: id || SHARE_NOTIFY_ID,
    title: 'ShareOne',
    content: React.createElement(
      'div',
      { className: 'flex flex-col gap-8px' },
      React.createElement('div', { className: 'flex items-center gap-8px' }, React.createElement('span', { className: 'text-13px color-success font-500' }, '分享成功，链接已复制')),
      React.createElement(
        'div',
        { className: 'flex items-center gap-8px' },
        React.createElement(
          'a',
          {
            href: url,
            target: '_blank',
            rel: 'noopener noreferrer',
            className: 'text-12px color-primary underline break-all max-w-200px truncate hover:opacity-80',
          },
          url
        ),
        React.createElement(
          'span',
          {
            className: 'cursor-pointer color-primary opacity-70 hover:opacity-100 transition-opacity',
            onClick: handleCopy,
            style: { lineHeight: 0 },
          },
          React.createElement(Copy, { theme: 'outline', size: '14' })
        )
      )
    ),
    duration: 5000,
    closable: true,
    position: 'topRight',
  });
}

/**
 * Update notification to show error
 */
export function updateShareError(id: string, errorMsg: string): void {
  Notification.error({
    id: id || SHARE_NOTIFY_ID,
    title: 'ShareOne',
    content: React.createElement('div', { className: 'flex flex-col gap-4px' }, React.createElement('span', { className: 'text-13px color-error font-500' }, '分享失败'), React.createElement('span', { className: 'text-12px color-text-3 break-all max-w-200px' }, errorMsg)),
    duration: 8000,
    closable: true,
    position: 'topRight',
  });
}
