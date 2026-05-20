/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { CheckOne } from '@icon-park/react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsViewMode } from '../../settingsViewContext';
import itemRefreshIcon from '@/renderer/assets/item-refresh.svg';
import TenantConfigSection from './TenantConfigSection';
import { EnterpriseSecretSection } from './EnterpriseSecretSection';
import { ZentaoChannelItem } from '../ZentaoConfigForm';
import { useAppMode } from '@/renderer/hooks/useAppMode';

/**
 * Secret Management Content Component
 */
const SecretModalContent: React.FC = () => {
  const { t } = useTranslation();
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';
  const { isEnterprise } = useAppMode();

  const [refreshCounter, setRefreshCounter] = useState(0);

  const guideText = isEnterprise
    ? t('settings.secrets.description.enterprise', '管理您的凭据，凭据安全存储在服务端。')
    : t('settings.secrets.description', '管理各服务的秘钥凭证，秘钥安全存储在本地 Nexus 密钥库中。');
  const setupSteps = [t('settings.secrets.step1', '选择服务并填写秘钥信息。'), t('settings.secrets.step2', '点击保存完成配置。')];

  const handleRefresh = useCallback(() => {
    setRefreshCounter((prev) => prev + 1);
  }, []);

  return (
    <AionScrollArea className={isPageMode ? 'h-full' : ''}>
      <div className='px-[12px] md:px-[28px]'>
        <div className='flex items-center justify-between'>
          <h2 className='text-20px font-500 text-t-primary m-0'>{t('settings.secrets.title', '秘钥管理')}</h2>
          <button onClick={handleRefresh} className='cursor-pointer p-4px rd-6px border-none bg-transparent hover:bg-fill-2 transition-colors mr-12px' title={t('settings.secrets.refresh', '刷新配置项')}>
            <img src={itemRefreshIcon} alt='refresh' className='w-16px h-16px' />
          </button>
        </div>
        <div className='space-y-8px mt-10px'>
          <div className='text-13px text-t-secondary leading-relaxed'>{guideText}</div>
          <div className='flex flex-wrap gap-x-12px gap-y-6px'>
            {setupSteps.map((stepLabel, idx) => (
              <div key={stepLabel} className='inline-flex items-center gap-6px'>
                <span className='inline-flex items-center justify-center w-16px h-16px rd-50% text-10px font-600 bg-[rgba(var(--primary-6),0.12)] text-[rgb(var(--primary-6))]'>{idx + 1}</span>
                <CheckOne theme='outline' size='12' className='text-[rgb(var(--primary-6))]' />
                <span className='text-12px text-t-secondary'>{stepLabel}</span>
              </div>
            ))}
          </div>
        </div>

        <div className='space-y-12px mt-12px'>
          {/* 企业凭据只读区域 */}
          {isEnterprise && <EnterpriseSecretSection />}

          {/* 禅道（仅C端） */}
          {!isEnterprise && <ZentaoChannelItem />}

          {/* 租户配置项 */}
          <TenantConfigSection refreshTrigger={refreshCounter} />
        </div>
      </div>
    </AionScrollArea>
  );
};

export default SecretModalContent;
