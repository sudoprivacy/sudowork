/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Divider, Typography } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { useSettingsViewMode } from '../settingsViewContext';
import packageJson from '../../../../../package.json';

const AboutModalContent: React.FC = () => {
  const { t } = useTranslation();
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';
  return (
    <div className='flex flex-col h-full w-full'>
      {/* Content Area */}
      <div className={classNames('flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-24px', isPageMode && 'px-0 overflow-visible')}>
        <div className='flex flex-col max-w-500px mx-auto'>
          {/* App Info Section */}
          <div className='flex flex-col items-center pb-24px'>
            <Typography.Title heading={3} className='text-24px font-bold text-t-primary mb-8px'>
              Sudowork
            </Typography.Title>
            <div className='text-14px text-t-secondary mb-8px text-center'>
              开发者：北京数牍科技有限公司
            </div>
            <div className='flex items-center justify-center gap-8px mb-16px'>
              <span className='px-10px py-4px rd-6px text-13px bg-fill-2 text-t-primary font-500'>v{packageJson.version}</span>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
};

export default AboutModalContent;
