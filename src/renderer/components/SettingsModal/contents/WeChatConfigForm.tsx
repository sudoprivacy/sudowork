/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { sudoclaw } from '@/common/ipcBridge';
import { Button, Message, Spin } from '@arco-design/web-react';
import { Refresh } from '@icon-park/react';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';

interface WeChatConfigFormProps {
  installed: boolean;
  onInstalled: () => void;
}

type InstallPhase = 'idle' | 'installing' | 'qrcode' | 'success' | 'error';

const WeChatConfigForm: React.FC<WeChatConfigFormProps> = ({ installed, onInstalled }) => {
  const { t } = useTranslation();

  const [phase, setPhase] = useState<InstallPhase>(installed ? 'success' : 'idle');
  const [qrUrl, setQrUrl] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Sync installed prop to phase
  useEffect(() => {
    if (installed && phase === 'idle') {
      setPhase('success');
    }
  }, [installed, phase]);

  // Listen for install progress events
  useEffect(() => {
    const unsubscribe = sudoclaw.wechatInstallProgress.on(({ phase: p, message, qrUrl: url }) => {
      console.log('[WeChatConfig] Received event:', p, url ? 'has URL' : 'no URL');
      if (p === 'installing') {
        setPhase('installing');
        setErrorMessage('');
      } else if (p === 'qrcode') {
        setPhase('qrcode');
        if (url) {
          console.log('[WeChatConfig] Setting QR URL:', url);
          setQrUrl(url);
        }
      } else if (p === 'scanning') {
        setPhase('success');
      } else if (p === 'success') {
        setPhase('success');
        onInstalled();
        Message.success(t('settings.channels.wechat.installSuccess', '微信插件安装成功'));
      } else if (p === 'error') {
        setPhase('error');
        setErrorMessage(message || t('settings.channels.wechat.installFailed', '安装失败'));
      }
    });
    return () => unsubscribe();
  }, [onInstalled, t]);

  // Handle install click
  const handleInstall = useCallback(async () => {
    setPhase('installing');
    setErrorMessage('');
    setQrUrl('');

    try {
      const result = await sudoclaw.installWechatPlugin.invoke();
      if (!result.success) {
        setPhase('error');
        setErrorMessage(result.msg || t('settings.channels.wechat.installFailed', '安装失败'));
      }
    } catch (error: any) {
      setPhase('error');
      setErrorMessage(error.message || String(error));
    }
  }, [t]);

  const renderQRCodeSection = () => {
    if (phase !== 'qrcode') return null;

    return (
      <div className='flex flex-col items-center gap-12px p-16px rd-8px bg-fill-1 border border-fill-3'>
        <div className='text-14px font-500 text-t-primary'>{t('settings.channels.wechat.scanQR', 'Scan with WeChat')}</div>
        <div className='bg-white rd-8px p-12px'>
          {qrUrl ? (
            <QRCodeSVG value={qrUrl} size={200} level='H' />
          ) : (
            <div className='flex flex-col items-center gap-8px'>
              <Spin size={32} />
              <span className='text-12px text-t-tertiary'>{t('settings.channels.wechat.loadingQR', 'Loading QR code...')}</span>
            </div>
          )}
        </div>
        <div className='text-12px text-t-tertiary'>{t('settings.channels.wechat.scanHint', 'Open WeChat on your phone and scan the QR code above')}</div>
      </div>
    );
  };

  const renderInstallSection = () => {
    if (phase === 'success' || installed) {
      return (
        <div className='flex items-center gap-8px p-12px rd-8px bg-[rgba(var(--green-6),0.08)] border border-[rgba(var(--green-6),0.3)]'>
          <div className='w-8px h-8px rd-50% bg-green-500' />
          <span className='text-13px text-t-primary'>{t('settings.channels.wechat.connected', '微信插件已安装并启用')}</span>
        </div>
      );
    }

    if (phase === 'installing') {
      return (
        <div className='flex flex-col items-center gap-12px p-24px'>
          <Spin size={32} />
          <span className='text-14px text-t-secondary'>{t('settings.channels.wechat.installing', '正在安装微信插件...')}</span>
        </div>
      );
    }

    if (phase === 'error') {
      return (
        <div className='flex flex-col gap-12px p-12px rd-8px bg-[rgba(var(--red-6),0.08)] border border-[rgba(var(--red-6),0.3)]'>
          <div className='text-13px text-red-500'>{errorMessage}</div>
          <Button type='outline' status='warning' onClick={handleInstall} className='self-start'>
            <Refresh size={14} className='mr-4px' />
            {t('common.retry', 'Retry')}
          </Button>
        </div>
      );
    }

    return (
      <div className='flex flex-col gap-12px'>
        <div className='text-13px text-t-secondary leading-relaxed'>{t('settings.channels.wechat.installDesc', '点击下方按钮安装个人微信渠道插件到 Sudoclaw。')}</div>
        <Button type='primary' onClick={handleInstall} className='self-start'>
          {t('settings.channels.wechat.install', '安装微信插件')}
        </Button>
      </div>
    );
  };

  return (
    <div className='flex flex-col gap-24px'>
      {renderInstallSection()}
      {renderQRCodeSection()}
    </div>
  );
};

export default WeChatConfigForm;
