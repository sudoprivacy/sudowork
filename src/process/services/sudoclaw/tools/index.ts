/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SudoClaw Tools — Registration & Export
 *
 * Provides the three tools that the model can call when SudoClaw
 * persistent mode is active:
 *
 *  - **SleepTool**    — pause the tick loop for 1-60 minutes
 *  - **NotifyTool**   — fire-and-forget notification to all channels
 *  - **AskUserTool**  — blocking question; resolves on user response
 *
 * Usage (in SudoClawManager or agent runtime):
 * ```typescript
 * import { createSudoClawTools } from '@process/services/sudoclaw/tools';
 *
 * const tools = createSudoClawTools();
 * // Register `tools` in the agent's tool set
 * ```
 */

import { createSleepTool } from './SleepTool';
import { createNotifyTool } from './NotifyTool';
import { createAskUserTool } from './AskUserTool';
import type { SudoClawTool } from './types';

// Re-export factories for individual use
export { createSleepTool } from './SleepTool';
export { createNotifyTool } from './NotifyTool';
export { createAskUserTool } from './AskUserTool';
export { SUDOCLAW_NOTIFICATION_EVENT } from './NotifyTool';

// Re-export types
export type { ISudoClawManager, SudoClawSessionState, SudoClawTool, SudoClawToolSchema, SudoClawNotificationPayload, NotificationUrgency, SleepToolInput, SleepToolResult, NotifyToolInput, NotifyToolResult, AskUserToolInput, AskUserToolResult } from './types';

/**
 * Create all SudoClaw tools.
 *
 * Returns an array of tool definitions ready to be injected into
 * the agent's tool set when SudoClaw persistent mode activates.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createSudoClawTools(): SudoClawTool<any, any>[] {
  return [createSleepTool(), createNotifyTool(), createAskUserTool()];
}

/**
 * Create a name-keyed map of all SudoClaw tools for fast lookup.
 *
 * Useful when the agent runtime dispatches a tool call by name.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createSudoClawToolMap(): Map<string, SudoClawTool<any, any>> {
  const tools = createSudoClawTools();
  return new Map(tools.map((t) => [t.name, t]));
}
