/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Typography } from '@arco-design/web-react';
import { IconLink } from '@arco-design/web-react/icon';
import { Setting } from '@icon-park/react';
import React, { useState } from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { useSettingsViewMode } from '../settingsViewContext';
import { useTenantConfig } from '@/renderer/context/TenantConfigContext';
import { buildVersion, buildDate, buildCommit, isNightlyBuild } from '@/common/buildInfo';
import OpsModal from '@/renderer/components/OpsModal';
import sudoIcon from '@/renderer/assets/sudowork-icon-dark.svg';
import { openExternalUrl } from '@/renderer/utils/platform';

const OFFICIAL_WEBSITE_URL = 'https://sudoclaw.sudoprivacy.com';

const AboutModalContent: React.FC = () => {
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';
  const { t } = useTranslation();
  const { config } = useTenantConfig();
  const [opsVisible, setOpsVisible] = useState<boolean>(false);

  return (
    <div className='flex flex-col h-full w-full'>
      <div className={classNames('flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-24px', isPageMode && 'px-0 overflow-visible')}>
        <div className='flex flex-col max-w-540px mx-auto'>
          <div className='flex flex-col items-center py-28px'>
            <div className='w-48px h-48px flex items-center justify-center mb-12px'>
              <img src={config.logo || sudoIcon} alt={config.about_name} className='w-42px h-42px' />
            </div>
            <Typography.Title heading={4} className='text-18px font-700 text-t-primary mb-4px mt-0'>
              {config.about_name}
            </Typography.Title>
            <div className='text-12px text-t-tertiary'>{config.app_company_name}</div>
            <button type='button' className='mt-6px mb-10px inline-flex items-center gap-4px bg-transparent border-none p-0 text-12px text-primary cursor-pointer underline-offset-3 hover:underline' onClick={() => void openExternalUrl(OFFICIAL_WEBSITE_URL).catch(console.error)}>
              <span>{t('settings.officialWebsite')}</span>
              <IconLink className='text-12px' />
            </button>
            <div className='flex items-center gap-6px'>
              <span className='px-10px py-3px rd-20px text-12px bg-fill-2 text-t-secondary font-mono font-500'>{buildVersion}</span>
              {isNightlyBuild && <span className='px-8px py-2px rd-10px text-11px bg-orange-1 text-orange-6 font-500 dark:bg-orange-9/20'>{t('update.nightlyBadge', { defaultValue: 'Nightly Preview' })}</span>}
            </div>
            {isNightlyBuild && buildDate !== 'unknown' && (
              <div className='mt-6px text-11px text-t-tertiary font-mono'>
                {t('update.buildDate', { defaultValue: 'Build date' })}: {buildDate} · {buildCommit}
              </div>
            )}
            <div className='flex items-center gap-4px mt-14px'>
              <Button size='small' type='outline' onClick={() => window.dispatchEvent(new Event('aionui-open-update-modal'))}>
                {t('settings.checkForUpdates')}
              </Button>
              <Button size='small' type='text' className='opacity-50 hover:opacity-100 transition-opacity' onClick={() => setOpsVisible(true)} icon={<Setting theme='outline' size='14' />} />
            </div>
          </div>
        </div>
      </div>

      <OpsModal visible={opsVisible} onClose={() => setOpsVisible(false)} />
    </div>
  );
};

export default AboutModalContent;
