import { Shield, CheckOne, Lock, Scan, AllApplication, Delete, Edit, Plus } from '@icon-park/react';
import { Card, Tag, Switch, Button, Modal, Table, Space, Popconfirm, Message, Tooltip } from '@arco-design/web-react';
import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { nanoid } from 'nanoid';
import { ipcBridge } from '@/common';
import type { IBlacklistConfig, IBlacklistRule, IBlacklistMatchType } from '@common/types/security';
import { DEFAULT_BLACKLIST_CONFIG } from '@/common/constants';
import PageWrapper from '@renderer/components/base/PageWrapper';
import SecurityItem from './components/SecurityItem';
import RuleModal from './components/RuleModal';

const SAFETY_HOOK_SETTINGS_VISIBLE = false;

export default function SecurityPage() {
  const { t } = useTranslation();

  // 安全功能状态
  const envProtection = true;
  const infoProtection = true;
  const skillScan = true;
  const [hookEnabled, setHookEnabled] = useState(true);

  // Blacklist state
  const [blacklistConfig, setBlacklistConfig] = useState<IBlacklistConfig>(DEFAULT_BLACKLIST_CONFIG);
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [editingRule, setEditingRule] = useState<IBlacklistRule | null>(null);
  const [ruleForm, setRuleForm] = useState({
    type: 'network' as 'network' | 'file' | 'process',
    pattern: '',
    matchType: 'wildcard' as IBlacklistMatchType,
    description: '',
  });

  // 初始化时获取安全 Hook 实际状态
  useEffect(() => {
    if (!SAFETY_HOOK_SETTINGS_VISIBLE) {
      return;
    }

    const loadHookStatus = async () => {
      try {
        const result = await ipcBridge.safety.getEnabled.invoke();
        if (result.success && result.data) {
          setHookEnabled(result.data.enabled);
        }
      } catch (err) {
        console.error('[SecurityPage] Failed to load safety hook status:', err);
      }
    };
    void loadHookStatus();
  }, []);

  // Load blacklist config
  useEffect(() => {
    if (!SAFETY_HOOK_SETTINGS_VISIBLE) {
      return;
    }

    const loadBlacklist = async () => {
      try {
        const result = await ipcBridge.safety.getBlacklist.invoke();
        if (result.success && result.data) {
          setBlacklistConfig(result.data);
        }
      } catch (err) {
        console.error('[SecurityPage] Failed to load blacklist config:', err);
      }
    };
    void loadBlacklist();
  }, []);

  // 处理安全 Hook 开关切换
  const handleToggleHook = async (checked: boolean) => {
    setHookEnabled(checked);
    try {
      const result = await ipcBridge.safety.setEnabled.invoke({ enabled: checked });
      if (!result.success) {
        console.error('[SecurityPage] Failed to set safety hook enabled:', result.msg);
        //  revert state if failed
        setHookEnabled(!checked);
      }
    } catch (err) {
      console.error('[SecurityPage] Failed to toggle safety hook:', err);
      // Revert state if failed
      setHookEnabled(!checked);
    }
  };

  // Handle add/edit rule
  const handleSaveRule = useCallback(async () => {
    if (!ruleForm.pattern.trim()) {
      Message.error('请输入匹配模式');
      return;
    }

    // Block overly permissive patterns that would match everything
    const dangerousPatterns = ['*.*', '*', '/*', '/*.*'];
    if (dangerousPatterns.includes(ruleForm.pattern.trim())) {
      Modal.error({
        title: '规则不允许',
        content: '禁止使用过于宽泛的匹配规则（如 *.* 或 *），这会拦截所有请求。请使用更精确的匹配模式。',
      });
      return;
    }

    const newRule: IBlacklistRule = {
      id: editingRule?.id || nanoid(),
      enabled: true,
      type: ruleForm.type,
      pattern: ruleForm.pattern.trim(),
      matchType: ruleForm.matchType,
      riskLevel: 'medium',
      description: ruleForm.description.trim(),
      createdAt: editingRule?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };

    const newRules = editingRule ? blacklistConfig.rules.map((r) => (r.id === editingRule.id ? newRule : r)) : [...blacklistConfig.rules, newRule];

    const newConfig = { rules: newRules };

    try {
      const result = await ipcBridge.safety.setBlacklist.invoke({ config: newConfig });
      if (result.success) {
        setBlacklistConfig(newConfig);
        setShowRuleModal(false);
        setEditingRule(null);
        setRuleForm({
          type: 'network',
          pattern: '',
          matchType: 'wildcard',
          description: '',
        });
        Message.success(editingRule ? '规则已更新' : '规则已添加');
      } else {
        Message.error(result.msg || '保存规则失败');
      }
    } catch (err) {
      console.error('[SecurityPage] Failed to save rule:', err);
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('fetch') || errMsg.includes('ECONNREFUSED') || errMsg.includes('network')) {
        Message.error(`Nexus连接异常: ${errMsg}`);
      } else {
        Message.error(`保存规则失败: ${errMsg}`);
      }
    }
  }, [ruleForm, editingRule, blacklistConfig]);

  // Handle delete rule
  const handleDeleteRule = useCallback(
    async (ruleId: string) => {
      const newRules = blacklistConfig.rules.filter((r) => r.id !== ruleId);
      const newConfig = { rules: newRules };

      try {
        const result = await ipcBridge.safety.setBlacklist.invoke({ config: newConfig });
        if (result.success) {
          setBlacklistConfig(newConfig);
          Message.success('规则已删除');
        } else {
          Message.error(result.msg || '删除规则失败');
        }
      } catch (err) {
        console.error('[SecurityPage] Failed to delete rule:', err);
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes('fetch') || errMsg.includes('ECONNREFUSED') || errMsg.includes('network')) {
          Message.error(`Nexus连接异常: ${errMsg}`);
        } else {
          Message.error(`删除规则失败: ${errMsg}`);
        }
      }
    },
    [blacklistConfig]
  );

  // Handle toggle rule enabled
  const handleToggleRule = useCallback(
    async (ruleId: string, enabled: boolean) => {
      const newRules = blacklistConfig.rules.map((r) => (r.id === ruleId ? { ...r, enabled, updatedAt: Date.now() } : r));
      const newConfig = { rules: newRules };

      try {
        const result = await ipcBridge.safety.setBlacklist.invoke({ config: newConfig });
        if (result.success) {
          setBlacklistConfig(newConfig);
        } else {
          Message.error(result.msg || '切换规则失败');
        }
      } catch (err) {
        console.error('[SecurityPage] Failed to toggle rule:', err);
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg.includes('fetch') || errMsg.includes('ECONNREFUSED') || errMsg.includes('network')) {
          Message.error(`Nexus连接异常: ${errMsg}`);
        } else {
          Message.error(`切换规则失败: ${errMsg}`);
        }
      }
    },
    [blacklistConfig]
  );

  // Open edit modal
  const openEditModal = useCallback((rule: IBlacklistRule) => {
    setEditingRule(rule);
    setRuleForm({
      type: rule.type,
      pattern: rule.pattern,
      matchType: rule.matchType,
      description: rule.description || '',
    });
    setShowRuleModal(true);
  }, []);

  // Open add modal
  const openAddModal = useCallback(() => {
    setEditingRule(null);
    setRuleForm({
      type: 'network',
      pattern: '',
      matchType: 'wildcard',
      description: '',
    });
    setShowRuleModal(true);
  }, []);

  return (
    <PageWrapper title={t('settings.security')} subtitle={t('settings.securitySettings.subtitle')}>
      <div className='flex flex-col gap-3'>
        <SecurityItem
          icon={<Shield theme='outline' size='22' />}
          title={t('settings.securitySettings.envProtection.title')}
          tag={
            <Tag className='rd-full' bordered>
              {t('settings.securitySettings.envProtection.tag')}
            </Tag>
          }
          description={t('settings.securitySettings.envProtection.description')}
          status={
            <span className='inline-flex items-center gap-1.5 text-13px font-500 text-success'>
              <span className='h-1.25 w-1.25 rd-50% bg-success' />
              {t('settings.securitySettings.protecting')}
            </span>
          }
          action={<Switch checked={envProtection} disabled size='small' className='settings-accent-switch' />}
        />
        <SecurityItem
          icon={<Lock theme='outline' size='22' />}
          title={t('settings.securitySettings.infoProtection.title')}
          tag={
            <Tag className='rd-full' bordered>
              {t('settings.securitySettings.infoProtection.tag')}
            </Tag>
          }
          description={t('settings.securitySettings.infoProtection.description')}
          status={
            <span className='inline-flex items-center gap-1.5 text-13px font-500 text-success'>
              <span className='h-1.25 w-1.25 rd-50% bg-success' />
              {t('settings.securitySettings.protecting')}
            </span>
          }
          action={<Switch checked={infoProtection} disabled size='small' className='settings-accent-switch' />}
        />
        <SecurityItem
          icon={<Scan theme='outline' size='22' />}
          title={t('settings.securitySettings.skillScan.title')}
          tag={
            <Tag className='rd-full' bordered>
              {t('settings.securitySettings.skillScan.tag')}
            </Tag>
          }
          description={t('settings.securitySettings.skillScan.description')}
          status={
            <span className='inline-flex items-center gap-1.5 text-13px font-500 text-success'>
              <span className='h-1.25 w-1.25 rd-50% bg-success' />
              {t('settings.securitySettings.protecting')}
            </span>
          }
          action={<Switch checked={skillScan} disabled size='small' className='settings-accent-switch' />}
        />

        {SAFETY_HOOK_SETTINGS_VISIBLE && (
          <>
            {/* 安全 Hook 防护 */}
            <Card size='small' className='rd-12px hover:shadow-md transition-shadow'>
              <div className='flex items-start gap-2.5'>
                <div className='w-10.5 h-10.5 rounded-8px bg-[#722ed115] f-center flex-shrink-0 mt-px'>
                  <AllApplication theme='outline' size='24' fill='#722ed1' />
                </div>
                <div className='flex-1 mt--1'>
                  <div className='flex items-center gap-1.5 mb-0.5'>
                    <h3 className='text-15px font-600 text-foreground'>安全 Hook 防护</h3>
                    <Tag color='purple' size='small' className='rd-4px'>
                      <CheckOne theme='filled' size='12' className='mr-1' />
                      实时拦截
                    </Tag>
                  </div>
                  <p className='text-13px text-secondary my-0 leading-relaxed'>监控第三方 AI 工具的文件访问和网络请求，仅对黑名单中的规则进行拦截，匹配时弹出确认框，经您授权后才允许执行。</p>

                  {/* 主开关 */}
                  <div className='flex items-center justify-end gap-2.5'>
                    <Tag color={hookEnabled ? 'green' : 'gray'} size='small' className='rd-12px px-2.5'>
                      <span className='w-1.25 h-1.25 rd-50% inline-block mr-1.25' style={{ backgroundColor: hookEnabled ? '#52c41a' : '#999' }}></span>
                      {hookEnabled ? '保护中' : '已关闭'}
                    </Tag>
                    <Switch checked={hookEnabled} onChange={handleToggleHook} size='small' className='settings-accent-switch' />
                  </div>

                  {/* 黑名单规则 - 关闭时显示提示，开启时显示规则列表 */}
                  <div className='border-t pt-2'>
                    {!hookEnabled ? (
                      <div className='text-center py-2 text-tertiary text-13px'>安全 Hook 防护已关闭</div>
                    ) : (
                      <>
                        {/* 规则说明 */}
                        <div className='mb-1.5'>
                          <span className='text-13px text-secondary'>
                            当前黑名单规则：{blacklistConfig.rules.filter((r) => r.enabled).length} 条生效
                            {blacklistConfig.rules.length === 0 && '（为空时不拦截任何请求）'}
                          </span>
                        </div>

                        {/* Rules section */}
                        <div className='flex items-center justify-between mb-1.5'>
                          <h4 className='text-15px font-500 text-foreground my-1'>拦截规则</h4>
                          <Button type='primary' size='small' icon={<Plus theme='outline' size='14' />} onClick={openAddModal}>
                            添加规则
                          </Button>
                        </div>

                        {blacklistConfig.rules.length === 0 ? (
                          <div className='text-center py-2.5 text-tertiary bg-fill-1 rd-8px'>暂无拦截规则</div>
                        ) : (
                          <Table
                            data={blacklistConfig.rules}
                            rowKey='id'
                            size='small'
                            pagination={false}
                            columns={[
                              {
                                title: '类型',
                                dataIndex: 'type',
                                width: 80,
                                render: (type) => {
                                  const typeConfig: Record<string, { color: string; label: string }> = {
                                    network: { color: 'blue', label: '网络' },
                                    file: { color: 'green', label: '文件' },
                                    process: { color: 'orange', label: '进程' },
                                  };
                                  const config = typeConfig[type] || { color: 'gray', label: type };
                                  return (
                                    <Tag color={config.color} size='small'>
                                      {config.label}
                                    </Tag>
                                  );
                                },
                              },
                              {
                                title: '匹配',
                                dataIndex: 'matchType',
                                width: 70,
                                render: (matchType: IBlacklistMatchType) => {
                                  const labels: Record<IBlacklistMatchType, string> = {
                                    exact: '精确',
                                    wildcard: '通配',
                                  };
                                  return labels[matchType];
                                },
                              },
                              {
                                title: '规则',
                                dataIndex: 'pattern',
                                ellipsis: true,
                                render: (pattern) => (
                                  <Tooltip content={pattern}>
                                    <span className='font-mono text-12px'>{pattern}</span>
                                  </Tooltip>
                                ),
                              },
                              {
                                title: '启用',
                                dataIndex: 'enabled',
                                width: 60,
                                render: (enabled, record) => <Switch size='small' checked={enabled} onChange={(checked) => handleToggleRule(record.id, checked)} />,
                              },
                              {
                                title: '操作',
                                width: 80,
                                render: (_, record) => (
                                  <Space size='small'>
                                    <Button type='text' size='mini' icon={<Edit theme='outline' size='14' />} onClick={() => openEditModal(record)} />
                                    <Popconfirm title='确认删除此规则？' onOk={() => handleDeleteRule(record.id)}>
                                      <Button type='text' size='mini' status='danger' icon={<Delete theme='outline' size='14' />} />
                                    </Popconfirm>
                                  </Space>
                                ),
                              },
                            ]}
                          />
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          </>
        )}

        {/* 底部提示 */}
        <div className='f-center gap-2 text-14px text-tertiary mt-4'>
          <Shield theme='outline' size='16' fill='currentColor' />
          <span>您的每一次操作都在系统严格保护之下</span>
        </div>
      </div>

      {/* Rule Modal */}
      <RuleModal
        isVisible={showRuleModal}
        editingRule={editingRule}
        ruleForm={ruleForm}
        onFormChange={setRuleForm}
        onOk={handleSaveRule}
        onCancel={() => {
          setShowRuleModal(false);
          setEditingRule(null);
        }}
      />
    </PageWrapper>
  );
}
