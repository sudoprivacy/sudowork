/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import classNames from 'classnames';
import { CheckOne } from '@icon-park/react';
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import itemRefreshIcon from '@/renderer/assets/item-refresh.svg';
import TenantConfigSection from './TenantConfigSection';
import { EnterpriseSecretSection } from './EnterpriseSecretSection';
import PwdLoginSection from './PwdLoginSection';
import { ZentaoChannelItem } from '../ZentaoConfigForm';
import { useAppMode } from '@/renderer/hooks/useAppMode';

/**
 * Secret Management Content Component
 */
const SecretModalContent: React.FC = () => {
  const { t } = useTranslation();
  const { isEnterprise } = useAppMode();

  const [refreshCounter, setRefreshCounter] = useState(0);

  const guideText = isEnterprise ? t('settings.secrets.description.enterprise', '管理您的凭据，凭据安全存储在服务端。') : t('settings.secrets.description', '管理各服务的秘钥凭证，秘钥安全存储在本地 Nexus 密钥库中。');
  const setupSteps = [t('settings.secrets.step1', '选择服务并填写秘钥信息。'), t('settings.secrets.step2', '点击保存完成配置。')];

  const handleRefresh = useCallback(() => {
    setRefreshCounter((prev) => prev + 1);
  }, []);

  return (
    <AionScrollArea className='h-full'>
      <div className='px-12px sm:px-16px md:px-0 pb-18px'>
        <div className='max-w-820px mx-auto w-full'>
          <div className='flex items-center justify-between mb-12px'>
            <h2 className='text-20px font-600 text-foreground m-0'>{t('settings.secrets.title', '秘钥管理')}</h2>
            <button onClick={handleRefresh} className='cursor-pointer p-4px rd-6px border-none bg-transparent hover:bg-fill-2 transition-colors' title={t('settings.secrets.refresh', '刷新配置项')}>
              <img src={itemRefreshIcon} alt='refresh' className='w-16px h-16px' />
            </button>
          </div>
          <div className='space-y-8px'>
            <div className='text-13px text-secondary leading-relaxed'>{guideText}</div>
            <div className='flex flex-wrap gap-x-12px gap-y-6px'>
              {setupSteps.map((stepLabel, idx) => (
                <div key={stepLabel} className='inline-flex items-center gap-6px'>
                  <span className='inline-flex items-center justify-center w-16px h-16px rd-50% text-10px font-600 bg-[rgba(var(--ui-accent-orange-rgb),0.12)] text-[var(--ui-accent-orange)]'>{idx + 1}</span>
                  <CheckOne theme='outline' size='12' className='text-[var(--ui-accent-orange)]' />
                  <span className='text-12px text-secondary'>{stepLabel}</span>
                </div>
              ))}
            </div>
          </div>
          <div className={classNames('space-y-12px', 'mt-16px')}>
            {/* 企业凭据只读区域 */}
            {isEnterprise && <EnterpriseSecretSection />}

            {/* 禅道（仅C端） */}
            {!isEnterprise && <ZentaoChannelItem />}

            {/* 网站自动登录 (pwd_login) */}
            <PwdLoginSection />

            {/* 租户配置项 */}
            <TenantConfigSection refreshTrigger={refreshCounter} />
          </div>
        </div>
      </div>
    </AionScrollArea>
  );
};

export default SecretModalContent;
