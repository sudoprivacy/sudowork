/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { getDatabase } from '@/process/database';
import { ProcessConfig } from '@/process/initStorage';
import { defaultPluginId, pluginTypeFromId } from './types';
import type { PluginType } from './types';

/**
 * Per-connection agent / model settings.
 *
 * A channel type may have several connections (e.g. two WeCom bots), and each usually
 * wants its own agent — that is the point of running more than one. The settings used to
 * live in a single `assistant.<type>.agent` / `.defaultModel` config key, which is one
 * value per TYPE and therefore cannot distinguish connections.
 *
 * Rather than multiply those typed keys, a connection stores its own override inside its
 * plugin config row (already keyed by plugin id). Resolution order:
 *   1. the connection's own override, when set;
 *   2. the shared `assistant.<type>.*` key, which is what every existing install has.
 *
 * So an untouched install behaves exactly as before, and a second connection only diverges
 * once someone actually configures it differently.
 */

type ChannelAgentSetting = { backend: string; customAgentId?: string; name?: string };
type ChannelModelSetting = { id: string; useModel: string };

/** The shared per-type keys, kept as the fallback and for a type's first connection. */
const AGENT_KEYS: Record<string, 'assistant.telegram.agent' | 'assistant.lark.agent' | 'assistant.dingtalk.agent' | 'assistant.wechat.agent' | 'assistant.wecom.agent'> = {
  telegram: 'assistant.telegram.agent',
  lark: 'assistant.lark.agent',
  dingtalk: 'assistant.dingtalk.agent',
  wechat: 'assistant.wechat.agent',
  wecom: 'assistant.wecom.agent',
};

const MODEL_KEYS: Record<string, 'assistant.telegram.defaultModel' | 'assistant.lark.defaultModel' | 'assistant.dingtalk.defaultModel' | 'assistant.wechat.defaultModel' | 'assistant.wecom.defaultModel'> = {
  telegram: 'assistant.telegram.defaultModel',
  lark: 'assistant.lark.defaultModel',
  dingtalk: 'assistant.dingtalk.defaultModel',
  wechat: 'assistant.wechat.defaultModel',
  wecom: 'assistant.wecom.defaultModel',
};

/** Read the stored config blob for one connection. Never throws. */
function readPluginConfig(pluginId: string): Record<string, unknown> {
  try {
    const result = getDatabase().getChannelPlugin(pluginId);
    const config = result.success ? result.data?.config : undefined;
    return config && typeof config === 'object' ? (config as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Persist a partial config patch onto one connection, preserving the rest. */
async function writePluginConfig(pluginId: string, patch: Record<string, unknown>): Promise<void> {
  const db = getDatabase();
  const result = db.getChannelPlugin(pluginId);
  const plugin = result.success ? result.data : null;
  if (!plugin) return;
  db.upsertChannelPlugin({
    ...plugin,
    config: { ...(plugin.config as Record<string, unknown> | undefined), ...patch } as never,
  });
}

/**
 * Agent this connection should start new chats with, falling back to the type-wide setting.
 */
export async function getConnectionAgent(pluginId: string | undefined, platform: PluginType): Promise<ChannelAgentSetting | undefined> {
  const type = pluginId ? pluginTypeFromId(pluginId) : platform;
  const id = pluginId || defaultPluginId(platform);

  const own = readPluginConfig(id).agent;
  if (own && typeof own === 'object') return own as ChannelAgentSetting;

  const key = AGENT_KEYS[type];
  if (!key) return undefined;
  try {
    return (await ProcessConfig.get(key)) as ChannelAgentSetting | undefined;
  } catch {
    return undefined;
  }
}

/** Default model for this connection, falling back to the type-wide setting. */
export async function getConnectionModel(pluginId: string | undefined, platform: PluginType): Promise<ChannelModelSetting | undefined> {
  const type = pluginId ? pluginTypeFromId(pluginId) : platform;
  const id = pluginId || defaultPluginId(platform);

  const own = readPluginConfig(id).defaultModel;
  if (own && typeof own === 'object') return own as ChannelModelSetting;

  const key = MODEL_KEYS[type];
  if (!key) return undefined;
  try {
    return (await ProcessConfig.get(key)) as ChannelModelSetting | undefined;
  } catch {
    return undefined;
  }
}

/**
 * Bind an agent to ONE connection.
 *
 * Writing to the type's first connection also updates the shared key, so the existing
 * settings UI (which reads that key) stays in sync for the common single-connection case.
 */
export async function setConnectionAgent(pluginId: string, agent: ChannelAgentSetting | null): Promise<void> {
  const type = pluginTypeFromId(pluginId);
  await writePluginConfig(pluginId, { agent: agent ?? undefined });
  if (pluginId === defaultPluginId(type)) {
    const key = AGENT_KEYS[type];
    if (key && agent) {
      try {
        await ProcessConfig.set(key, agent as never);
      } catch {
        // best-effort mirror; the per-connection value above is authoritative
      }
    }
  }
}

/** Set the default model for ONE connection; mirrors to the shared key for the first one. */
export async function setConnectionModel(pluginId: string, model: ChannelModelSetting | null): Promise<void> {
  const type = pluginTypeFromId(pluginId);
  await writePluginConfig(pluginId, { defaultModel: model ?? undefined });
  if (pluginId === defaultPluginId(type)) {
    const key = MODEL_KEYS[type];
    if (key && model) {
      try {
        await ProcessConfig.set(key, model as never);
      } catch {
        // best-effort mirror
      }
    }
  }
}
