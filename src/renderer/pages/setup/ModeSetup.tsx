/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Button, Input, Message } from '@arco-design/web-react';
import { ipcBridge } from '@/common';
import { ConfigStorage } from '@/common/storage';
import { setAppMode } from '@/common/eeclawMode';
import SudoworkIcon from '@/renderer/assets/sudowork-icon-dark.svg';
import WindowControls from '@/renderer/components/WindowControls';
import './ModeSetup.css';

const isDesktopRuntime = typeof window !== 'undefined' && Boolean(window.electronAPI);

type CardType = 'consumer' | 'enterprise' | null;

function isValidServerUrl(url: string): boolean {
  // E2E test bypass
  if (typeof window !== 'undefined' && (window as unknown as Record<string, boolean>).__E2E_TEST__) {
    return url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1');
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    // const hostname = parsed.hostname.toLowerCase();
    // if (hostname === 'localhost' || hostname === '127.0.0.1') return false;
    return true;
  } catch {
    return false;
  }
}

const ModeSetup: React.FC = () => {
  const [selectedCard, setSelectedCard] = useState<CardType>(null);
  const [serverUrl, setServerUrl] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ success: boolean; tenantName?: string; message?: string } | null>(null);

  const handleCardSelect = (card: CardType) => {
    setSelectedCard(card);
    // Switching away from enterprise clears verification state
    if (card !== 'enterprise') {
      setServerUrl('');
      setVerifyResult(null);
    }
  };

  const handleConsumerNext = async () => {
    try {
      await setAppMode('c');
      // Notify main process to start consumer services, then reload renderer
      // (avoids full app relaunch — same approach as enterprise mode)
      await ipcBridge.application.startConsumerServices.invoke();
      window.location.reload();
    } catch (error) {
      console.error('[ModeSetup] Failed to set consumer mode:', error);
      Message.error('设置失败，请重试');
    }
  };

  const handleVerifyServer = async () => {
    const url = serverUrl.trim();
    if (!url) return;

    // Validate URL format
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        Message.error('服务器地址必须以 http:// 或 https:// 开头');
        return;
      }
      // const hostname = parsed.hostname.toLowerCase();
      // if (hostname === 'localhost' || hostname === '127.0.0.1') {
      //   Message.error('不支持使用 localhost 或 127.0.0.1 作为服务器地址');
      //   return;
      // }
    } catch {
      Message.error('请输入有效的服务器地址（以 http:// 或 https:// 开头）');
      return;
    }

    setVerifying(true);
    setVerifyResult(null);

    try {
      const normalizedUrl = serverUrl.trim().replace(/\/+$/, '');
      const response = await fetch(`${normalizedUrl}/api/v1/tenant/config`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await response.json();

      if (data.success && data.tenantName) {
        // Save mode + serverUrl + tenantName first, then reload
        await setAppMode('e');
        await ConfigStorage.set('eeclaw.serverUrl', normalizedUrl);
        await ConfigStorage.set('eeclaw.tenantName', data.tenantName);

        // Reload page — setAppMode triggers re-render that unmounts this component
        // before any navigation can execute, so use reload instead
        window.location.reload();
      } else {
        setVerifyResult({ success: false, message: '服务器响应异常' });
      }
    } catch (error) {
      console.error('[ModeSetup] Server verification failed:', error);
      setVerifyResult({ success: false, message: '无法连接到服务器，请检查地址是否正确' });
    } finally {
      setVerifying(false);
    }
  };

  const handleEnterpriseNext = () => {
    void handleVerifyServer();
  };

  return (
    <div className='mode-setup'>
      {isDesktopRuntime && <WindowControls />}

      {/* Background decoration */}
      <div className='mode-setup__background'>
        <div className='mode-setup__background-circle mode-setup__background-circle--lg' />
        <div className='mode-setup__background-circle mode-setup__background-circle--sm' />
      </div>

      <div className='mode-setup__container'>
        {/* Logo & Title */}
        <div className='mode-setup__header'>
          <img src={SudoworkIcon} alt='Sudowork' className='mode-setup__logo' />
          <h1 className='text-28px font-700 tracking-tighter bg-gradient-to-br from-primary to-purple-600 bg-clip-text text-transparent mb-8px'>
            欢迎使用 SudoClaw
          </h1>
          <p className='text-14px text-t-secondary'>请选择您的使用模式</p>
        </div>

        {/* Cards */}
        <div className='mode-setup__cards'>
          {/* Consumer Card */}
          <div
            className={`mode-setup__card ${selectedCard === 'consumer' ? 'mode-setup__card--selected' : ''}`}
            onClick={() => handleCardSelect('consumer')}
          >
            <div className='mode-setup__card__icon'>
              <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
                <path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' />
                <circle cx='12' cy='7' r='4' />
              </svg>
            </div>
            <h3 className='text-16px font-600 text-t-primary'>普通用户</h3>
            <div className='mode-setup__card__check'>
              <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='3' strokeLinecap='round' strokeLinejoin='round'>
                <polyline points='20 6 9 17 4 12' />
              </svg>
            </div>
          </div>

          {/* Enterprise Card */}
          <div
            className={`mode-setup__card ${selectedCard === 'enterprise' ? 'mode-setup__card--selected' : ''}`}
            onClick={() => handleCardSelect('enterprise')}
          >
            <div className='mode-setup__card__icon'>
              <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'>
                <path d='M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' />
                <polyline points='9 22 9 12 15 12 15 22' />
              </svg>
            </div>
            <h3 className='text-16px font-600 text-t-primary'>企业用户</h3>
            <div className='mode-setup__card__check'>
              <svg viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='3' strokeLinecap='round' strokeLinejoin='round'>
                <polyline points='20 6 9 17 4 12' />
              </svg>
            </div>
          </div>
        </div>

        {/* Enterprise form (expandable) */}
        <div className={`mode-setup__form ${selectedCard === 'enterprise' ? 'mode-setup__form--visible' : ''}`}>
          <div className='flex flex-col gap-12px w-full'>
            <div className='flex flex-col gap-8px'>
              <div className='text-13px font-600 text-t-primary'>企业服务器地址</div>
              <Input
                size='large'
                placeholder='https://your-company-server.com'
                value={serverUrl}
                onChange={setServerUrl}
                className='mode-setup__input'
              />
              {serverUrl && !isValidServerUrl(serverUrl) ? (
                <p className='text-12px text-danger ml-4px'>请输入有效的 HTTP/HTTPS 地址</p>
              ) : serverUrl.startsWith('http://') ? (
                <p className='text-12px text-warning ml-4px'>建议使用 HTTPS 协议以确保安全</p>
              ) : (
                <p className='text-12px text-t-tertiary ml-4px'>请输入管理员提供的企业服务器地址</p>
              )}
            </div>

            {verifyResult && (
              <div className={`mode-setup__verify-result ${verifyResult.success ? 'mode-setup__verify-result--success' : 'mode-setup__verify-result--error'}`}>
                {verifyResult.success ? (
                  <span>{verifyResult.tenantName} — 连接成功</span>
                ) : (
                  <span>{verifyResult.message}</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Consumer button */}
        <div style={{ display: selectedCard === 'consumer' ? 'block' : 'none', width: '100%', WebkitAppRegion: 'no-drag' }}>
          <Button type='primary' size='large' onClick={handleConsumerNext} className='mode-setup__btn mode-setup__btn--consumer'>
            开始使用
          </Button>
        </div>

        {/* Enterprise button */}
        <div style={{ display: selectedCard === 'enterprise' ? 'block' : 'none', width: '100%', WebkitAppRegion: 'no-drag' }}>
          <Button
            type='primary'
            size='large'
            loading={verifying}
            onClick={handleEnterpriseNext}
            className='mode-setup__btn'
            disabled={!serverUrl.trim() || verifying}
          >
            {verifying ? '验证中...' : '下一步'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ModeSetup;
