import { Shield, CheckOne, Lock, Scan, Delete, Edit, Plus } from '@icon-park/react';
import { Card, Tag, Switch, Button, Modal, Input, Select, Table, Space, Popconfirm, Message, Tooltip } from '@arco-design/web-react';
import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
// TODO: 安全hook功能暂时隐藏，后续恢复时取消注释以下imports
// import { ipcBridge } from '@/common';
// import type { BlacklistConfig, BlacklistRule, BlacklistMatchType } from '@/common/safetyTypes';
// import { DEFAULT_BLACKLIST_CONFIG } from '@/common/safetyTypes';
import SettingsPageWrapper from './components/SettingsPageWrapper';

const Option = Select.Option;
const TextArea = Input.TextArea;

// Generate unique ID for rules - TODO: 安全hook功能暂时隐藏
// const generateRuleId = (): string => `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const SecuritySettings: React.FC = () => {
  const { t } = useTranslation();

  // 安全功能状态
  const envProtection = true;
  const infoProtection = true;
  const skillScan = true;
  // TODO: 安全hook功能暂时隐藏，后续恢复时取消注释以下状态
  // const [hookEnabled, setHookEnabled] = useState(true);
  // const [isHookLoading, setIsHookLoading] = useState(true);
  // const [blacklistConfig, setBlacklistConfig] = useState<BlacklistConfig>(DEFAULT_BLACKLIST_CONFIG);
  // const [showRuleModal, setShowRuleModal] = useState(false);
  // const [editingRule, setEditingRule] = useState<BlacklistRule | null>(null);
  // const [ruleForm, setRuleForm] = useState({
  //   type: 'network' as 'network' | 'file' | 'process',
  //   pattern: '',
  //   matchType: 'wildcard' as BlacklistMatchType,
  //   description: '',
  // });

  // TODO: 安全hook功能暂时隐藏，后续恢复时取消注释以下effects
  // 初始化时获取安全 Hook 实际状态
  // useEffect(() => {
  //   const loadHookStatus = async () => {
  //     try {
  //       const result = await ipcBridge.safety.getEnabled.invoke();
  //       if (result.success && result.data) {
  //         setHookEnabled(result.data.enabled);
  //       }
  //     } catch (err) {
  //       console.error('[SecuritySettings] Failed to load safety hook status:', err);
  //     } finally {
  //       setIsHookLoading(false);
  //     }
  //   };
  //   void loadHookStatus();
  // }, []);

  // Load blacklist config
  // useEffect(() => {
  //   const loadBlacklist = async () => {
  //     try {
  //       const result = await ipcBridge.safety.getBlacklist.invoke();
  //       if (result.success && result.data) {
  //         setBlacklistConfig(result.data);
  //       }
  //     } catch (err) {
  //       console.error('[SecuritySettings] Failed to load blacklist config:', err);
  //     }
  //   };
  //   void loadBlacklist();
  // }, []);

  // TODO: 安全hook功能暂时隐藏，后续恢复时取消注释以下handlers
  // 处理安全 Hook 开关切换
  // const handleToggleHook = async (checked: boolean) => { ... };
  // const handleSaveRule = useCallback(async () => { ... }, [ruleForm, editingRule, blacklistConfig]);
  // const handleDeleteRule = useCallback(async (ruleId: string) => { ... }, [blacklistConfig]);
  // const handleToggleRule = useCallback(async (ruleId: string, enabled: boolean) => { ... }, [blacklistConfig]);
  // const openEditModal = useCallback((rule: BlacklistRule) => { ... }, []);
  // const openAddModal = useCallback(() => { ... }, []);

  return (
    <SettingsPageWrapper>
      <div className='p-24px flex flex-col gap-8px'>
        {/* 页面标题 */}
        <div className='flex flex-col gap-2px'>
          <h2 className='text-24px font-600 text-t-primary my-0px'>安全防护</h2>
          <p className='text-13px text-t-secondary my-0px'>全方位保护您的系统和数据安全</p>
        </div>

        {/* 电脑环境安全防护 */}
        <Card size='small' className='rd-12px hover:shadow-md transition-shadow'>
          <div className='flex items-start gap-4px'>
            <div className='w-42px h-42px rounded-8px bg-[#faad1415] flex items-center justify-center flex-shrink-0 mt-1px'>
              <Shield theme='outline' size='24' fill='#faad14' />
            </div>
            <div className='flex-1 mt--4px'>
              <div className='flex items-center gap-6px mb-2px'>
                <h3 className='text-15px font-600 text-t-primary'>电脑环境安全防护</h3>
                <Tag color='orange' size='small' className='rd-4px'>
                  <CheckOne theme='filled' size='12' className='mr-4px' />
                  主动防御
                </Tag>
              </div>
              <p className='text-13px text-t-secondary my-0px leading-relaxed'>当智能体调用各类工具时，系统会进行全过程的安全管控。识别并拦截可能破坏系统、窃取数据、尝试提权的高风险行为，保障您的电脑环境安全。</p>
              <div className='flex items-center justify-end gap-10px'>
                <Tag color='green' size='small' className='rd-12px px-10px'>
                  <span className='w-5px h-5px rd-50% inline-block mr-5px bg-[#52c41a]'></span>
                  保护中
                </Tag>
                <Switch checked={envProtection} disabled size='small' />
              </div>
            </div>
          </div>
        </Card>

        {/* 用户信息安全保护 */}
        <Card size='small' className='rd-12px hover:shadow-md transition-shadow'>
          <div className='flex items-start gap-10px'>
            <div className='w-42px h-42px rounded-8px bg-[#52c41a15] flex items-center justify-center flex-shrink-0 mt-1px'>
              <Lock theme='outline' size='24' fill='#52c41a' />
            </div>
            <div className='flex-1 mt--4px'>
              <div className='flex items-center gap-6px mb-2px'>
                <h3 className='text-15px font-600 text-t-primary'>用户信息安全保护</h3>
                <Tag color='green' size='small' className='rd-4px'>
                  <CheckOne theme='filled' size='12' className='mr-4px' />
                  智能识别
                </Tag>
              </div>
              <p className='text-13px text-t-secondary my-0px leading-relaxed'>对输入给智能体的任务、提示词进行智能安全识别，自动检测是否包含个人隐私、敏感密钥、账号凭证等高风险信息，保障用户信息安全。</p>
              <div className='flex items-center justify-end gap-10px'>
                <Tag color='green' size='small' className='rd-12px px-10px'>
                  <span className='w-5px h-5px rd-50% inline-block mr-5px bg-[#52c41a]'></span>
                  保护中
                </Tag>
                <Switch checked={infoProtection} disabled size='small' />
              </div>
            </div>
          </div>
        </Card>

        {/* Skill 技能安全扫描 */}
        <Card size='small' className='rd-12px hover:shadow-md transition-shadow'>
          <div className='flex items-start gap-10px'>
            <div className='w-42px h-42px rounded-8px bg-[#1890ff15] flex items-center justify-center flex-shrink-0 mt-1px'>
              <Scan theme='outline' size='24' fill='#1890ff' />
            </div>
            <div className='flex-1 mt--4px'>
              <div className='flex items-center gap-6px mb-2px'>
                <h3 className='text-15px font-600 text-t-primary'>Skill 技能安全扫描</h3>
                <Tag color='blue' size='small' className='rd-4px'>
                  <CheckOne theme='filled' size='12' className='mr-4px' />
                  多层检测
                </Tag>
              </div>
              <p className='text-13px text-t-secondary my-0px leading-relaxed'>所有 Skill 在安装和接入前，系统都会进行多层安全检测，包括来源可信度、代码审查、权限评估等，确保所有接入的技能纯净无害。</p>
              <div className='flex items-center justify-end gap-10px'>
                <Tag color='green' size='small' className='rd-12px px-10px'>
                  <span className='w-5px h-5px rd-50% inline-block mr-5px bg-[#52c41a]'></span>
                  保护中
                </Tag>
                <Switch checked={skillScan} disabled size='small' />
              </div>
            </div>
          </div>
        </Card>

        {/* TODO: 安全hook功能暂时隐藏，后续恢复时取消注释以下Card */}
        {/* 安全 Hook 防护 Card 已隐藏 */}

        {/* 底部提示 */}
        <div className='flex items-center justify-center gap-8px text-14px text-t-tertiary mt-16px'>
          <Shield theme='outline' size='16' fill='currentColor' />
          <span>您的每一次操作都在系统严格保护之下</span>
        </div>
      </div>
    </SettingsPageWrapper>
  );
};

export default SecuritySettings;