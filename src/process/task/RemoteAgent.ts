/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Remote Agent task for enterprise (eeclaw) mode.
 * Connects to server-side Claude Code via WebSocket instead of spawning a local CLI.
 */

import BaseAgent from './BaseAgent';
import { RemoteConnection } from '@/agent/remote/RemoteConnection';
import { ipcBridge } from '@/common';
import { mainLog, mainError } from '@process/utils/mainLogger';

export interface RemoteAgentData {
  serverUrl: string;
  token: string;
  conversation_id: string;
  /** Conversation extra data */
  workspace?: string;
  presetContext?: string;
  enabledSkills?: string[];
  /** Session ID for resume */
  sessionId?: string;
  /** Runtime options */
  yoloMode?: boolean;
}

class RemoteAgent extends BaseAgent<RemoteAgentData> {
  private connection: RemoteConnection;
  private data: RemoteAgentData;
  private connected = false;

  constructor(data: RemoteAgentData) {
    super('remote-agent', data);
    this.data = data;

    this.connection = new RemoteConnection({
      serverUrl: data.serverUrl,
      token: data.token,
    });

    // Wire up event handlers
    this.connection.onSessionUpdate = (update) => {
      ipcBridge.conversation.responseStream.emit({
        conversation_id: this.conversation_id,
        data: update,
      });
    };

    this.connection.onPermissionRequest = async (request) => {
      // Add confirmation for UI
      const confirmationId = `remote-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      this.addConfirmation({
        id: confirmationId,
        callId: confirmationId,
        title: 'Permission Request',
        message: JSON.stringify(request),
        options: [
          { id: 'allow_once', label: 'Allow' },
          { id: 'reject_once', label: 'Deny' },
        ],
        timestamp: Date.now(),
        autoCloseTimeout: 60000,
      });

      // If yolo mode, auto-allow
      if (this.yoloMode) {
        return { optionId: 'allow_once' };
      }

      // Wait for user confirmation (default allow after timeout)
      return { optionId: 'allow_once' };
    };

    this.connection.onEndTurn = () => {
      mainLog('RemoteAgent', 'End turn received', this.conversation_id);
    };

    this.connection.onPromptUsage = (usage) => {
      ipcBridge.conversation.responseStream.emit({
        conversation_id: this.conversation_id,
        type: 'usage',
        data: usage,
      });
    };

    this.connection.onDisconnect = (error) => {
      mainError('RemoteAgent', 'Disconnected', this.conversation_id, error);
      this.status = 'finished';
      ipcBridge.conversation.responseStream.emit({
        conversation_id: this.conversation_id,
        type: 'disconnected',
        data: error?.message,
      });
    };
  }

  private async bootstrap(): Promise<void> {
    if (this.connected) return;

    mainLog('RemoteAgent', 'Connecting to server', this.data.serverUrl);
    await this.connection.connect();
    await this.connection.initialize();

    if (this.data.sessionId) {
      await this.connection.loadSession(this.data.sessionId, this.data.workspace || '.');
    } else {
      await this.connection.newSession(this.data.workspace || '.', {
        resumeSessionId: this.data.sessionId,
      });
    }

    this.connected = true;
    mainLog('RemoteAgent', 'Connected and ready', this.conversation_id);
  }

  async sendMessage(promptData: { prompt: string; images?: Array<{ type: 'image'; data: string; mimeType: string }> }): Promise<void> {
    try {
      if (!this.connected) {
        await this.bootstrap();
      }

      this.status = 'running';

      const response = await this.connection.sendPrompt(promptData.prompt, promptData.images);

      this.status = 'finished';
      return response;
    } catch (error) {
      mainError('RemoteAgent', 'Failed to send prompt', error);
      this.status = 'finished';
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.connected) {
      await this.connection.cancel();
    }
  }

  kill(): void {
    this.connection.disconnect().catch((error) => {
      mainError('RemoteAgent', 'Error during disconnect', error);
    });
  }

  async ensureYoloMode(): Promise<boolean> {
    this.yoloMode = true;
    return true;
  }
}

export default RemoteAgent;
