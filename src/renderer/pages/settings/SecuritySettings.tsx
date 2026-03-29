import { Shield, CheckOne, Lock, Scan, AllApplication, Delete, Edit, Plus } from '@icon-park/react';
import { Card, Tag, Switch, Button, Modal, Input, Select, Table, Space, Popconfirm, Message, Tooltip } from '@arco-design/web-react';
import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import type { BlacklistConfig, BlacklistRule, BlacklistMatchType } from '@/common/safetyTypes';
import { DEFAULT_BLACKLIST_CONFIG } from '@/common/safetyTypes';

const Option = Select.Option;
const TextArea = Input.TextArea;

// Generate unique ID for rules
const generateRuleId = (): string => `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

const SecuritySettings: React.FC = () => {
  const { t } = useTranslation();

  // 安全功能状态
  const envProtection = true;
  const infoProtection = true;
  const skillScan = true;
  const [hookEnabled, setHookEnabled] = useState(true);
  const [isHookLoading, setIsHookLoading] = useState(true);

  // Blacklist state
  const [blacklistConfig, setBlacklistConfig] = useState<BlacklistConfig>(DEFAULT_BLACKLIST_CONFIG);
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [editingRule, setEditingRule] = useState<BlacklistRule | null>(null);
  const [ruleForm, setRuleForm] = useState({
    type: 'network' as 'network' | 'file',
    pattern: '',
    matchType: 'wildcard' as BlacklistMatchType,
    description: '',
  });

  // 初始化时获取安全 Hook 实际状态
  useEffect(() => {
    const loadHookStatus = async () => {
      try {
        const result = await ipcBridge.safety.getEnabled.invoke();
        if (result.success && result.data) {
          setHookEnabled(result.data.enabled);
        }
      } catch (err) {
        console.error('[SecuritySettings] Failed to load safety hook status:', err);
      } finally {
        setIsHookLoading(false);
      }
    };
    void loadHookStatus();
  }, []);

  // Load blacklist config
  useEffect(() => {
    const loadBlacklist = async () => {
      try {
        const result = await ipcBridge.safety.getBlacklist.invoke();
        if (result.success && result.data) {
          setBlacklistConfig(result.data);
        }
      } catch (err) {
        console.error('[SecuritySettings] Failed to load blacklist config:', err);
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
        console.error('[SecuritySettings] Failed to set safety hook enabled:', result.msg);
        //  revert state if failed
        setHookEnabled(!checked);
      }
    } catch (err) {
      console.error('[SecuritySettings] Failed to toggle safety hook:', err);
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

    const newRule: BlacklistRule = {
      id: editingRule?.id || generateRuleId(),
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
      console.error('[SecuritySettings] Failed to save rule:', err);
      Message.error('保存规则失败');
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
        console.error('[SecuritySettings] Failed to delete rule:', err);
        Message.error('删除规则失败');
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
        console.error('[SecuritySettings] Failed to toggle rule:', err);
      }
    },
    [blacklistConfig]
  );

  // Open edit modal
  const openEditModal = useCallback((rule: BlacklistRule) => {
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
    <div className='p-24px flex flex-col gap-24px'>
      {/* 页面标题 */}
      <div className='flex flex-col gap-8px'>
        <h2 className='text-24px font-600 text-t-primary'>安全防护</h2>
        <p className='text-14px text-t-secondary'>全方位保护您的系统和数据安全</p>
      </div>

      {/* 电脑环境安全防护 */}
      <Card className='rd-12px hover:shadow-md transition-shadow'>
        <div className='flex items-start gap-16px'>
          <div className='w-56px h-56px rounded-12px bg-[#faad1415] flex items-center justify-center flex-shrink-0'>
            <Shield theme='outline' size='32' fill='#faad14' />
          </div>
          <div className='flex-1'>
            <div className='flex items-center gap-8px mb-8px'>
              <h3 className='text-18px font-600 text-t-primary'>电脑环境安全防护</h3>
              <Tag color='orange' size='small' className='rd-4px'>
                <CheckOne theme='filled' size='12' className='mr-4px' />
                主动防御
              </Tag>
            </div>
            <p className='text-14px text-t-secondary mb-16px leading-relaxed'>当智能体调用各类工具时，系统会进行全过程的安全管控。识别并拦截可能破坏系统、窃取数据、尝试提权的高风险行为，保障您的电脑环境安全。</p>
            <div className='flex items-center justify-end gap-12px'>
              <Tag color='green' size='small' className='rd-12px px-12px'>
                <span className='w-6px h-6px rd-50% inline-block mr-6px bg-[#52c41a]'></span>
                保护中
              </Tag>
              <Switch checked={envProtection} disabled />
            </div>
          </div>
        </div>
      </Card>

      {/* 用户信息安全保护 */}
      <Card className='rd-12px hover:shadow-md transition-shadow'>
        <div className='flex items-start gap-16px'>
          <div className='w-56px h-56px rounded-12px bg-[#52c41a15] flex items-center justify-center flex-shrink-0'>
            <Lock theme='outline' size='32' fill='#52c41a' />
          </div>
          <div className='flex-1'>
            <div className='flex items-center gap-8px mb-8px'>
              <h3 className='text-18px font-600 text-t-primary'>用户信息安全保护</h3>
              <Tag color='green' size='small' className='rd-4px'>
                <CheckOne theme='filled' size='12' className='mr-4px' />
                智能识别
              </Tag>
            </div>
            <p className='text-14px text-t-secondary mb-16px leading-relaxed'>对输入给智能体的任务、提示词进行智能安全识别，自动检测是否包含个人隐私、敏感密钥、账号凭证等高风险信息，保障用户信息安全。</p>
            <div className='flex items-center justify-end gap-12px'>
              <Tag color='green' size='small' className='rd-12px px-12px'>
                <span className='w-6px h-6px rd-50% inline-block mr-6px bg-[#52c41a]'></span>
                保护中
              </Tag>
              <Switch checked={infoProtection} disabled />
            </div>
          </div>
        </div>
      </Card>

      {/* Skill 技能安全扫描 */}
      <Card className='rd-12px hover:shadow-md transition-shadow'>
        <div className='flex items-start gap-16px'>
          <div className='w-56px h-56px rounded-12px bg-[#1890ff15] flex items-center justify-center flex-shrink-0'>
            <Scan theme='outline' size='32' fill='#1890ff' />
          </div>
          <div className='flex-1'>
            <div className='flex items-center gap-8px mb-8px'>
              <h3 className='text-18px font-600 text-t-primary'>Skill 技能安全扫描</h3>
              <Tag color='blue' size='small' className='rd-4px'>
                <CheckOne theme='filled' size='12' className='mr-4px' />
                多层检测
              </Tag>
            </div>
            <p className='text-14px text-t-secondary mb-16px leading-relaxed'>所有 Skill 在安装和接入前，系统都会进行多层安全检测，包括来源可信度、代码审查、权限评估等，确保所有接入的技能纯净无害。</p>
            <div className='flex items-center justify-end gap-12px'>
              <Tag color='green' size='small' className='rd-12px px-12px'>
                <span className='w-6px h-6px rd-50% inline-block mr-6px bg-[#52c41a]'></span>
                保护中
              </Tag>
              <Switch checked={skillScan} disabled />
            </div>
          </div>
        </div>
      </Card>

      {/* 安全 Hook 防护 */}
      <Card className='rd-12px hover:shadow-md transition-shadow'>
        <div className='flex items-start gap-16px'>
          <div className='w-56px h-56px rounded-12px bg-[#722ed115] flex items-center justify-center flex-shrink-0'>
            <AllApplication theme='outline' size='32' fill='#722ed1' />
          </div>
          <div className='flex-1'>
            <div className='flex items-center gap-8px mb-8px'>
              <h3 className='text-18px font-600 text-t-primary'>安全 Hook 防护</h3>
              <Tag color='purple' size='small' className='rd-4px'>
                <CheckOne theme='filled' size='12' className='mr-4px' />
                实时拦截
              </Tag>
            </div>
            <p className='text-14px text-t-secondary mb-16px leading-relaxed'>监控第三方 AI 工具的文件访问和网络请求，仅对黑名单中的规则进行拦截，匹配时弹出确认框，经您授权后才允许执行。</p>

            {/* 主开关 */}
            <div className='flex items-center justify-end gap-12px mb-16px'>
              <Tag color={hookEnabled ? 'green' : 'gray'} size='small' className='rd-12px px-12px'>
                <span className='w-6px h-6px rd-50% inline-block mr-6px' style={{ backgroundColor: hookEnabled ? '#52c41a' : '#999' }}></span>
                {hookEnabled ? '保护中' : '已关闭'}
              </Tag>
              <Switch checked={hookEnabled} onChange={handleToggleHook} />
            </div>

            {/* 黑名单规则 - 仅在启用时显示 */}
            {hookEnabled && (
              <>
                <div className='border-t border-t-[var(--color-border-2)] pt-16px'>
                  {/* 规则说明 */}
                  <div className='mb-12px'>
                    <span className='text-14px text-t-secondary'>
                      当前黑名单规则：{blacklistConfig.rules.filter((r) => r.enabled).length} 条生效
                      {blacklistConfig.rules.length === 0 && '（为空时不拦截任何请求）'}
                    </span>
                  </div>

                  {/* Rules section */}
                  <div className='flex items-center justify-between mb-12px'>
                    <h4 className='text-16px font-500 text-t-primary'>拦截规则</h4>
                    <Button type='primary' size='small' icon={<Plus theme='outline' size='14' />} onClick={openAddModal}>
                      添加规则
                    </Button>
                  </div>

                  {blacklistConfig.rules.length === 0 ? (
                    <div className='text-center py-24px text-t-tertiary bg-[var(--color-fill-1)] rd-8px'>暂无拦截规则</div>
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
                          render: (type) => (
                            <Tag color={type === 'network' ? 'blue' : 'green'} size='small'>
                              {type === 'network' ? '网络' : '文件'}
                            </Tag>
                          ),
                        },
                        {
                          title: '匹配',
                          dataIndex: 'matchType',
                          width: 70,
                          render: (matchType: BlacklistMatchType) => {
                            const labels: Record<BlacklistMatchType, string> = {
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
                </div>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* Rule Modal */}
      <Modal
        title={editingRule ? '编辑规则' : '添加规则'}
        visible={showRuleModal}
        onOk={handleSaveRule}
        onCancel={() => {
          setShowRuleModal(false);
          setEditingRule(null);
        }}
        autoFocus={false}
        focusLock={true}
      >
        <div className='flex flex-col gap-16px'>
          <div>
            <label className='block text-14px text-t-secondary mb-4px'>类型</label>
            <Select value={ruleForm.type} onChange={(val) => setRuleForm({ ...ruleForm, type: val })} style={{ width: '100%' }}>
              <Option value='network'>网络请求 (域名/IP)</Option>
              <Option value='file'>文件操作 (路径)</Option>
            </Select>
          </div>

          <div>
            <label className='block text-14px text-t-secondary mb-4px'>匹配方式</label>
            <Select value={ruleForm.matchType} onChange={(val) => setRuleForm({ ...ruleForm, matchType: val })} style={{ width: '100%' }}>
              <Option value='exact'>精确匹配</Option>
              <Option value='wildcard'>通配符匹配</Option>
            </Select>
          </div>

          <div>
            <label className='block text-14px text-t-secondary mb-4px'>{ruleForm.type === 'network' ? '域名/IP 模式' : '路径模式'}</label>
            <Input placeholder={ruleForm.type === 'network' ? '例如: *.example.com 或 192.168.1.*' : '例如: /etc/* 或 ~/.ssh/*'} value={ruleForm.pattern} onChange={(val) => setRuleForm({ ...ruleForm, pattern: val })} />
          </div>

          <div>
            <label className='block text-14px text-t-secondary mb-4px'>描述 (可选)</label>
            <TextArea placeholder='规则说明' value={ruleForm.description} onChange={(val) => setRuleForm({ ...ruleForm, description: val })} autoSize={{ minRows: 2, maxRows: 4 }} />
          </div>
        </div>
      </Modal>

      {/* 底部提示 */}
      <div className='flex items-center justify-center gap-8px text-14px text-t-tertiary mt-16px'>
        <Shield theme='outline' size='16' fill='currentColor' />
        <span>您的每一次操作都在系统严格保护之下</span>
      </div>
    </div>
  );
};

export default SecuritySettings;
