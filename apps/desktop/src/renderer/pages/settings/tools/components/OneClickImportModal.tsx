/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button, Modal, Select, Spin, Steps } from '@arco-design/web-react';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import { acpConversation, mcpService } from '@/common/ipcBridge';
import type { IMcpServer, IMcpTool } from '@/common/storage';
import type { IDetectedAgent } from '../types';

interface OneClickImportModalProps {
  visible: boolean;
  onCancel: () => void;
  onBatchImport?: (servers: Omit<IMcpServer, 'id' | 'createdAt' | 'updatedAt'>[]) => void;
}

const OneClickImportModal: React.FC<OneClickImportModalProps> = ({ visible, onCancel, onBatchImport }) => {
  const { t } = useTranslation();
  const [detectedAgents, setDetectedAgents] = useState<IDetectedAgent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const [importableServers, setImportableServers] = useState<IMcpServer[]>([]);
  const [loadingImport, setLoadingImport] = useState(false);
  const [currentStep, setCurrentStep] = useState<number>(1);

  useEffect(() => {
    if (visible) {
      // 重置状态
      setCurrentStep(1);
      setSelectedAgent('');
      setImportableServers([]);
      setLoadingImport(false);

      // 初始化时检测可用的agents
      const loadAgents = async () => {
        try {
          const response = await acpConversation.getAvailableAgents.invoke();
          if (response.success && response.data) {
            const agents = response.data.map((agent) => ({ backend: agent.backend, name: agent.name }));
            setDetectedAgents(agents);
            // 设置第一个agent为默认值
            if (agents.length > 1) {
              setSelectedAgent(agents[0].backend);
            }
          }
        } catch (error) {
          console.error('Failed to load agents:', error);
        }
      };
      void loadAgents();
    }
  }, [visible]);

  const handleNextStep = async () => {
    if (currentStep === 1) {
      // 步骤1 -> 步骤2: 选择Agent后，进入获取MCP阶段
      if (!selectedAgent) return;
      setCurrentStep(2);
      await handleImportFromCLI();
    } else if (currentStep === 2) {
      // 步骤2 -> 步骤3: 执行导入，显示成功页面
      handleBatchImport();
      setCurrentStep(3);
    }
  };

  const handlePrevStep = () => {
    if (currentStep === 2) {
      setCurrentStep(1);
      setImportableServers([]);
      setLoadingImport(false);
    }
  };

  const handleImportFromCLI = async () => {
    setLoadingImport(true);
    try {
      // 获取所有可用的agents
      const agentsResponse = await acpConversation.getAvailableAgents.invoke();
      if (!agentsResponse.success || !agentsResponse.data) {
        throw new Error('Failed to get available agents');
      }

      // 通过IPC调用后端服务获取MCP配置
      const mcpResponse = await mcpService.getAgentMcpConfigs.invoke(agentsResponse.data);
      if (mcpResponse.success && mcpResponse.data) {
        const allServers: IMcpServer[] = [];

        // 过滤选中的agent的服务器
        mcpResponse.data.forEach((agentConfig) => {
          if (agentConfig.source === selectedAgent) {
            allServers.push(...agentConfig.servers);
          }
        });

        setImportableServers(allServers);
      } else {
        throw new Error(mcpResponse.msg || 'Failed to get MCP configs');
      }
    } catch (error) {
      console.error('Failed to import from CLI:', error);
      setImportableServers([]);
    } finally {
      setLoadingImport(false);
    }
  };

  const handleBatchImport = () => {
    if (onBatchImport && importableServers.length > 0) {
      const serversToImport = importableServers.map((server) => {
        // 为CLI导入的服务器生成标准的JSON格式
        const serverConfig: Record<string, string | string[] | Record<string, string>> = {
          description: server.description,
        };

        if (server.transport.type === 'stdio') {
          serverConfig.command = server.transport.command;
          if (server.transport.args?.length) {
            serverConfig.args = server.transport.args;
          }
          if (server.transport.env && Object.keys(server.transport.env).length) {
            serverConfig.env = server.transport.env;
          }
        } else {
          serverConfig.type = server.transport.type;
          serverConfig.url = server.transport.url;
          if (server.transport.headers && Object.keys(server.transport.headers).length) {
            serverConfig.headers = server.transport.headers;
          }
        }

        return {
          name: server.name,
          description: server.description,
          enabled: server.enabled,
          transport: server.transport,
          status: server.status as IMcpServer['status'],
          tools: (server.tools || []) as IMcpTool[], // 保留原始的 tools 信息
          originalJson: JSON.stringify({ mcpServers: { [server.name]: serverConfig } }, null, 2),
        };
      });
      onBatchImport(serversToImport);
    }
  };

  // 渲染步骤1: 选择Agent
  const renderStep1 = () => (
    <div className='py-4'>
      <Select placeholder={t('settings.mcpSelectCLI', '选择 CLI')} value={selectedAgent} onChange={setSelectedAgent} className='w-full' size='large'>
        {detectedAgents.map((agent) => (
          <Select.Option key={agent.backend} value={agent.backend}>
            {agent.name}
          </Select.Option>
        ))}
      </Select>
    </div>
  );

  // 渲染步骤2: 获取MCP工具列表
  const renderStep2 = () => (
    <div>
      {loadingImport ? (
        <div className='py-8'>
          <div className='flex items-center gap-3 bg-control rounded-3 p-4'>
            <Spin size={20} />
            <div className='text-secondary text-sm'>{t('settings.mcpLoadingTools', '读取CLI工具列表中...')}</div>
          </div>
        </div>
      ) : importableServers.length > 0 ? (
        <div>
          <div className='mb-3 flex items-center gap-2'>
            <Check className='text-success size-5' />
            <span className='text-foreground'>{t('settings.mcpToolsLoaded', { count: importableServers.length, defaultValue: '读取到{{count}}个工具' })}</span>
          </div>
          <div className='bg-control rounded-lg max-h-50 overflow-y-auto divide-y divide-light'>
            {importableServers.map((server, index) => (
              <div key={index} className='p-3'>
                <div className='font-medium text-foreground'>{server.name}</div>
                {server.description && <div className='text-sm text-secondary mt-1'>{server.description}</div>}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className='text-center py-8 text-secondary'>{t('settings.mcpNoServersFound', '未找到 MCP 服务器')}</div>
      )}
    </div>
  );

  // 渲染步骤3: 导入成功
  const renderStep3 = () => (
    <div>
      {importableServers.length > 0 ? (
        <div>
          <div className='mb-3 flex items-center gap-2'>
            <Check className='text-success size-5' />
            <span className='text-foreground'>{t('settings.mcpImportedSuccess', { count: importableServers.length, defaultValue: '已导入{{count}}个工具' })}</span>
          </div>
          <div className='bg-control rounded-lg max-h-50 overflow-y-auto divide-y divide-light'>
            {importableServers.map((server, index) => (
              <div key={index} className='p-3'>
                <div className='font-medium text-foreground'>{server.name}</div>
                {server.description && <div className='text-sm text-secondary mt-1'>{server.description}</div>}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className='text-center py-8 text-secondary'>{t('settings.mcpNoServersFound', '未找到 MCP 服务器')}</div>
      )}
    </div>
  );

  if (!visible) return null;

  const renderFooter = () => (
    <div className='flex justify-end gap-2.5'>
      {currentStep === 1 && (
        <>
          <Button onClick={onCancel} className='min-w-25'>
            {t('common.cancel', '取消')}
          </Button>
          <Button type='primary' onClick={handleNextStep} disabled={!selectedAgent}>
            {t('settings.mcpNextStep', '下一步')}
          </Button>
        </>
      )}
      {currentStep === 2 && (
        <>
          <Button onClick={handlePrevStep}>{t('settings.mcpPrevStep', '上一步')}</Button>
          <Button type='primary' onClick={handleNextStep} disabled={loadingImport || importableServers.length === 0}>
            {t('settings.mcpImportButton', '导入')}
          </Button>
        </>
      )}
      {currentStep === 3 && (
        <Button type='primary' onClick={onCancel}>
          {t('settings.mcpConfirmButton', '确定')}
        </Button>
      )}
    </div>
  );

  return (
    <Modal visible={visible} onCancel={onCancel} footer={renderFooter()} title={t('settings.mcpOneKeyImport', '一键导入')} style={{ width: 600 }}>
      <div className='flex flex-col h-[275px] mt-5'>
        <div className='mb-6 text-secondary text-sm'>{t('settings.mcpImportDescription', 'Sudowork会自动获取的您在CLI Agent中已安装的MCP，并一键导入')}</div>

        <div className='mb-6'>
          <Steps current={currentStep} size='small'>
            <Steps.Step title={t('settings.mcpStepSelectAgent', '选择Agent')} />
            <Steps.Step title={t('settings.mcpStepFetchTools', '获取mcp')} />
            <Steps.Step title={t('settings.mcpStepImportSuccess', '导入成功')} />
          </Steps>
        </div>

        <div className={`mb-6 flex-1 overflow-y-auto ${currentStep === 1 ? 'min-h-15' : 'min-h-45'}`}>
          {currentStep === 1 && renderStep1()}
          {currentStep === 2 && renderStep2()}
          {currentStep === 3 && renderStep3()}
        </div>
      </div>
    </Modal>
  );
};

export default OneClickImportModal;
