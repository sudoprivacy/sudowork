/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Hook for detecting multi-agent mode on application startup
 *
 * @deprecated 仅用于弹出「已进入多智能体模式」toast，不含任何业务逻辑，
 * 调用入口已从 layout.tsx 移除。确认不再需要此提示后可整体删除本文件
 * 及各语言包中的 conversation.welcome.multiAgentModeEnabled key。
 */

import { Message } from '@arco-design/web-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { filterAvailableAgentsForUi } from '@/renderer/shared/agents/availableAgents';
import { ipcBridge } from '@/common';

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
