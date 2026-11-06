/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentActivityState, IExtensionAgentActivityEvent, IExtensionAgentActivityItem, IExtensionAgentActivitySnapshot } from '@sudowork/host-bridge/ipcBridge';
import type { TMessage } from '@sudowork/common/chatLib';
import type { TChatConversation } from '@sudowork/common/storage';
import type { IAcpRuntimeObservation } from '@sudowork/common/acpRuntimeStatus';
import { ipcBridge } from '@/common';
import { ExtensionRegistry } from '@/extensions';
import { getDatabase } from '@process/database';
import { mainError } from '@process/utils/mainLogger';
import WorkerManage from '../WorkerManage';

let activitySnapshotInFlight: Promise<IExtensionAgentActivitySnapshot> | null = null;

const mapObservationToState = (observation: IAcpRuntimeObservation): AgentActivityState => {
  const snapshot = observation.snapshot;
  if (observation.availability !== 'available' || observation.expiresAt <= Date.now() || !snapshot) return 'unknown';
  if (snapshot.foreground.state === 'awaiting_input') return 'awaiting_input';
  if (snapshot.foreground.state === 'running' || snapshot.background.terminals > 0 || snapshot.background.agents > 0 || snapshot.background.tool_operations > 0) return 'executing';
  return snapshot.background.execution_unconfirmed > 0 ? 'unknown' : 'idle';
};

const resolveAgentIdentity = (conversation: TChatConversation): { backend: string; agentName: string } => {
  if (conversation.type === 'acp') {
    const backend = String(conversation.extra?.backend || 'acp');
    const agentName = String(conversation.extra?.agentName || backend);
    return { backend, agentName };
  }
  return { backend: 'unknown', agentName: 'Unknown' };
};

const toEventText = (message: TMessage): { kind: 'status' | 'tool' | 'message'; text: string; at: number } | null => {
  const at = Number(message.createdAt || Date.now());
  if (message.type === 'agent_status') {
    const content = (message.content || {}) as { status?: string };
    return { kind: 'status', text: `状态: ${String(content.status || 'unknown')}`, at };
  }

  if (message.type === 'tool_call' || message.type === 'acp_tool_call' || message.type === 'codex_tool_call' || message.type === 'tool_group') {
    return { kind: 'tool', text: '工具执行中', at };
  }

  if (message.type === 'text' && message.position === 'left') {
    const content = message.content as { content?: string };
    const text = String(content?.content || '').trim();
    if (!text) return null;
    return { kind: 'message', text: text.slice(0, 80), at };
  }

  return null;
};

const buildActivitySnapshot = async (): Promise<IExtensionAgentActivitySnapshot> => {
  const db = getDatabase();
  const conversations = db.getUserConversations(undefined, 0, 10000).data.filter((conv) => !conv.extra?.isHealthCheck && !(conv.extra as Record<string, unknown> | undefined)?.isTeamMember);

  const agents = await Promise.all(
    conversations.map(async (conversation): Promise<IExtensionAgentActivityItem> => {
      const { backend, agentName } = resolveAgentIdentity(conversation);
      const task = WorkerManage.getTaskById(conversation.id);
      let runtimeObservation: IAcpRuntimeObservation = { scope: 'owned-acp-connection', observedAt: Date.now(), expiresAt: Date.now(), availability: 'unattached' };
      if (task) {
        try {
          runtimeObservation = await task.getRuntimeObservation();
          if (WorkerManage.getTaskById(conversation.id) !== task) runtimeObservation = { ...runtimeObservation, availability: 'changed', snapshot: undefined };
        } catch {
          runtimeObservation.availability = 'unreachable';
        }
      }

      const recentMessages = db.getConversationMessages(conversation.id, 0, 20, 'DESC').data;
      const events = recentMessages
        .map((m) => toEventText(m))
        .filter((e): e is { kind: 'status' | 'tool' | 'message'; text: string; at: number } => Boolean(e))
        .slice(0, 6)
        .map((e): IExtensionAgentActivityEvent => ({
          conversationId: conversation.id,
          kind: e.kind,
          text: e.text,
          at: e.at,
        }));

      const lastStatus = recentMessages.find((m) => m.type === 'agent_status')?.content as { status?: string } | undefined;
      const state = mapObservationToState(runtimeObservation);
      const runtimeStatus = state === 'awaiting_input' ? 'pending' : state === 'executing' ? 'running' : state === 'idle' ? 'finished' : 'unknown';
      const latestEventAt = events[0]?.at || conversation.modifyTime || Date.now();

      return {
        id: `${conversation.id}::${runtimeObservation.instanceId || 'unattached'}`,
        backend,
        agentName,
        state,
        runtimeStatus,
        runtimeObservation,
        conversations: 1,
        activeConversations: runtimeStatus === 'running' || runtimeStatus === 'pending' ? 1 : 0,
        lastActiveAt: latestEventAt,
        lastStatus: lastStatus?.status,
        currentTask: events[0]?.text,
        recentEvents: events,
      };
    })
  );

  return {
    scope: 'desktop-owned-connections',
    isComplete: false,
    generatedAt: Date.now(),
    totalConversations: conversations.length,
    runningConversations: agents.filter((agent) => agent.activeConversations > 0).length,
    agents: agents.sort((a, b) => b.lastActiveAt - a.lastActiveAt),
  };
};

const getActivitySnapshot = async (): Promise<IExtensionAgentActivitySnapshot> => {
  if (activitySnapshotInFlight) {
    return activitySnapshotInFlight;
  }

  activitySnapshotInFlight = Promise.resolve()
    .then(() => buildActivitySnapshot())
    .finally(() => {
      activitySnapshotInFlight = null;
    });

  return activitySnapshotInFlight;
};

/**
 * Initialize IPC bridge for extension system.
 * Provides extension-contributed themes (and future extension data) to the renderer process.
 */
export function initExtensionsBridge(): void {
  // Get all extension-contributed CSS themes (converted to ICssTheme format)
  ipcBridge.extensions.getThemes.provider(async () => {
    try {
      const registry = ExtensionRegistry.getInstance();
      return registry.getThemes();
    } catch (error) {
      mainError('Extensions', 'Failed to get themes:', error);
      return [];
    }
  });

  // Get summary of all loaded extensions (with enabled/disabled status and permissions)
  ipcBridge.extensions.getLoadedExtensions.provider(async () => {
    try {
      const registry = ExtensionRegistry.getInstance();
      return registry.getLoadedExtensions().map((ext) => ({
        name: ext.manifest.name,
        displayName: ext.manifest.displayName,
        version: ext.manifest.version,
        description: ext.manifest.description,
        source: ext.source,
        directory: ext.directory,
        enabled: registry.isExtensionEnabled(ext.manifest.name),
        riskLevel: registry.getExtensionRiskLevel(ext.manifest.name),
        hasLifecycle: !!(ext.manifest as any).lifecycle,
      }));
    } catch (error) {
      mainError('Extensions', 'Failed to get loaded extensions:', error);
      return [];
    }
  });

  // Get all extension-contributed assistants
  ipcBridge.extensions.getAssistants.provider(async () => {
    try {
      const registry = ExtensionRegistry.getInstance();
      return registry.getAssistants();
    } catch (error) {
      mainError('Extensions', 'Failed to get assistants:', error);
      return [];
    }
  });

  // Get all extension-contributed ACP adapters
  ipcBridge.extensions.getAcpAdapters.provider(async () => {
    try {
      const registry = ExtensionRegistry.getInstance();
      return registry.getAcpAdapters();
    } catch (error) {
      mainError('Extensions', 'Failed to get ACP adapters:', error);
      return [];
    }
  });

  // Get all extension-contributed agents (autonomous agent presets)
  ipcBridge.extensions.getAgents.provider(async () => {
    try {
      const registry = ExtensionRegistry.getInstance();
      return registry.getAgents();
    } catch (error) {
      mainError('Extensions', 'Failed to get agents:', error);
      return [];
    }
  });

  // Get all extension-contributed MCP servers
  ipcBridge.extensions.getMcpServers.provider(async () => {
    try {
      const registry = ExtensionRegistry.getInstance();
      return registry.getMcpServers();
    } catch (error) {
      mainError('Extensions', 'Failed to get MCP servers:', error);
      return [];
    }
  });

  // Get all extension-contributed skills
  ipcBridge.extensions.getSkills.provider(async () => {
    try {
      const registry = ExtensionRegistry.getInstance();
      return registry.getSkills();
    } catch (error) {
      mainError('Extensions', 'Failed to get skills:', error);
      return [];
    }
  });

  // Get all extension-contributed settings tabs
  ipcBridge.extensions.getSettingsTabs.provider(async () => {
    try {
      const registry = ExtensionRegistry.getInstance();
      return registry.getSettingsTabs();
    } catch (error) {
      mainError('Extensions', 'Failed to get settings tabs:', error);
      return [];
    }
  });

  // Get activity snapshot for extension settings tabs (e.g. Star Office)
  ipcBridge.extensions.getAgentActivitySnapshot.provider(async () => {
    try {
      return await getActivitySnapshot();
    } catch (error) {
      mainError('Extensions', 'Failed to build agent activity snapshot:', error);
      return {
        scope: 'desktop-owned-connections',
        isComplete: false,
        generatedAt: Date.now(),
        totalConversations: 0,
        runningConversations: 0,
        agents: [],
      };
    }
  });

  // Get merged extension i18n translations for a specific locale
  ipcBridge.extensions.getExtI18nForLocale.provider(async ({ locale }) => {
    try {
      const registry = ExtensionRegistry.getInstance();
      return registry.getExtI18nForLocale(locale);
    } catch (error) {
      mainError('Extensions', 'Failed to get ext i18n for locale:', error);
      return {};
    }
  });

  // --- Extension Management API (NocoBase-inspired) ---

  // Enable an extension
  ipcBridge.extensions.enableExtension.provider(async ({ name }) => {
    try {
      const registry = ExtensionRegistry.getInstance();
      const success = await registry.enableExtension(name);
      if (success) {
        ipcBridge.extensions.stateChanged.emit({ name, enabled: true });
      }
      return { success, msg: success ? undefined : `Failed to enable "${name}"` };
    } catch (error) {
      mainError('Extensions', `Failed to enable "${name}":`, error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  // Disable an extension
  ipcBridge.extensions.disableExtension.provider(async ({ name, reason }) => {
    try {
      const registry = ExtensionRegistry.getInstance();
      const success = await registry.disableExtension(name, reason);
      if (success) {
        ipcBridge.extensions.stateChanged.emit({ name, enabled: false, reason });
      }
      return { success, msg: success ? undefined : `Failed to disable "${name}"` };
    } catch (error) {
      mainError('Extensions', `Failed to disable "${name}":`, error);
      return { success: false, msg: error instanceof Error ? error.message : String(error) };
    }
  });

  // Get permission summary for an extension (Figma-inspired)
  ipcBridge.extensions.getPermissions.provider(async ({ name }) => {
    try {
      const registry = ExtensionRegistry.getInstance();
      return registry.getExtensionPermissions(name);
    } catch (error) {
      mainError('Extensions', `Failed to get permissions for "${name}":`, error);
      return [];
    }
  });

  // Get risk level for an extension
  ipcBridge.extensions.getRiskLevel.provider(async ({ name }) => {
    try {
      const registry = ExtensionRegistry.getInstance();
      return registry.getExtensionRiskLevel(name);
    } catch (error) {
      mainError('Extensions', `Failed to get risk level for "${name}":`, error);
      return 'safe';
    }
  });
}
