/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Typography } from '@arco-design/web-react';
import { Setting } from '@icon-park/react';
import React, { useState } from 'react';
import classNames from 'classnames';
import { useTranslation } from 'react-i18next';
import { useSettingsViewMode } from '../settingsViewContext';
import { buildVersion, buildDate, buildCommit, isNightlyBuild } from '@/common/buildInfo';
import OpsModal from '@/renderer/components/OpsModal';

const AboutModalContent: React.FC = () => {
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';
  const { t } = useTranslation();
  const [opsVisible, setOpsVisible] = useState<boolean>(false);

  return (
    <div className='flex flex-col h-full w-full'>
      <div className={classNames('flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-24px', isPageMode && 'px-0 overflow-visible')}>
        <div className='flex flex-col max-w-540px mx-auto'>
          <div className='flex flex-col items-center py-28px'>
            <div className='w-56px h-56px rd-16px bg-gradient-to-br from-orange-4 to-orange-6 flex items-center justify-center mb-12px shadow-md'>
              <span className='text-white text-20px font-800'>S</span>
            </div>
            <Typography.Title heading={4} className='text-18px font-700 text-t-primary mb-4px mt-0'>
              Sudowork
            </Typography.Title>
            <div className='text-12px text-t-tertiary mb-10px'>北京数牍科技有限公司</div>
            <span className='px-10px py-3px rd-20px text-12px bg-fill-2 text-t-secondary font-mono font-500'>{buildVersion}</span>
            {isNightlyBuild && <span className='mt-6px px-8px py-2px rd-10px text-11px bg-orange-1 text-orange-6 font-500 dark:bg-orange-9/20'>{t('update.nightlyBadge', { defaultValue: 'Nightly Preview' })}</span>}
            {isNightlyBuild && buildDate !== 'unknown' && (
              <div className='mt-6px text-11px text-t-quaternary font-mono'>
                {t('update.buildDate', { defaultValue: 'Build date' })}: {buildDate} · {buildCommit}
              </div>
            )}
            <Button size='small' type='outline' className='mt-12px' onClick={() => window.dispatchEvent(new Event('aionui-open-update-modal'))}>
              {t('settings.checkForUpdates')}
            </Button>
            <Button size='small' type='text' className='mt-12px ml-8px opacity-50 hover:opacity-100 transition-opacity' onClick={() => setOpsVisible(true)} icon={<Setting theme='outline' size='14' />} />
          </div>
        </div>
      </div>

      <OpsModal visible={opsVisible} onClose={() => setOpsVisible(false)} />
    </div>
  );
};

export default AboutModalContent;
