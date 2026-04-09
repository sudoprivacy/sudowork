/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * MemoryAppendTool — Tool the model calls to save memories
 *
 * When SudoClaw is active, this tool is exposed to the model so it can
 * persist important context, decisions, user preferences, or anything
 * worth recalling in future conversations.
 *
 * Schema: { entry: string }
 */

import { append } from '../MemoryLog';
import { mainLog, mainError } from '@process/utils/mainLogger';

/**
 * Tool definition for the model (follows standard tool-use schema)
 */
export const MEMORY_APPEND_TOOL_NAME = 'memory_append';

export const memoryAppendToolDefinition = {
  name: MEMORY_APPEND_TOOL_NAME,
  description: 'Save a memory entry to your daily log. Use this to remember important context, ' + 'decisions, user preferences, task outcomes, or anything worth recalling in future ' + 'conversations. Each entry is timestamped and stored permanently.',
  parameters: {
    type: 'object' as const,
    properties: {
      entry: {
        type: 'string' as const,
        description: 'The memory entry to save. Should be a concise, self-contained note.',
      },
    },
    required: ['entry'],
  },
};

/**
 * Result returned from the memory append tool handler
 */
export type MemoryAppendResult = {
  success: boolean;
  message: string;
};

/**
 * Handle a memory_append tool call from the model.
 *
 * @param args - Tool arguments: `{ entry: string }`
 * @returns Result indicating success or failure
 */
export function handleMemoryAppend(args: { entry: string }): MemoryAppendResult {
  if (!args.entry || typeof args.entry !== 'string') {
    return {
      success: false,
      message: 'Invalid entry: must be a non-empty string.',
    };
  }

  const trimmed = args.entry.trim();
  if (trimmed.length === 0) {
    return {
      success: false,
      message: 'Invalid entry: must not be empty after trimming.',
    };
  }

  try {
    append(trimmed);
    mainLog('MemoryAppendTool', 'Memory saved successfully');
    return {
      success: true,
      message: 'Memory saved.',
    };
  } catch (error) {
    mainError('MemoryAppendTool', 'Failed to save memory:', error);
    return {
      success: false,
      message: 'Failed to save memory. The entry was not persisted.',
    };
  }
}
