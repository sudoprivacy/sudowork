/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Select } from '@arco-design/web-react';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { changeLanguage } from '@renderer/i18n';

const LanguageSwitcher: React.FC = () => {
  const { i18n } = useTranslation();

  const handleLanguageChange = useCallback((value: string) => {
    changeLanguage(value).catch((error: Error) => {
      console.error('Failed to change language:', error);
    });
  }, []);

  return (
    <div className='flex items-center gap-8px'>
      <Select className='w-160px' value={i18n.language} onChange={handleLanguageChange}>
        <Select.Option value='zh-CN'>简体中文</Select.Option>
        <Select.Option value='zh-TW'>繁體中文</Select.Option>
        <Select.Option value='ja-JP'>日本語</Select.Option>
        <Select.Option value='ko-KR'>한국어</Select.Option>
        <Select.Option value='tr-TR'>Türkçe</Select.Option>
        <Select.Option value='en-US'>English</Select.Option>
      </Select>
    </div>
  );
};

export default LanguageSwitcher;
