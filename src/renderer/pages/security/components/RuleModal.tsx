import React from 'react';
import { Modal, Input, Select } from '@arco-design/web-react';
import type { IBlacklistRule, BlacklistMatchType } from '@/types/security';

const Option = Select.Option;
const TextArea = Input.TextArea;

type RuleForm = {
  type: 'network' | 'file' | 'process';
  pattern: string;
  matchType: BlacklistMatchType;
  description: string;
};

type Props = {
  isVisible: boolean;
  editingRule: IBlacklistRule | null;
  ruleForm: RuleForm;
  onFormChange: (form: RuleForm) => void;
  onOk: () => void;
  onCancel: () => void;
};

export default function RuleModal({ isVisible, editingRule, ruleForm, onFormChange, onOk, onCancel }: Props) {
  return (
    <Modal title={editingRule ? '编辑规则' : '添加规则'} visible={isVisible} onOk={onOk} onCancel={onCancel} autoFocus={false} focusLock={true}>
      <div className='flex flex-col gap-4'>
        <div>
          <label className='block text-14px text-secondary mb-1'>类型</label>
          <Select value={ruleForm.type} onChange={(val) => onFormChange({ ...ruleForm, type: val })} style={{ width: '100%' }}>
            <Option value='network'>网络请求 (域名/IP)</Option>
            <Option value='file'>文件操作 (路径)</Option>
            <Option value='process'>进程执行 (命令)</Option>
          </Select>
        </div>

        <div>
          <label className='block text-14px text-secondary mb-1'>匹配方式</label>
          <Select value={ruleForm.matchType} onChange={(val) => onFormChange({ ...ruleForm, matchType: val })} style={{ width: '100%' }}>
            <Option value='exact'>精确匹配</Option>
            <Option value='wildcard'>通配符匹配</Option>
          </Select>
        </div>

        <div>
          <label className='block text-14px text-secondary mb-1'>{ruleForm.type === 'network' ? '域名/IP 模式' : ruleForm.type === 'file' ? '路径模式' : '命令模式'}</label>
          <Input placeholder={ruleForm.type === 'network' ? '例如: *.example.com 或 192.168.1.*' : ruleForm.type === 'file' ? '例如: /etc/* 或 ~/.ssh/*' : '例如: rm* 或 npm*'} value={ruleForm.pattern} onChange={(val) => onFormChange({ ...ruleForm, pattern: val })} />
        </div>

        <div>
          <label className='block text-14px text-secondary mb-1'>描述 (可选)</label>
          <TextArea placeholder='规则说明' value={ruleForm.description} onChange={(val) => onFormChange({ ...ruleForm, description: val })} autoSize={{ minRows: 2, maxRows: 4 }} />
        </div>
      </div>
    </Modal>
  );
}
