/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Hook for detecting multi-agent mode on application startup
 */

import { Message } from '@arco-design/web-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import { filterAvailableAgentsForUi } from '@renderer/shared/agents/availableAgents';

export const useMultiAgentDetection = () => {
  const { t } = useTranslation();

  useEffect(() => {
    const checkMultiAgentMode = async () => {
      try {
        const response = await ipcBridge.acpConversation.getAvailableAgents.invoke();
        if (response && response.success && response.data) {
          const acpAgents = filterAvailableAgentsForUi(response.data);
          if (acpAgents.length > 1) {
            Message.success(t('conversation.welcome.multiAgentModeEnabled'));
          }
        }
      } catch (error) {
        // 静默处理错误，避免影响应用启动
        console.log('Multi-agent detection failed:', error);
      }
    };

    checkMultiAgentMode().catch((error) => {
      console.error('Multi-agent detection failed:', error);
    });
  }, [t]); // 空依赖数组确保只在组件初始化时执行一次
};
