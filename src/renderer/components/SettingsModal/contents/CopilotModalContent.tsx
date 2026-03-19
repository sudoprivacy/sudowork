/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, Divider, Input, Message, Modal, Space, Spin, Tag, Typography } from '@arco-design/web-react';
import { CheckOne, Edit, Folder, LinkCloud, Refresh, Robot, Setting, User } from '@icon-park/react';
import { ipcBridge } from '@/common';
import { iconColors } from '@/renderer/theme/colors';
import OpenClawLogo from '@/renderer/assets/logos/openclaw.svg';
import { fs } from '@/common/ipcBridge';

const { Title, Text } = Typography;

// ==================== Types ====================

interface OpenClawGatewayStatus {
  gatewayRunning: boolean;
  gatewayPort: number;
  gatewayHost: string;
  gatewayUrl: string;
  isConnected: boolean;
  hasActiveSession: boolean;
  sessionKey: string | null;
  workspace?: string;
  agentName?: string;
  model?: string;
  cliPath?: string;
  version?: string;
  error?: string;
}

// ==================== 子组件 / Sub-components ====================

/**
 * 状态卡片 / Status Card
 */
const StatusCard: React.FC<{
  title: string;
  value: string | number;
  icon: React.ReactNode;
  status?: 'success' | 'warning' | 'error' | 'info';
  description?: string;
}> = ({ title, value, icon, status = 'info', description }) => {
  const statusColors = {
    success: { bg: '#52c41a15', text: '#52c41a' },
    warning: { bg: '#faad1415', text: '#faad14' },
    error: { bg: '#ff4d4f15', text: '#ff4d4f' },
    info: { bg: `${iconColors.primary}15`, text: iconColors.primary },
  };

  const colors = statusColors[status];

  return (
    <Card className='rd-12px hover:shadow-md transition-shadow'>
      <div className='flex items-start gap-12px'>
        <div className='w-48px h-48px rounded-12px flex items-center justify-center flex-shrink-0' style={{ backgroundColor: colors.bg }}>
          {icon}
        </div>
        <div className='flex-1 min-w-0'>
          <div className='text-13px text-t-secondary mb-4px'>{title}</div>
          <div className='text-20px font-600 text-t-primary truncate' title={String(value)}>
            {value}
          </div>
          {description && (
            <div className='text-12px text-t-tertiary mt-4px truncate' title={description}>
              {description}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};

/**
 * 配置项组件 / Config Item
 */
const ConfigItem: React.FC<{
  label: string;
  value: string;
  onCopy?: () => void;
  breakWord?: boolean;
}> = ({ label, value, onCopy, breakWord }) => (
  <div className='flex items-center justify-between py-12px border-b border-b-border-2 last:border-b-0'>
    <div className='text-14px text-t-secondary flex-shrink-0'>{label}</div>
    <div className='flex items-center gap-8px min-w-0 flex-1 justify-end'>
      <Text className={`text-14px text-t-primary ${breakWord ? 'break-all max-w-[300px]' : 'max-w-[200px] truncate'}`} title={value}>
        {value}
      </Text>
      {onCopy && (
        <Button type='text' size='mini' onClick={onCopy} className='flex-shrink-0'>
          复制
        </Button>
      )}
    </div>
  </div>
);

// ==================== 主组件 / Main Component ====================

const OpenClawModalContent: React.FC = () => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<OpenClawGatewayStatus | null>(null);

  // 编辑配置弹窗
  const [editConfigVisible, setEditConfigVisible] = useState(false);
  const [configContent, setConfigContent] = useState('');
  const [configLoading, setConfigLoading] = useState(false);
  const [configPath, setConfigPath] = useState('');

  // 加载状态 - 优先获取本地 OpenClaw 状态
  const loadStatus = async () => {
    setLoading(true);
    try {
      // Get CLI info for model/config (fast, from config file)
      const cliPromise = ipcBridge.openclawConversation.getCliInfo.invoke();
      // Get gateway status for session info (sessionKey, hasActiveSession)
      const gatewayPromise = ipcBridge.openclawConversation.getGatewayStatus.invoke();

      const [cliResult, gatewayResult] = await Promise.all([cliPromise, gatewayPromise]);

      // Prioritize local OpenClaw status (from CLI config)
      if (cliResult.success && cliResult.data) {
        const cliData = cliResult.data;

        // Check if this is local OpenClaw (default port 18789 on localhost)
        const isLocalOpenClaw = cliData.gatewayHost === 'localhost' && cliData.gatewayPort === 18789;

        // Merge with gateway data if available (for session info)
        if (gatewayResult.success && gatewayResult.data) {
          const gatewayData = gatewayResult.data;
          setStatus({
            gatewayRunning: gatewayData.gatewayRunning,
            gatewayPort: gatewayData.gatewayPort,
            gatewayHost: gatewayData.gatewayHost,
            gatewayUrl: gatewayData.gatewayUrl,
            isConnected: isLocalOpenClaw ? cliData.isConnected : gatewayData.isConnected, // Prioritize local connection status
            hasActiveSession: gatewayData.hasActiveSession,
            sessionKey: gatewayData.sessionKey,
            workspace: cliData.workspace || gatewayData.workspace,
            agentName: cliData.agentName || gatewayData.agentName,
            model: cliData.model || gatewayData.model,
            cliPath: cliData.gatewayHost ? undefined : gatewayData.cliPath,
            version: cliData.version,
          });
        } else {
          // Use CLI data only
          setStatus({
            gatewayRunning: cliData.isConnected ?? false,
            gatewayPort: cliData.gatewayPort || 18789,
            gatewayHost: cliData.gatewayHost || 'localhost',
            gatewayUrl: `ws://${cliData.gatewayHost || 'localhost'}:${cliData.gatewayPort || 18789}`,
            isConnected: cliData.isConnected ?? false,
            hasActiveSession: false,
            sessionKey: null,
            workspace: cliData.workspace,
            agentName: cliData.agentName,
            model: cliData.model,
            cliPath: undefined,
            version: cliData.version,
          });
        }
      } else if (gatewayResult.success && gatewayResult.data) {
        // Fallback to gateway only
        setStatus(gatewayResult.data);
      } else {
        Message.error(cliResult.msg || gatewayResult.msg || '获取 Copilot 状态失败');
      }
    } catch (error) {
      Message.error('获取 Copilot 状态失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  // 刷新状态
  const handleRefresh = async () => {
    await loadStatus();
    Message.success('状态已刷新');
  };

  // 复制文本
  const copyToClipboard = (text: string) => {
    void navigator.clipboard.writeText(text);
    Message.success('已复制到剪贴板');
  };

  // 重启 OpenClaw Gateway
  const restartGateway = async () => {
    try {
      const result = await ipcBridge.openclawConversation.getGatewayStatus.invoke();
      if (result.success && result.data?.gatewayRunning) {
        // 提示用户重启
        Modal.confirm({
          title: '重启 OpenClaw Gateway',
          content: '确定要重启 OpenClaw Gateway 吗？这可能会中断正在进行的对话。',
          okText: '确定',
          cancelText: '取消',
          onOk: async () => {
            // Fire-and-forget: 发送命令后不等待返回，直接关闭弹窗
            ipcBridge.application.execCommand
              .invoke({
                command: 'openclaw gateway restart',
                cwd: process.env.HOME,
              })
              .catch(() => {}); // 忽略错误

            Message.success('重启命令已发送');

            // 延迟刷新状态
            setTimeout(() => {
              void loadStatus();
            }, 10000);
          },
        });
      } else {
        Message.info('OpenClaw Gateway 未运行，无需重启');
      }
    } catch (error) {
      console.error('[OpenClawModalContent] Failed to restart gateway:', error);
      Message.error('重启失败');
    }
  };

  // 打开配置文件
  const openConfigEditor = async () => {
    setConfigLoading(true);
    try {
      // Get home directory from system
      const homeDir = await ipcBridge.application.getPath.invoke({ name: 'home' });
      // OpenClaw 配置文件路径
      const configFilePath = `${homeDir}/.openclaw/openclaw.json`;
      setConfigPath(configFilePath);
      const result = await fs.readFile.invoke({ path: configFilePath });
      if (result) {
        setConfigContent(result);
        setEditConfigVisible(true);
      } else {
        Message.warning('配置文件不存在');
      }
    } catch (error) {
      console.error('[OpenClawModalContent] Failed to read config:', error);
      Message.error('读取配置文件失败：' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setConfigLoading(false);
    }
  };

  // 保存配置文件
  const saveConfig = async () => {
    setConfigLoading(true);
    try {
      await fs.writeFile.invoke({ path: configPath, data: configContent });
      Message.success('配置已保存，请重启 OpenClaw 生效');
      setEditConfigVisible(false);
      // 刷新状态
      await loadStatus();
    } catch (error) {
      console.error('[OpenClawModalContent] Failed to save config:', error);
      Message.error('保存配置文件失败');
    } finally {
      setConfigLoading(false);
    }
  };

  // 处理保存按钮点击
  const handleSaveConfig = () => {
    void saveConfig();
  };

  if (loading) {
    return (
      <div className='flex items-center justify-center h-full min-h-[400px]'>
        <Spin tip='加载中...' />
      </div>
    );
  }

  const isConnected = status?.isConnected ?? false;

  return (
    <div className='h-full flex flex-col'>
      {/* 顶部标题 */}
      <div className='flex items-center justify-between mb-24px'>
        <div className='flex items-center gap-12px'>
          {/* <div className='w-8 h-8 rounded-8px bg-gradient-to-br from-primary-5 to-primary-6 flex items-center justify-center p-4px'>
            <img src={OpenClawLogo} alt='OpenClaw' className='w-full h-full object-contain' />
          </div> */}
          <div>
            <Title heading={5} className='m-0 text-18px'>
              Copilot
            </Title>
            <Text type='secondary' className='text-13px'>
              配置 Sudowork 与 Copilot 的集成
            </Text>
          </div>
        </div>
        <Space>
          {isConnected && (
            <Tag color='green' size='large'>
              已连接
            </Tag>
          )}
          <Button type='primary' icon={<Refresh theme='outline' size='16' />} loading={loading} onClick={handleRefresh}>
            刷新
          </Button>
        </Space>
      </div>

      {/* 连接状态提示 */}
      {!isConnected && (
        <Alert
          type='warning'
          className='mb-24px'
          content={
            <div>
              <div className='font-500 mb-4px'>Copilot 未连接</div>
              <div className='text-13px'>请确保 Copilot 已安装并运行。</div>
            </div>
          }
        />
      )}

      {isConnected && (
        <Alert
          type='success'
          className='mb-24px'
          content={
            <div className='flex items-center gap-8px'>
              <span>Copilot 已连接并正常运行</span>
            </div>
          }
        />
      )}

      {/* 内容区域 */}
      <div className='flex-1 overflow-y-auto space-y-24px'>
        {/* 状态概览 */}
        <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-16px'>
          <StatusCard title='连接状态' value={isConnected ? '已连接' : '未连接'} icon={<img src={OpenClawLogo} alt='OpenClaw' className='w-5 h-5 object-contain' />} status={isConnected ? 'success' : 'error'} description={status?.gatewayUrl} />
          <StatusCard title='Agent' value={status?.agentName || '未设置'} icon={<Robot theme='outline' size='24' fill={iconColors.primary} />} status='info' description={status?.model} />
          <StatusCard title='工作区' value={status?.workspace ? '已配置' : '未配置'} icon={<Folder theme='outline' size='24' fill={status?.workspace ? iconColors.warning : '#999'} />} status={status?.workspace ? 'success' : 'info'} description={status?.workspace} />
          <StatusCard title='会话状态' value={status?.hasActiveSession ? '活动中' : '空闲'} icon={<User theme='outline' size='24' fill={status?.hasActiveSession ? iconColors.success : '#999'} />} status={status?.hasActiveSession ? 'success' : 'info'} description={status?.sessionKey || '无活动会话'} />
        </div>

        {/* 配置信息 */}
        <div className='grid grid-cols-1 lg:grid-cols-2 gap-24px'>
          {/* 连接配置 */}
          <Card title='🔗 连接配置' className='rd-12px'>
            <div className='divide-y divide-border-2'>
              <ConfigItem label='Gateway URL' value={status?.gatewayUrl || '未配置'} onCopy={() => status?.gatewayUrl && copyToClipboard(status.gatewayUrl)} />
              <ConfigItem label='Gateway 主机' value={`${status?.gatewayHost || 'localhost'}:${status?.gatewayPort || 18789}`} />
              <ConfigItem label='Gateway 状态' value={status?.gatewayRunning ? '运行中' : '未运行'} />
              <ConfigItem label='CLI 路径' value={status?.cliPath || 'openclaw (默认)'} onCopy={() => status?.cliPath && copyToClipboard(status.cliPath)} />
            </div>
          </Card>

          {/* Agent 配置 */}
          <Card title='🤖 Agent 配置' className='rd-12px'>
            <div className='divide-y divide-border-2'>
              <ConfigItem label='Agent 名称' value={status?.agentName || '未设置'} />
              <ConfigItem label='当前模型' value={status?.model || '未设置'} />
              <ConfigItem label='连接状态' value={status?.isConnected ? '已连接' : '未连接'} />
              <ConfigItem label='会话密钥' value={status?.sessionKey || '无'} onCopy={() => status?.sessionKey && copyToClipboard(status.sessionKey)} breakWord />
            </div>
          </Card>
        </div>

        {/* 配置文件编辑 */}
        <Card title='📝 配置文件' className='rd-12px'>
          <div className='flex items-center justify-between'>
            <div className='flex-1'>
              <div className='text-14px text-t-primary font-500'>OpenClaw 配置文件</div>
              <div className='text-12px text-t-tertiary mt-2px'>编辑 ~/.openclaw/openclaw.json 配置文件</div>
            </div>
            <Space>
              <Button icon={<Edit theme='outline' size='16' />} onClick={openConfigEditor} loading={configLoading}>
                编辑配置
              </Button>
              <Button icon={<Refresh theme='outline' size='16' />} onClick={restartGateway}>
                重启 Gateway
              </Button>
            </Space>
          </div>
        </Card>
      </div>

      {/* 编辑配置弹窗 */}
      {editConfigVisible &&
        ((
          <Modal title='编辑 OpenClaw 配置' visible={editConfigVisible} onOk={handleSaveConfig} onCancel={() => setEditConfigVisible(false)} width={800} confirmLoading={configLoading} {...({} as any)}>
            <div className='flex flex-col gap-8px'>
              <Text type='secondary' className='text-12px'>
                配置文件路径：{configPath}
              </Text>
              <Input.TextArea value={configContent} onChange={(value) => setConfigContent(value)} style={{ height: 400, fontFamily: 'monospace', fontSize: 13 }} placeholder='配置文件内容...' />
            </div>
          </Modal>
        ) as any)}
    </div>
  );
};

export default OpenClawModalContent;
