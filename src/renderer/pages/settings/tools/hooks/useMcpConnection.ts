import { Message } from '@arco-design/web-react';
import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { mcpService } from '@/common/ipcBridge';
import type { IMcpServer } from '@/common/storage';
import { truncateErrorMessage } from '../utils';
import { globalMessageQueue } from '../utils/messageQueue';

/**
 * MCP连接测试管理Hook
 * 处理MCP服务器的连接测试和状态更新
 */
export const useMcpConnection = (mcpServers: IMcpServer[], saveMcpServers: (serversOrUpdater: IMcpServer[] | ((prev: IMcpServer[]) => IMcpServer[])) => Promise<void>, onAuthRequired?: (server: IMcpServer) => void) => {
  const { t } = useTranslation();
  const [testingServers, setTestingServers] = useState<Record<string, boolean>>({});

  // 连接测试函数
  const handleTestMcpConnection = useCallback(
    async (server: IMcpServer) => {
      setTestingServers((prev) => ({ ...prev, [server.id]: true }));

      // 更新服务器状态 - 使用统一的保存函数，避免竞态条件
      const updateServerStatus = async (status: IMcpServer['status'], additionalData?: Partial<IMcpServer>) => {
        try {
          await saveMcpServers((prevServers) => prevServers.map((s) => (s.id === server.id ? { ...s, status, updatedAt: Date.now(), ...additionalData } : s)));
        } catch (error) {
          console.error('Failed to update server status:', error);
        }
      };

      await updateServerStatus('testing');

      try {
        const response = await mcpService.testMcpConnection.invoke(server);

        if (response.success && response.data) {
          const result = response.data;

          // 检查是否需要认证
          if (result.needsAuth) {
            await updateServerStatus('disconnected');
            await globalMessageQueue.add(() => {
              Message.warning(`${server.name}: ${t('settings.mcpAuthRequired', '需要身份验证')}`);
            });

            // 触发认证回调
            if (onAuthRequired) {
              onAuthRequired(server);
            }
            return;
          }

          if (result.success) {
            // 更新服务器状态为已连接，并保存获取到的工具信息
            // 连接成功时不修改 enabled 字段，让用户决定是否安装
            await updateServerStatus('connected', {
              tools: result.tools?.map((tool) => ({ name: tool.name, description: tool.description })),
              lastConnected: Date.now(),
            });
            await globalMessageQueue.add(() => {
              Message.success(`${server.name}: ${t('settings.mcpTestConnectionSuccess', '连接测试成功')}`);
            });

            // 连接测试成功，不执行额外操作
          } else {
            // 更新服务器状态为错误，并禁用安装
            // 连接失败时自动设置 enabled=false，避免安装失败的服务
            await updateServerStatus('error', {
              enabled: false,
            });
            const errorMsg = truncateErrorMessage(result.error || t('settings.mcpError', '错误'));
            await globalMessageQueue.add(() => {
              Message.error({ content: `${server.name}: ${errorMsg}`, duration: 5000 });
            });
          }
        } else {
          // IPC调用失败，禁用安装
          await updateServerStatus('error', {
            enabled: false,
          });
          const errorMsg = truncateErrorMessage(response.msg || t('settings.mcpError', '错误'));
          await globalMessageQueue.add(() => {
            Message.error({ content: `${server.name}: ${errorMsg}`, duration: 5000 });
          });
        }
      } catch (error) {
        // 更新服务器状态为错误，禁用安装
        await updateServerStatus('error', {
          enabled: false,
        });
        const errorMsg = truncateErrorMessage(error instanceof Error ? error.message : t('settings.mcpError', '错误'));
        await globalMessageQueue.add(() => {
          Message.error({ content: `${server.name}: ${errorMsg}`, duration: 5000 });
        });
      } finally {
        setTestingServers((prev) => ({ ...prev, [server.id]: false }));
      }
    },
    [saveMcpServers, t, onAuthRequired]
  );

  return {
    testingServers,
    handleTestMcpConnection,
  };
};
