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
import { useTenantConfig } from '@renderer/context/TenantConfigContext';
import { buildVersion, buildDate, buildCommit, isNightlyBuild } from '@common/buildInfo';
import sudoIcon from '@renderer/assets/sudowork-icon-dark.svg';
import { openExternalUrl } from '@renderer/utils/platform';
import PageWrapper from '@renderer/components/base/PageWrapper';
import OpsModal from './components/OpsModal';

const OFFICIAL_WEBSITE_URL = 'https://sudowork.sudoprivacy.com';
const PRIVACY_POLICY_URL = 'https://sudowork.sudoprivacy.com/privacy.html';

const About: React.FC = () => {
  const { t } = useTranslation();
  const { config } = useTenantConfig();
  const [opsVisible, setOpsVisible] = useState<boolean>(false);

  return (
    <PageWrapper contentClassName='max-w-120'>
      <div className='f-center flex-col w-full min-h-[62vh] py-8 text-center'>
        {/* Logo 磁贴 / Logo tile */}
        <div className='f-center w-19 h-19 rd-18px border shadow-sm'>
          <img src={config.logo || sudoIcon} alt={config.about_name} className='w-11.5 h-11.5' />
        </div>

        <Typography.Title heading={4} className='text-20px font-700 text-foreground mb-1.5 mt-0 lh-28px'>
          {config.about_name}
        </Typography.Title>
        <div className='text-13px text-tertiary'>{config.app_company_name}</div>

        {/* 链接 / Links */}
        <div className='f-center gap-3 mt-4'>
          <button type='button' className='group inline-flex items-center gap-1 bg-transparent border-none p-0 text-12px text-secondary cursor-pointer transition-colors hover:text-[var(--ui-accent-orange)]' onClick={() => void openExternalUrl(OFFICIAL_WEBSITE_URL).catch(console.error)}>
            <span>{t('settings.officialWebsite', '官网')}</span>
            <IconLink className='text-12px opacity-60 transition-opacity group-hover:opacity-100' />
          </button>
          <span className='text-12px text-tertiary'>·</span>
          <button type='button' className='group inline-flex items-center gap-1 bg-transparent border-none p-0 text-12px text-secondary cursor-pointer transition-colors hover:text-[var(--ui-accent-orange)]' onClick={() => void openExternalUrl(PRIVACY_POLICY_URL).catch(console.error)}>
            <span>{t('settings.privacyPolicy', '隐私声明')}</span>
            <IconLink className='text-12px opacity-60 transition-opacity group-hover:opacity-100' />
          </button>
        </div>

        {/* 版本信息 / Version info */}
        <div className='flex items-center gap-1.5 mt-6'>
          <span className='px-2.5 py-[3px] rd-20px text-12px bg-fill-2 text-secondary font-mono font-500'>{buildVersion}</span>
          {isNightlyBuild && <span className='px-2 py-0.5 rd-10px text-11px bg-orange-1 text-orange-6 font-500 dark:bg-orange-9/20'>{t('update.nightlyBadge', 'Nightly 预览版')}</span>}
        </div>
        {isNightlyBuild && buildDate !== 'unknown' && (
          <div className='mt-1.5 text-11px text-tertiary font-mono'>
            {t('update.buildDate', '构建日期')}: {buildDate} · {buildCommit}
          </div>
        )}

        {/* 操作按钮 / Actions */}
        <div className='flex items-center gap-2 mt-8'>
          <Button size='small' type='outline' onClick={() => window.dispatchEvent(new Event('sudowork-open-update-modal'))}>
            {t('settings.checkForUpdates', '检查更新')}
          </Button>
          <Button size='small' type='text' className='opacity-50 hover:opacity-100 transition-opacity' onClick={() => setOpsVisible(true)} icon={<Setting theme='outline' size='14' />} />
        </div>
      </div>

      <OpsModal visible={opsVisible} onClose={() => setOpsVisible(false)} />
    </PageWrapper>
  );
};

export default About;
