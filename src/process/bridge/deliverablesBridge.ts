/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { ipcBridge } from '@/common';
import { deliverablesService } from '@process/services/deliverables/DeliverablesService';
import { mainError } from '@process/utils/mainLogger';

/**
 * IPC bridge for AI-generated deliverables aggregated per conversation.
 * The `list` provider scans persisted messages; the `changed` emitter is
 * fired from AcpAgent (and any future Codex / RemoteAgent integrations)
 * each time a new turn surfaces deliverables.
 */
export function initDeliverablesBridge(): void {
  ipcBridge.deliverables.list.provider(async ({ conversationId }) => {
    try {
      const files = deliverablesService.listForConversation(conversationId);
      return { success: true, data: files };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      mainError('DeliverablesBridge', `list failed: ${msg}`);
      return { success: false, msg };
    }
  });
}
