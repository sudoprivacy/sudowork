/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Typography } from '@arco-design/web-react';
import { IconLink, IconSettings } from '@arco-design/web-react/icon';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buildVersion, buildDate, buildCommit, isNightlyBuild } from '@common/buildInfo';
import { IS_OFFLINE_BUILD } from '@common/buildMode';
import { useTenantLogo } from '@renderer/hooks/useTenantLogo';
import { useTenantStore } from '@renderer/stores/useTenantStore';
import { openExternalUrl } from '@renderer/utils/platform';
import PageWrapper from '@renderer/components/base/PageWrapper';
import OpsModal from './components/OpsModal';

const About: React.FC = () => {
  const { t } = useTranslation();
  const tenant = useTenantStore();
  const logo = useTenantLogo();
  const [opsVisible, setOpsVisible] = useState<boolean>(false);

  return (
    <PageWrapper title={t('settings.about')}>
      <div className='f-center flex-col w-full min-h-[62vh] py-8 text-center'>
        {/* Logo 磁贴 / Logo tile */}
        <div className='f-center h-19 w-19 border border-border bg-card shadow-sm rd-18px'>
          <img src={logo} alt='' className='w-11.5 h-11.5' />
        </div>

        <Typography.Title heading={4} className='text-20px font-700 text-foreground mb-1.5 mt-0 lh-28px'>
          {tenant.aboutName}
        </Typography.Title>
        <div className='text-13px text-foreground-tertiary'>{tenant.companyName}</div>

        {/* 链接 / Links */}
        <div className='f-center gap-3 mt-4'>
          <button type='button' className='group inline-flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-12px text-foreground-secondary transition-colors hover:text-brand' onClick={() => void openExternalUrl(tenant.websiteUrl).catch(console.error)}>
            <span>{t('settings.officialWebsite', '官网')}</span>
            <IconLink className='text-12px opacity-60 transition-opacity group-hover:opacity-100' />
          </button>
          <span className='text-12px text-foreground-tertiary'>·</span>
          <button type='button' className='group inline-flex cursor-pointer items-center gap-1 border-none bg-transparent p-0 text-12px text-foreground-secondary transition-colors hover:text-brand' onClick={() => void openExternalUrl(tenant.privacyPolicyUrl).catch(console.error)}>
            <span>{t('settings.privacyPolicy', '隐私声明')}</span>
            <IconLink className='text-12px opacity-60 transition-opacity group-hover:opacity-100' />
          </button>
        </div>

        {/* 版本信息 / Version info */}
        <div className='flex items-center gap-1.5 mt-6'>
          <span className='bg-secondary px-2.5 py-[3px] rd-20px text-12px text-secondary-foreground font-mono font-500'>{buildVersion}</span>
          {isNightlyBuild && <span className='bg-brand-surface px-2 py-0.5 rd-10px text-11px text-brand font-500'>{t('update.nightlyBadge', 'Nightly 预览版')}</span>}
        </div>
        {isNightlyBuild && buildDate !== 'unknown' && (
          <div className='mt-1.5 text-11px text-foreground-tertiary font-mono'>
            {t('update.buildDate', '构建日期')}: {buildDate} · {buildCommit}
          </div>
        )}

        {/* 内网版没有更新和运维配置入口，避免用户触发依赖公网的操作。 */}
        {!IS_OFFLINE_BUILD && (
          <div className='flex items-center gap-2 mt-8'>
            <Button size='small' type='outline' onClick={() => window.dispatchEvent(new Event('sudowork-open-update-modal'))}>
              {t('settings.checkForUpdates', '检查更新')}
            </Button>
            <Button type='text' onClick={() => setOpsVisible(true)} icon={<IconSettings style={{ fontSize: 20 }} />} />
          </div>
        )}
      </div>

      {!IS_OFFLINE_BUILD && <OpsModal visible={opsVisible} onClose={() => setOpsVisible(false)} />}
    </PageWrapper>
  );
};

export default About;
