/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { storage } from '@office-ai/platform';
import type { IChatConversationRefer, IConfigStorageRefer, IEnvStorageRefer } from '@sudowork/common/storageTypes';

// The pure storage/config/model/MCP type surface (TChatConversation, IProvider,
// IMcpServer, TProviderWithModel, ICssTheme, …) and the default-model consts now
// live in @sudowork/common so the renderer and a future shared renderer package
// can consume them without pulling in the transport-coupled storage runtime.
// Re-exported here so every existing `@/common/storage` import keeps resolving.
// Only the @office-ai/platform-backed storage instances below stay app-side.
export * from '@sudowork/common/storageTypes';

/**
 * @description 聊天相关的存储
 */
export const ChatStorage = storage.buildStorage<IChatConversationRefer>('agent.chat');

// 聊天消息存储
export const ChatMessageStorage = storage.buildStorage('agent.chat.message');

// 系统配置存储
export const ConfigStorage = storage.buildStorage<IConfigStorageRefer>('agent.config');

// 系统环境变量存储
export const EnvStorage = storage.buildStorage<IEnvStorageRefer>('agent.env');
