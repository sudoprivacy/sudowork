/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Typography } from '@arco-design/web-react';
import { IconLink } from '@arco-design/web-react/icon';
import { Setting } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTenantConfig } from '@/renderer/context/TenantConfigContext';
import { buildVersion, buildDate, buildCommit, isNightlyBuild } from '@/common/buildInfo';
import OpsModal from '@/renderer/components/OpsModal';
import sudoIcon from '@/renderer/assets/sudowork-icon-dark.svg';
import { openExternalUrl } from '@/renderer/utils/platform';
import SettingsPageWrapper from './components/SettingsPageWrapper';

const OFFICIAL_WEBSITE_URL = 'https://sudowork.sudoprivacy.com';
const PRIVACY_POLICY_URL = 'https://sudowork.sudoprivacy.com/privacy.html';

const About: React.FC = () => {
  const { t } = useTranslation();
  const { config } = useTenantConfig();
  const [opsVisible, setOpsVisible] = useState<boolean>(false);

  return (
    <SettingsPageWrapper contentClassName='max-w-480px'>
      <div className='flex flex-col items-center justify-center w-full min-h-[62vh] py-32px text-center'>
        {/* Logo 磁贴 / Logo tile */}
        <div className='flex items-center justify-center w-76px h-76px rd-18px bg-1 border border-border-2 shadow-sm'>
          <img src={config.logo || sudoIcon} alt={config.about_name} className='w-46px h-46px' />
        </div>

        <Typography.Title heading={4} className='text-20px font-700 text-t-primary mb-6px mt-0 lh-28px'>
          {config.about_name}
        </Typography.Title>
        <div className='text-13px text-t-tertiary'>{config.app_company_name}</div>

        {/* 链接 / Links */}
        <div className='flex items-center justify-center gap-12px mt-16px'>
          <button type='button' className='group inline-flex items-center gap-4px bg-transparent border-none p-0 text-12px text-t-secondary cursor-pointer transition-colors hover:text-[var(--ui-accent-orange)]' onClick={() => void openExternalUrl(OFFICIAL_WEBSITE_URL).catch(console.error)}>
            <span>{t('settings.officialWebsite')}</span>
            <IconLink className='text-12px opacity-60 transition-opacity group-hover:opacity-100' />
          </button>
          <span className='text-12px text-t-quaternary'>·</span>
          <button type='button' className='group inline-flex items-center gap-4px bg-transparent border-none p-0 text-12px text-t-secondary cursor-pointer transition-colors hover:text-[var(--ui-accent-orange)]' onClick={() => void openExternalUrl(PRIVACY_POLICY_URL).catch(console.error)}>
            <span>{t('settings.privacyPolicy')}</span>
            <IconLink className='text-12px opacity-60 transition-opacity group-hover:opacity-100' />
          </button>
        </div>

        {/* 版本信息 / Version info */}
        <div className='flex items-center gap-6px mt-24px'>
          <span className='px-10px py-3px rd-20px text-12px bg-fill-2 text-t-secondary font-mono font-500'>{buildVersion}</span>
          {isNightlyBuild && <span className='px-8px py-2px rd-10px text-11px bg-orange-1 text-orange-6 font-500 dark:bg-orange-9/20'>{t('update.nightlyBadge', { defaultValue: 'Nightly Preview' })}</span>}
        </div>
        {isNightlyBuild && buildDate !== 'unknown' && (
          <div className='mt-6px text-11px text-t-tertiary font-mono'>
            {t('update.buildDate', { defaultValue: 'Build date' })}: {buildDate} · {buildCommit}
          </div>
        )}

        {/* 操作按钮 / Actions */}
        <div className='flex items-center gap-8px mt-32px'>
          <Button size='small' type='outline' onClick={() => window.dispatchEvent(new Event('aionui-open-update-modal'))}>
            {t('settings.checkForUpdates')}
          </Button>
          <Button size='small' type='text' className='opacity-50 hover:opacity-100 transition-opacity' onClick={() => setOpsVisible(true)} icon={<Setting theme='outline' size='14' />} />
        </div>
      </div>

      <OpsModal visible={opsVisible} onClose={() => setOpsVisible(false)} />
    </SettingsPageWrapper>
  );
};

export default About;
