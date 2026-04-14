/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import { Collapse } from '@arco-design/web-react';
import { CheckOne } from '@icon-park/react';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsViewMode } from '../../settingsViewContext';
import jianshekuLogo from '@/renderer/assets/logos/jiansheku.png';
import zentaoLogo from '@/renderer/assets/channel-logos/zentao.svg';
import JsbConfigForm from './JsbConfigForm';
import ZentaoSecretForm from './ZentaoSecretForm';

/**
 * Secret Management Content Component
 */
const SecretModalContent: React.FC = () => {
  const { t } = useTranslation();
  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';

  const [jsbCollapsed, setJsbCollapsed] = useState(true);
  const [zentaoCollapsed, setZentaoCollapsed] = useState(true);

  const guideText = t('settings.secrets.description', '管理各服务的秘钥凭证，秘钥安全存储在本地 Nexus 密钥库中。');
  const setupSteps = [t('settings.secrets.step1', '选择服务并填写秘钥信息。'), t('settings.secrets.step2', '点击保存完成配置。')];

  return (
    <AionScrollArea className={isPageMode ? 'h-full' : ''}>
      <div className='px-[12px] md:px-[28px]'>
        <h2 className='text-20px font-500 text-t-primary m-0'>{t('settings.secrets.title', '秘钥管理')}</h2>
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
          {/* 建设库 */}
          <Collapse activeKey={jsbCollapsed ? [] : ['jsb']} onChange={() => setJsbCollapsed((prev) => !prev)} className='[&_div.arco-collapse-item-header-title]:flex-1'>
            <Collapse.Item
              header={
                <div className='flex items-center gap-8px'>
                  <img src={jianshekuLogo} alt='Jiansheku' className='w-14px h-14px rd-3px shrink-0' />
                  <span className='text-14px text-t-primary'>{t('settings.secrets.jsbTitle', '建设库')}</span>
                </div>
              }
              name='jsb'
              className='[&_div.arco-collapse-item-content-box]:py-3'
            >
              <JsbConfigForm />
            </Collapse.Item>
          </Collapse>

          {/* 禅道 */}
          <Collapse activeKey={zentaoCollapsed ? [] : ['zentao']} onChange={() => setZentaoCollapsed((prev) => !prev)} className='[&_div.arco-collapse-item-header-title]:flex-1'>
            <Collapse.Item
              header={
                <div className='flex items-center gap-8px'>
                  <img src={zentaoLogo} alt='Zentao' className='w-14px h-14px rd-3px shrink-0' />
                  <span className='text-14px text-t-primary'>{t('settings.secrets.zentaoTitle', '禅道')}</span>
                </div>
              }
              name='zentao'
              className='[&_div.arco-collapse-item-content-box]:py-3'
            >
              <ZentaoSecretForm />
            </Collapse.Item>
          </Collapse>
        </div>
      </div>
    </AionScrollArea>
  );
};

export default SecretModalContent;
