import { Message } from '@arco-design/web-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { acpConversation, mcpService } from '@/common/ipcBridge';
import { ConfigStorage } from '@/common/storage';
import type { IMcpServer } from '@/common/storage';
import type { IMcpOperationResponse, IMcpOperationResult } from '../types';
import { truncateErrorMessage } from '../utils';
import { globalMessageQueue } from '../utils/messageQueue';

/**
 * MCP操作管理Hook
 * 处理MCP服务器与agents之间的同步和移除操作
 */
export const useMcpOperations = () => {
  const { t } = useTranslation();

  // 处理MCP配置同步到agents的结果
  const handleMcpOperationResult = useCallback(
    async (response: IMcpOperationResponse, operation: 'sync' | 'remove', successMessage?: string, skipRecheck = false) => {
      if (response.success && response.data) {
        const { results } = response.data;
        const failedAgents = results.filter((r: IMcpOperationResult) => !r.success);

        // 立即显示操作开始的消息，然后触发状态更新
        if (failedAgents.length > 0) {
          const failedNames = failedAgents.map((r: IMcpOperationResult) => `${r.agent}: ${truncateErrorMessage(r.error || '')}`).join(', ');
          const truncatedErrors = truncateErrorMessage(failedNames, 200);
          const partialFailedMessage = operation === 'sync' ? t('settings.mcpSyncPartialFailed', { errors: truncatedErrors, defaultValue: 'MCP 配置同步部分失败：{{errors}}' }) : t('settings.mcpRemovePartialFailed', { errors: truncatedErrors, defaultValue: 'MCP 配置移除部分失败：{{errors}}' });
          await globalMessageQueue.add(() => {
            Message.warning({ content: partialFailedMessage, duration: 6000 });
          });
        } else {
          const msg = successMessage ?? (operation === 'sync' ? t('settings.mcpSyncSuccess', 'MCP 配置已同步') : t('settings.mcpRemoveSuccess', 'MCP 配置已移除'));
          await globalMessageQueue.add(() => {
            Message.success(msg);
          });
        }

        // 然后更新UI状态
        if (!skipRecheck) {
          void ConfigStorage.get('mcp.config')
            .then((latestServers) => {
              if (latestServers) {
                // 这里可以触发状态检查，但需要在使用的地方提供回调
              }
            })
            .catch(() => {
              // Handle loading error silently
            });
        }
      } else {
        const errorMsg = truncateErrorMessage(response.msg || t('settings.unknownError', '未知错误'));
        const failedMessage = operation === 'sync' ? t('settings.mcpSyncFailed', { error: errorMsg, defaultValue: 'MCP 配置同步失败：{{error}}' }) : t('settings.mcpRemoveFailed', { error: errorMsg, defaultValue: 'MCP 配置移除失败：{{error}}' });
        await globalMessageQueue.add(() => {
          Message.error({ content: failedMessage, duration: 6000 });
        });
      }
    },
    [t]
  );

  // 从agents中删除MCP配置
  const removeMcpFromAgents = useCallback(
    async (serverName: string, successMessage?: string, transportType?: string) => {
      const agentsResponse = await acpConversation.getAvailableAgents.invoke();
      if (agentsResponse.success && agentsResponse.data) {
        // Filter agents by transport type support if transport type is known
        const compatibleCount = transportType ? agentsResponse.data.filter((a) => a.supportedTransports?.includes(transportType)).length : agentsResponse.data.length;

        // 显示开始移除的消息（通过队列）
        await globalMessageQueue.add(() => {
          Message.info(t('settings.mcpRemoveStarted', { count: compatibleCount, defaultValue: '正在从 {{count}} 个智能体中移除 MCP 配置...' }));
        });

        const removeResponse = await mcpService.removeMcpFromAgents.invoke({
          mcpServerName: serverName,
          agents: agentsResponse.data,
        });
        await handleMcpOperationResult(removeResponse, 'remove', successMessage, true); // 跳过重新检测
      }
    },
    [t, handleMcpOperationResult]
  );

  // 向agents同步MCP配置
  const syncMcpToAgents = useCallback(
    async (server: IMcpServer, skipRecheck = false) => {
      const agentsResponse = await acpConversation.getAvailableAgents.invoke();
      if (agentsResponse.success && agentsResponse.data) {
        // Filter agents by transport type support to show accurate count
        const compatibleCount = agentsResponse.data.filter((a) => a.supportedTransports?.includes(server.transport.type)).length;

        // 显示开始同步的消息（通过队列）
        await globalMessageQueue.add(() => {
          Message.info(t('settings.mcpSyncStarted', { count: compatibleCount, defaultValue: '正在将 MCP 配置添加到 {{count}} 个智能体...' }));
        });

        const syncResponse = await mcpService.syncMcpToAgents.invoke({
          mcpServers: [server],
          agents: agentsResponse.data,
        });

        await handleMcpOperationResult(syncResponse, 'sync', undefined, skipRecheck);
      } else {
        // 修复: 处理没有可用 agents 的情况，显示友好的错误提示
        // Fix: Handle case when no agents are available, show user-friendly error message
        console.error('[useMcpOperations] Failed to get available agents:', agentsResponse.msg);
        await globalMessageQueue.add(() => {
          Message.error(t('settings.mcpSyncFailedNoAgents', '未检测到可用的智能体，无法同步 MCP 配置'));
        });
      }
    },
    [t, handleMcpOperationResult]
  );

  return {
    syncMcpToAgents,
    removeMcpFromAgents,
    handleMcpOperationResult,
  };
};
