/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Modal, Input, Select } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { IBlacklistRule, IBlacklistMatchType } from '@common/types/security';

const Option = Select.Option;
const TextArea = Input.TextArea;

export default function RuleModal({ isVisible, editingRule, ruleForm, onFormChange, onOk, onCancel }: IRuleModalProps) {
  const { t } = useTranslation();

  return (
    <Modal title={editingRule ? t('settings.securitySettings.rule.editTitle', '编辑规则') : t('settings.securitySettings.rule.addTitle', '添加规则')} visible={isVisible} onOk={onOk} onCancel={onCancel} autoFocus={false} focusLock={true}>
      <div className='flex flex-col gap-4'>
        <div>
          <label className='block text-14px text-secondary mb-1'>{t('settings.securitySettings.rule.typeLabel', '类型')}</label>
          <Select value={ruleForm.type} onChange={(val) => onFormChange({ ...ruleForm, type: val })} style={{ width: '100%' }}>
            <Option value='network'>{t('settings.securitySettings.rule.typeNetworkOption', '网络请求 (域名/IP)')}</Option>
            <Option value='file'>{t('settings.securitySettings.rule.typeFileOption', '文件操作 (路径)')}</Option>
            <Option value='process'>{t('settings.securitySettings.rule.typeProcessOption', '进程执行 (命令)')}</Option>
          </Select>
        </div>

        <div>
          <label className='block text-14px text-secondary mb-1'>{t('settings.securitySettings.rule.matchTypeLabel', '匹配方式')}</label>
          <Select value={ruleForm.matchType} onChange={(val) => onFormChange({ ...ruleForm, matchType: val })} style={{ width: '100%' }}>
            <Option value='exact'>{t('settings.securitySettings.rule.matchExactOption', '精确匹配')}</Option>
            <Option value='wildcard'>{t('settings.securitySettings.rule.matchWildcardOption', '通配符匹配')}</Option>
          </Select>
        </div>

        <div>
          <label className='block text-14px text-secondary mb-1'>
            {ruleForm.type === 'network' ? t('settings.securitySettings.rule.patternLabelNetwork', '域名/IP 模式') : ruleForm.type === 'file' ? t('settings.securitySettings.rule.patternLabelFile', '路径模式') : t('settings.securitySettings.rule.patternLabelProcess', '命令模式')}
          </label>
          <Input
            placeholder={
              ruleForm.type === 'network'
                ? t('settings.securitySettings.rule.placeholderNetwork', '例如: *.example.com 或 192.168.1.*')
                : ruleForm.type === 'file'
                  ? t('settings.securitySettings.rule.placeholderFile', '例如: /etc/* 或 ~/.ssh/*')
                  : t('settings.securitySettings.rule.placeholderProcess', '例如: rm* 或 npm*')
            }
            value={ruleForm.pattern}
            onChange={(val) => onFormChange({ ...ruleForm, pattern: val })}
          />
        </div>

        <div>
          <label className='block text-14px text-secondary mb-1'>{t('settings.securitySettings.rule.descLabel', '描述 (可选)')}</label>
          <TextArea placeholder={t('settings.securitySettings.rule.descPlaceholder', '规则说明')} value={ruleForm.description} onChange={(val) => onFormChange({ ...ruleForm, description: val })} autoSize={{ minRows: 2, maxRows: 4 }} />
        </div>
      </div>
    </Modal>
  );
}

interface RuleForm {
  type: 'network' | 'file' | 'process';
  pattern: string;
  matchType: IBlacklistMatchType;
  description: string;
}

interface IRuleModalProps {
  isVisible: boolean;
  editingRule: IBlacklistRule | null;
  ruleForm: RuleForm;
  onFormChange: (form: RuleForm) => void;
  onOk: () => void;
  onCancel: () => void;
}
