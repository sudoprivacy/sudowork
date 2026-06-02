/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ConfigStorage, DEFAULT_IMAGE_GENERATION_MODEL, type IConfigStorageRefer, type IMcpServer } from '@/common/storage';
import { acpConversation, scode } from '@/common/ipcBridge';
import { Divider, Form, Switch, Tooltip, Message, Button, Dropdown, Menu, Modal } from '@arco-design/web-react';
import { Help, Down, Plus } from '@icon-park/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useConfigModelListWithImage from '@/renderer/hooks/useConfigModelListWithImage';
import AionScrollArea from '@/renderer/components/base/AionScrollArea';
import AionSelect from '@/renderer/components/base/AionSelect';
import AddMcpServerModal from '@/renderer/pages/settings/components/AddMcpServerModal';
import McpServerItem from '@/renderer/pages/settings/McpManagement/McpServerItem';
import { useMcpServers, useMcpAgentStatus, useMcpOperations, useMcpConnection, useMcpModal, useMcpServerCRUD, useMcpOAuth } from '@/renderer/hooks/mcp';
import classNames from 'classnames';
import { useSettingsViewMode } from '../settingsViewContext';

type MessageInstance = ReturnType<typeof Message.useMessage>[0];

const LEGACY_DEFAULT_IMAGE_GENERATION_MODEL = 'gpt-image-1.5';

const IMAGE_GENERATION_MODEL_OPTIONS = [
  { label: 'gemini-3.1-flash-image-preview', value: 'gemini-3.1-flash-image-preview' },
  { label: 'gemini-3-pro-image-preview', value: 'gemini-3-pro-image-preview' },
  { label: 'gemini-2.5-flash-image', value: 'gemini-2.5-flash-image' },
  { label: 'gpt-image-1.5', value: 'gpt-image-1.5' },
  { label: 'gpt-image-1', value: 'gpt-image-1' },
  { label: 'doubao-seedream-4-0-250828', value: 'doubao-seedream-4-0-250828' },
];

const ModalMcpManagementSection: React.FC<{ message: MessageInstance; isPageMode?: boolean }> = ({ message, isPageMode }) => {
  const { t } = useTranslation();
  const { mcpServers, extensionMcpServers, saveMcpServers } = useMcpServers();
  const { agentInstallStatus, setAgentInstallStatus, isServerLoading, checkSingleServerInstallStatus } = useMcpAgentStatus();
  const { syncMcpToAgents, removeMcpFromAgents } = useMcpOperations(mcpServers, message);
  const { oauthStatus, loggingIn, checkOAuthStatus, login } = useMcpOAuth();

  const handleAuthRequired = useCallback(
    (server: IMcpServer) => {
      void checkOAuthStatus(server);
    },
    [checkOAuthStatus]
  );

  const { testingServers, handleTestMcpConnection } = useMcpConnection(mcpServers, saveMcpServers, message, handleAuthRequired);
  const { showMcpModal, editingMcpServer, deleteConfirmVisible, serverToDelete, mcpCollapseKey, showAddMcpModal, showEditMcpModal, hideMcpModal, showDeleteConfirm, hideDeleteConfirm, toggleServerCollapse } = useMcpModal();
  const { handleAddMcpServer, handleBatchImportMcpServers, handleEditMcpServer, handleDeleteMcpServer, handleToggleMcpServer } = useMcpServerCRUD(mcpServers, saveMcpServers, syncMcpToAgents, removeMcpFromAgents, checkSingleServerInstallStatus, setAgentInstallStatus, message);

  const handleOAuthLogin = useCallback(
    async (server: IMcpServer) => {
      const result = await login(server);

      if (result.success) {
        message.success(`${server.name}: ${t('settings.mcpOAuthLoginSuccess') || 'Login successful'}`);
        void handleTestMcpConnection(server);
      } else {
        message.error(`${server.name}: ${result.error || t('settings.mcpOAuthLoginFailed') || 'Login failed'}`);
      }
    },
    [login, message, t, handleTestMcpConnection]
  );

  const wrappedHandleAddMcpServer = useCallback(
    async (serverData: Omit<IMcpServer, 'id' | 'createdAt' | 'updatedAt'>) => {
      const addedServer = await handleAddMcpServer(serverData);
      if (addedServer) {
        void handleTestMcpConnection(addedServer);
        if (addedServer.transport.type === 'http' || addedServer.transport.type === 'sse') {
          void checkOAuthStatus(addedServer);
        }
        if (serverData.enabled) {
          void syncMcpToAgents(addedServer, true);
        }
      }
    },
    [handleAddMcpServer, handleTestMcpConnection, checkOAuthStatus, syncMcpToAgents]
  );

  const wrappedHandleEditMcpServer = useCallback(
    async (editingMcpServer: IMcpServer | undefined, serverData: Omit<IMcpServer, 'id' | 'createdAt' | 'updatedAt'>) => {
      const updatedServer = await handleEditMcpServer(editingMcpServer, serverData);
      if (updatedServer) {
        void handleTestMcpConnection(updatedServer);
        if (updatedServer.transport.type === 'http' || updatedServer.transport.type === 'sse') {
          void checkOAuthStatus(updatedServer);
        }
        if (serverData.enabled) {
          void syncMcpToAgents(updatedServer, true);
        }
      }
    },
    [handleEditMcpServer, handleTestMcpConnection, checkOAuthStatus, syncMcpToAgents]
  );

  const wrappedHandleBatchImportMcpServers = useCallback(
    async (serversData: Omit<IMcpServer, 'id' | 'createdAt' | 'updatedAt'>[]) => {
      const addedServers = await handleBatchImportMcpServers(serversData);
      if (addedServers && addedServers.length > 0) {
        addedServers.forEach((server) => {
          void handleTestMcpConnection(server);
          if (server.transport.type === 'http' || server.transport.type === 'sse') {
            void checkOAuthStatus(server);
          }
          if (server.enabled) {
            void syncMcpToAgents(server, true);
          }
        });
      }
    },
    [handleBatchImportMcpServers, handleTestMcpConnection, checkOAuthStatus, syncMcpToAgents]
  );

  const [detectedAgents, setDetectedAgents] = useState<Array<{ backend: string; name: string }>>([]);
  const [importMode, setImportMode] = useState<'json' | 'oneclick'>('json');

  useEffect(() => {
    const loadAgents = async () => {
      try {
        const response = await acpConversation.getAvailableAgents.invoke();
        if (response.success && response.data) {
          setDetectedAgents(response.data.map((agent) => ({ backend: agent.backend, name: agent.name })));
        }
      } catch (error) {
        console.error('Failed to load agents:', error);
      }
    };
    void loadAgents();
  }, []);

  useEffect(() => {
    const httpServers = mcpServers.filter((s) => s.transport.type === 'http' || s.transport.type === 'sse');
    if (httpServers.length > 0) {
      httpServers.forEach((server) => {
        void checkOAuthStatus(server);
      });
    }
  }, [mcpServers, checkOAuthStatus]);

  const handleConfirmDelete = useCallback(async () => {
    if (!serverToDelete) return;
    hideDeleteConfirm();
    await handleDeleteMcpServer(serverToDelete);
  }, [serverToDelete, hideDeleteConfirm, handleDeleteMcpServer]);

  const renderAddButton = () => {
    if (detectedAgents.length > 0) {
      return (
        <Dropdown
          trigger='click'
          droplist={
            <Menu>
              <Menu.Item
                key='json'
                onClick={(e) => {
                  e.stopPropagation();
                  setImportMode('json');
                  showAddMcpModal();
                }}
              >
                {t('settings.mcpImportFromJSON')}
              </Menu.Item>
              <Menu.Item
                key='oneclick'
                onClick={(e) => {
                  e.stopPropagation();
                  setImportMode('oneclick');
                  showAddMcpModal();
                }}
              >
                {t('settings.mcpOneKeyImport')}
              </Menu.Item>
            </Menu>
          }
        >
          <Button type='outline' icon={<Plus size={'16'} />} shape='round' onClick={(e) => e.stopPropagation()}>
            {t('settings.mcpAddServer')} <Down size='12' />
          </Button>
        </Dropdown>
      );
    }

    return (
      <Button
        type='outline'
        icon={<Plus size={'16'} />}
        shape='round'
        onClick={() => {
          setImportMode('json');
          showAddMcpModal();
        }}
      >
        {t('settings.mcpAddServer')}
      </Button>
    );
  };

  return (
    <div className='flex flex-col gap-16px min-h-0'>
      <div className='flex gap-8px items-center justify-between'>
        <div className='text-14px text-t-primary'>{t('settings.mcpSettings')}</div>
        <div>{renderAddButton()}</div>
      </div>

      <div className='flex-1 min-h-0'>
        {mcpServers.length === 0 && extensionMcpServers.length === 0 ? (
          <div className='py-24px text-center text-t-secondary text-14px border border-dashed border-border-2 rd-12px'>{t('settings.mcpNoServersFound')}</div>
        ) : (
          <AionScrollArea className={classNames('max-h-360px', isPageMode && 'max-h-none')} disableOverflow={isPageMode}>
            <div className='space-y-12px'>
              {mcpServers.map((server) => (
                <McpServerItem key={server.id} server={server} isCollapsed={mcpCollapseKey[server.id] || false} agentInstallStatus={agentInstallStatus} isServerLoading={isServerLoading} isTestingConnection={testingServers[server.id] || false} oauthStatus={oauthStatus[server.id]} isLoggingIn={loggingIn[server.id]} onToggleCollapse={() => toggleServerCollapse(server.id)} onTestConnection={handleTestMcpConnection} onEditServer={showEditMcpModal} onDeleteServer={showDeleteConfirm} onToggleServer={handleToggleMcpServer} onOAuthLogin={handleOAuthLogin} />
              ))}
              {extensionMcpServers.map((server) => (
                <McpServerItem key={server.id} server={server} isCollapsed={mcpCollapseKey[server.id] || false} agentInstallStatus={agentInstallStatus} isServerLoading={isServerLoading} isTestingConnection={false} onToggleCollapse={() => toggleServerCollapse(server.id)} onTestConnection={handleTestMcpConnection} onEditServer={() => {}} onDeleteServer={() => {}} onToggleServer={() => Promise.resolve()} isReadOnly />
              ))}
            </div>
          </AionScrollArea>
        )}
      </div>

      <AddMcpServerModal visible={showMcpModal} server={editingMcpServer} onCancel={hideMcpModal} onSubmit={editingMcpServer ? (serverData) => wrappedHandleEditMcpServer(editingMcpServer, serverData) : wrappedHandleAddMcpServer} onBatchImport={wrappedHandleBatchImportMcpServers} importMode={importMode} />

      <Modal title={t('settings.mcpDeleteServer')} visible={deleteConfirmVisible} onCancel={hideDeleteConfirm} onOk={handleConfirmDelete} okButtonProps={{ status: 'danger' }} okText={t('common.confirm')} cancelText={t('common.cancel')}>
        <p>{t('settings.mcpDeleteConfirm')}</p>
      </Modal>
    </div>
  );
};

const ToolsModalContent: React.FC = () => {
  const { t } = useTranslation();
  const [mcpMessage, mcpMessageContext] = Message.useMessage({ maxCount: 10 });
  const [imageGenerationModel, setImageGenerationModel] = useState<IConfigStorageRefer['tools.imageGenerationModel'] | undefined>();
  const { modelListWithImage: data } = useConfigModelListWithImage();

  const imageGenerationModelList = useMemo(() => {
    if (!data) return [];
    // Filter models that support image generation
    // 筛选支持图片生成的模型
    const isImageModel = (modelName: string) => {
      const name = modelName.toLowerCase();
      return name.includes('image') || name.includes('banana');
    };
    return (data || [])
      .filter((v) => {
        const filteredModels = v.model.filter(isImageModel);
        return filteredModels.length > 0;
      })
      .map((v) => ({
        ...v,
        model: v.model.filter(isImageModel),
      }));
  }, [data]);

  const syncImageGenerationModel = useCallback((modelConfig: Partial<IConfigStorageRefer['tools.imageGenerationModel']>) => {
    const modelId = modelConfig.switch && modelConfig.useModel ? modelConfig.useModel : null;
    scode.setImageModel.invoke({ modelId }).catch(console.error);
  }, []);

  useEffect(() => {
    const loadConfigs = async () => {
      try {
        const saved = await ConfigStorage.get('tools.imageGenerationModel');
        if (saved) {
          // Always ensure useModel is set
          if (!saved.useModel || saved.useModel === LEGACY_DEFAULT_IMAGE_GENERATION_MODEL) {
            const nextConfig = {
              ...saved,
              useModel: DEFAULT_IMAGE_GENERATION_MODEL,
            };
            setImageGenerationModel(nextConfig);
            ConfigStorage.set('tools.imageGenerationModel', nextConfig).catch(() => {});
            syncImageGenerationModel(nextConfig);
          } else {
            setImageGenerationModel(saved);
          }
        } else {
          // Default: switch on, hardcoded model
          const defaultConfig = { useModel: DEFAULT_IMAGE_GENERATION_MODEL, switch: true } as IConfigStorageRefer['tools.imageGenerationModel'];
          setImageGenerationModel(defaultConfig);
          ConfigStorage.set('tools.imageGenerationModel', defaultConfig).catch(() => {});
          syncImageGenerationModel(defaultConfig);
        }
      } catch (error) {
        console.error('Failed to load image generation model config:', error);
      }
    };

    void loadConfigs();
  }, [syncImageGenerationModel]);

  const handleImageGenerationModelChange = (value: Partial<IConfigStorageRefer['tools.imageGenerationModel']>) => {
    setImageGenerationModel((prev) => {
      const newImageGenerationModel = { ...prev, ...value };
      ConfigStorage.set('tools.imageGenerationModel', newImageGenerationModel).catch((error) => {
        console.error('Failed to update image generation model config:', error);
      });
      syncImageGenerationModel(newImageGenerationModel);
      return newImageGenerationModel;
    });
  };

  const viewMode = useSettingsViewMode();
  const isPageMode = viewMode === 'page';

  return (
    <div className='flex flex-col h-full w-full'>
      {mcpMessageContext}

      {/* Content Area */}
      <AionScrollArea className='flex-1 min-h-0 pb-16px' disableOverflow={isPageMode}>
        <div className='space-y-16px'>
          {/* MCP 工具配置 */}
          <div className='px-[12px] md:px-[32px] py-[24px] bg-2 rd-12px md:rd-16px flex flex-col min-h-0 border border-border-2'>
            <div className='flex-1 min-h-0'>
              <AionScrollArea className={classNames('h-full', isPageMode && 'overflow-visible')} disableOverflow={isPageMode}>
                <ModalMcpManagementSection message={mcpMessage} isPageMode={isPageMode} />
              </AionScrollArea>
            </div>
          </div>
          {/* 图像生成 */}
          <div className='px-[12px] md:px-[32px] py-[24px] bg-2 rd-12px md:rd-16px border border-border-2'>
            <div className='flex items-center justify-between mb-16px'>
              <span className='text-14px text-t-primary'>{t('settings.imageGeneration')}</span>
              <Switch checked={imageGenerationModel?.switch} onChange={(checked) => handleImageGenerationModelChange({ switch: checked })} />
            </div>

            <Divider className='mt-0px mb-20px' />

            <Form layout='horizontal' labelAlign='left' className='space-y-12px'>
              <Form.Item label={t('settings.imageGenerationModel')}>
                <AionSelect
                  value={imageGenerationModel?.useModel || DEFAULT_IMAGE_GENERATION_MODEL}
                  disabled={!imageGenerationModel?.switch}
                  onChange={(val) => {
                    handleImageGenerationModelChange({ useModel: val as string });
                  }}
                  options={IMAGE_GENERATION_MODEL_OPTIONS}
                  style={{ minWidth: 260 }}
                />
              </Form.Item>
            </Form>
          </div>
        </div>
      </AionScrollArea>
    </div>
  );
};

export default ToolsModalContent;
