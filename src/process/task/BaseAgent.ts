/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '../../common';
import type { IConfirmation } from '../../common/chatLib';

type AgentType = 'acp' | 'openclaw-gateway' | 'remote-agent';

/**
 * Base class for agent runtime instances (ACP and OpenClaw).
 * Each conversation has one agent that owns its transport connection.
 */
class BaseAgent<Data, ConfirmationOption extends any = any> {
  type: AgentType;
  protected conversation_id: string;
  protected confirmations: Array<IConfirmation<ConfirmationOption>> = [];
  status: 'pending' | 'running' | 'finished' | 'idle' | undefined;

  /**
   * Whether this agent is in yolo mode (auto-approve)
   */
  protected yoloMode: boolean = false;

  constructor(type: AgentType, data: Data) {
    this.type = type;

    // Set yoloMode from data if present
    if (data && typeof data === 'object' && 'yoloMode' in data) {
      this.yoloMode = !!(data as any).yoloMode;
    }
  }

  protected addConfirmation(data: IConfirmation<ConfirmationOption>) {
    // If yoloMode is active, attempt to auto-confirm instead of adding
    if (this.yoloMode && data.options && data.options.length > 0) {
      // Select the first "allow" option (usually proceed_once or similar)
      // Most agents put the positive confirmation as the first option
      const autoOption = data.options[0];

      // Delay slightly to allow the agent to reach a stable state if needed
      setTimeout(() => {
        void this.confirm(data.id, data.callId, autoOption.value);
      }, 50);
      return;
    }

    const originIndex = this.confirmations.findIndex((p) => p.id === data.id);
    if (originIndex !== -1) {
      this.confirmations = this.confirmations.map((item, i) => (i === originIndex ? { ...item, ...data } : item));
      ipcBridge.conversation.confirmation.update.emit({ ...data, conversation_id: this.conversation_id });
      return;
    }
    this.confirmations = [...this.confirmations, data];
    ipcBridge.conversation.confirmation.add.emit({ ...data, conversation_id: this.conversation_id });
  }
  confirm(_msg_id: string, callId: string, _data: ConfirmationOption) {
    // 查找要移除的确认项（根据 callId 匹配）
    // Find the confirmation to remove (match by callId)
    const confirmationToRemove = this.confirmations.find((p) => p.callId === callId);

    // 从缓存中移除
    // Remove from cache
    this.confirmations = this.confirmations.filter((p) => p.callId !== callId);

    // 通知前端移除确认项
    // Notify frontend to remove the confirmation
    if (confirmationToRemove) {
      ipcBridge.conversation.confirmation.remove.emit({
        conversation_id: this.conversation_id,
        id: confirmationToRemove.id,
      });
    }
  }
  getConfirmations() {
    return this.confirmations;
  }

  /**
   * Send a message to the agent. Subclasses must implement.
   */
  sendMessage(_data: any): Promise<any> {
    return Promise.reject(new Error('sendMessage not implemented'));
  }

  /**
   * Stop the current streaming response. Subclasses must implement.
   */
  stop(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Kill the agent and clean up resources. Subclasses should override.
   */
  kill(): void {
    // Base implementation is a no-op; subclasses handle cleanup.
  }

  /**
   * Ensure yoloMode (auto-approve) is enabled for this agent.
   * Used by CronService to enable yoloMode on existing agents without killing them.
   * Returns true if yoloMode is already active or was successfully enabled.
   * Subclasses should override to implement agent-specific yoloMode logic.
   */
  async ensureYoloMode(): Promise<boolean> {
    return false;
  }
}

export default BaseAgent;
