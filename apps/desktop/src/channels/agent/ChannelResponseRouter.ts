/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@sudowork/common/storage';
import { mainLog, mainWarn } from '@process/utils/mainLogger';
import { getChannelManager } from '../core/ChannelManager';
import { channelEventBus } from './ChannelEventBus';

/** Channel source types that need response routing */
export const CHANNEL_SOURCE_TYPES = new Set(['telegram', 'lark', 'dingtalk', 'wechat', 'wecom']);

/**
 * Sets up channel response routing for a conversation.
 * When the agent emits messages, this router sends them back to the original external channel.
 * Returns a cleanup function to unsubscribe.
 */
export function setupChannelResponseRouting(conversation: TChatConversation): () => void {
  const conversation_id = conversation.id;
  const channelSource = conversation.source;
  const channelChatId = conversation.channelChatId;

  mainLog('ChannelResponseRouter', `Called setupChannelResponseRouting: source=${channelSource}, chatId=${channelChatId}, convId=${conversation_id}`);

  if (!channelSource || !CHANNEL_SOURCE_TYPES.has(channelSource) || !channelChatId) {
    mainLog('ChannelResponseRouter', `Routing skipped: source mismatch or no chatId`);
    return () => {};
  }

  mainLog('ChannelResponseRouter', `Setting up channel response routing for ${channelSource}, chatId=${channelChatId}, convId=${conversation_id}`);

  // For WeChat and WeCom: accumulate text and send once at finish
  // WeChat: no edit support
  // WeCom: proactive push (aibot_send_msg) only supports non-streaming markdown
  // DingTalk: createAndDeliverAICard creates card without content; only editMessage sets it,
  // but ChannelResponseRouter doesn't call editMessage, so each sendMessage creates an empty card.
  const shouldAccumulate = channelSource === 'wechat' || channelSource === 'wecom' || channelSource === 'dingtalk';
  let accumulatedText = '';
  const pendingFiles: Array<{ type: 'image' | 'file'; url: string; fileName?: string }> = [];

  // Subscribe to agent messages for this conversation
  const cleanup = channelEventBus.onAgentMessage((event) => {
    if (event.conversation_id !== conversation_id) return;

    // Route content messages back to channel
    if (event.type === 'content' || event.type === 'file_send') {
      mainLog('ChannelResponseRouter', `Channel route: received ${event.type} for ${channelSource}`);

      // For WeChat/WeCom: accumulate content, send at finish
      if (shouldAccumulate) {
        if (event.type === 'content' && typeof event.data === 'string') {
          accumulatedText += event.data;
        } else if (event.type === 'file_send') {
          const { filePath, fileName, fileType } = event.data as { filePath?: string; fileName?: string; fileType?: string };
          if (fileType === 'image' && filePath) {
            pendingFiles.push({ type: 'image', url: filePath });
          } else if (filePath && fileName) {
            pendingFiles.push({ type: 'file', url: filePath, fileName });
          }
        }
      } else {
        // For other channels (lark, dingtalk, telegram, wecom): send immediately
        void (async () => {
          try {
            const channelManager = getChannelManager();
            const pluginManager = channelManager.getPluginManager();
            if (!pluginManager) {
              mainWarn('ChannelResponseRouter', 'PluginManager not available for channel routing');
              return;
            }
            const plugins = pluginManager.getAllPlugins();
            const plugin = plugins.find((p) => p.type === channelSource);
            if (!plugin) {
              mainWarn('ChannelResponseRouter', `Plugin not found for ${channelSource}`);
              return;
            }

            if (event.type === 'file_send') {
              const { filePath, fileName, fileType } = event.data as { filePath?: string; fileName?: string; fileType?: string };
              if (fileType === 'image' && filePath) {
                await plugin.sendMessage(channelChatId, { type: 'image', imageUrl: filePath });
              } else if (filePath && fileName) {
                await plugin.sendMessage(channelChatId, { type: 'file', fileUrl: filePath, fileName });
              }
            } else if (event.type === 'content' && typeof event.data === 'string') {
              await plugin.sendMessage(channelChatId, { type: 'text', text: event.data, parseMode: 'HTML' });
            }
          } catch (err) {
            mainWarn('ChannelResponseRouter', 'Failed to route message to channel:', err);
          }
        })();
      }
    }

    // For WeChat/WeCom: send accumulated content on finish
    if (event.type === 'finish' && shouldAccumulate) {
      mainLog('ChannelResponseRouter', `Channel route (${channelSource}): finish event, sending accumulated content`);
      void (async () => {
        try {
          const channelManager = getChannelManager();
          const pluginManager = channelManager.getPluginManager();
          if (!pluginManager) {
            mainWarn('ChannelResponseRouter', 'PluginManager not available for channel routing');
            return;
          }
          const plugins = pluginManager.getAllPlugins();
          const plugin = plugins.find((p) => p.type === channelSource);
          if (!plugin) {
            mainWarn('ChannelResponseRouter', `Plugin not found for ${channelSource}`);
            return;
          }

          // Send accumulated text first
          if (accumulatedText.trim()) {
            mainLog('ChannelResponseRouter', `Channel route (${channelSource}): sending text (${accumulatedText.length} chars)`);
            const msgId = await plugin.sendMessage(channelChatId, { type: 'text', text: accumulatedText.trim(), parseMode: 'HTML' });
            // DingTalk AI Card: finalize to remove loading indicator
            // Strip local image markdown from text to prevent editMessage from re-extracting and re-sending images
            if (channelSource === 'dingtalk' && msgId) {
              const cleanForEdit = accumulatedText
                .trim()
                .replace(/!\[[^\]]*\]\(([^)]+)\)/g, (match, imgPath: string) => {
                  if (/^(https?:|data:|file:)/i.test(imgPath)) return match;
                  return '';
                })
                .replace(/\n{3,}/g, '\n\n')
                .trim();
              await plugin.editMessage(channelChatId, msgId, { type: 'text', text: cleanForEdit, parseMode: 'HTML', replyMarkup: {} as any });
            }
          }

          // Send pending files after text
          for (const file of pendingFiles) {
            if (file.type === 'image') {
              await plugin.sendMessage(channelChatId, { type: 'image', imageUrl: file.url });
            } else {
              await plugin.sendMessage(channelChatId, { type: 'file', fileUrl: file.url, fileName: file.fileName });
            }
          }
        } catch (err) {
          mainWarn('ChannelResponseRouter', 'Failed to route accumulated content to WeChat:', err);
        }
      })();
    }

    // Auto cleanup on finish
    if (event.type === 'finish') {
      mainLog('ChannelResponseRouter', `Channel route: finish event, cleaning up listener`);
      cleanup();
    }
  });

  return cleanup;
}
