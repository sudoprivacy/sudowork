/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ICronJob } from '@sudowork/host-bridge/ipcBridge';
import type { TChatConversation } from '@sudowork/common/storage';
import { getActivityTime, getTimelineLabel } from '@renderer/utils/timeline';
import { getWorkspaceDisplayName } from '@renderer/utils/workspace';
import { getWorkspaceUpdateTime } from '@renderer/utils/workspaceHistory';

import type { AgentGroup, ConversationItem, GroupedHistoryResult, ScheduledGroup, SidebarTabKey, TimelineItem, TimelineSection, WorkspaceGroup } from '../types';
import { getConversationSortOrder } from './sortOrderHelpers';

export const getConversationTimelineLabel = (conversation: ConversationItem, t: (key: string) => string): string => {
  const time = getActivityTime(conversation as TChatConversation);
  return getTimelineLabel(time, Date.now(), t);
};

export const isConversationPinned = (conversation: ConversationItem): boolean => {
  const extra = conversation.extra as { pinned?: boolean } | undefined;
  return Boolean(extra?.pinned);
};

export const getConversationPinnedAt = (conversation: ConversationItem): number => {
  const extra = conversation.extra as { pinnedAt?: number } | undefined;
  if (typeof extra?.pinnedAt === 'number') {
    return extra.pinnedAt;
  }
  return 0;
};

export const getConversationPinnedTab = (conversation: ConversationItem): SidebarTabKey | undefined => {
  const extra = conversation.extra as { pinnedTab?: SidebarTabKey } | undefined;
  return extra?.pinnedTab;
};

const compareConversationsByLatestActivity = (a: TChatConversation, b: TChatConversation): number => {
  const activityDiff = getActivityTime(b) - getActivityTime(a);
  if (activityDiff !== 0) return activityDiff;

  const createTimeDiff = (b.createTime || 0) - (a.createTime || 0);
  if (createTimeDiff !== 0) return createTimeDiff;

  return b.id.localeCompare(a.id);
};

const getCronConversationTime = (conversation: TChatConversation): number => conversation.createTime || getActivityTime(conversation);

const compareCronConversationsByCreatedTime = (a: TChatConversation, b: TChatConversation): number => {
  const createTimeDiff = getCronConversationTime(b) - getCronConversationTime(a);
  if (createTimeDiff !== 0) return createTimeDiff;

  return b.id.localeCompare(a.id);
};

export const groupConversationsByTimelineAndWorkspace = (conversations: ConversationItem[], t: (key: string) => string): TimelineSection[] => {
  console.log('[groupConversationsByTimelineAndWorkspace] Input conversations:', conversations.length);
  const allWorkspaceGroups = new Map<string, ConversationItem[]>();
  const withoutWorkspaceConvs: ConversationItem[] = [];

  conversations.forEach((conv) => {
    const workspace = conv.extra?.workspace;
    const customWorkspace = conv.extra?.customWorkspace;

    if (customWorkspace && workspace) {
      if (!allWorkspaceGroups.has(workspace)) {
        allWorkspaceGroups.set(workspace, []);
      }
      allWorkspaceGroups.get(workspace)!.push(conv);
    } else {
      withoutWorkspaceConvs.push(conv);
    }
  });

  const workspaceGroupsByTimeline = new Map<string, WorkspaceGroup[]>();

  allWorkspaceGroups.forEach((convList, workspace) => {
    const sortedConvs = [...convList].sort((a, b) => compareConversationsByLatestActivity(a as TChatConversation, b as TChatConversation));
    const latestConv = sortedConvs[0];
    const timeline = getConversationTimelineLabel(latestConv, t);

    if (!workspaceGroupsByTimeline.has(timeline)) {
      workspaceGroupsByTimeline.set(timeline, []);
    }

    // Prefer stored workspaceDisplayName from conversations, fallback to path-derived name
    const storedDisplayName = sortedConvs.find((c) => (c.extra as { workspaceDisplayName?: string })?.workspaceDisplayName)?.extra as { workspaceDisplayName?: string } | undefined;
    const displayName = storedDisplayName?.workspaceDisplayName || getWorkspaceDisplayName(workspace);

    workspaceGroupsByTimeline.get(timeline)!.push({
      workspace,
      displayName,
      conversations: sortedConvs as TChatConversation[],
    });
  });

  const withoutWorkspaceByTimeline = new Map<string, ConversationItem[]>();

  withoutWorkspaceConvs.forEach((conv) => {
    const timeline = getConversationTimelineLabel(conv, t);
    console.log('[groupConversationsByTimelineAndWorkspace] Adding to timeline:', timeline, 'conv:', conv.id, conv.name);
    if (!withoutWorkspaceByTimeline.has(timeline)) {
      withoutWorkspaceByTimeline.set(timeline, []);
    }
    withoutWorkspaceByTimeline.get(timeline)!.push(conv);
  });

  const timelineOrder = ['conversation.history.today', 'conversation.history.yesterday', 'conversation.history.recent7Days', 'conversation.history.earlier'];
  const sections: TimelineSection[] = [];

  timelineOrder.forEach((timelineKey) => {
    const timeline = t(timelineKey);
    const withWorkspace = workspaceGroupsByTimeline.get(timeline) || [];
    const withoutWorkspace = withoutWorkspaceByTimeline.get(timeline) || [];

    if (withWorkspace.length === 0 && withoutWorkspace.length === 0) return;

    const items: TimelineItem[] = [];

    withWorkspace.forEach((group) => {
      const updateTime = getWorkspaceUpdateTime(group.workspace);
      const time = updateTime > 0 ? updateTime : getActivityTime(group.conversations[0] as TChatConversation);
      items.push({
        type: 'workspace',
        time,
        workspaceGroup: group,
      });
    });

    withoutWorkspace.forEach((conv) => {
      items.push({
        type: 'conversation',
        time: getActivityTime(conv as TChatConversation),
        conversation: conv as TChatConversation,
      });
    });

    items.sort((a, b) => b.time - a.time);

    sections.push({
      timeline,
      items,
    });
  });

  return sections;
};

/**
 * Build scheduled-task groups.
 *
 * Groups are keyed by cron job (one group per job) so a conversation bound to
 * multiple jobs appears in multiple groups. Sources:
 *   - For every cron job: if it has a bound conversation (metadata.conversationId),
 *     that conversation appears in this job's group.
 *   - Auto-created run-record conversations (tagged with `extra.cronJobId`) are
 *     slotted into the matching job's group too, so per-run history still shows up.
 *
 * A conversation tagged with `extra.cronJobId` is a cron-generated run record and
 * must NOT appear in the regular timeline — see `buildGroupedHistory` below.
 */
const buildScheduledGroups = (conversations: ConversationItem[], cronJobs: ICronJob[]): ScheduledGroup[] => {
  const convById = new Map<string, TChatConversation>();
  conversations.forEach((c) => convById.set(c.id, c as TChatConversation));

  // Group run-record conversations by the job id recorded in their extra.
  const runRecordsByJob = new Map<string, TChatConversation[]>();
  conversations.forEach((conv) => {
    const jobId = (conv.extra as any)?.cronJobId as string | undefined;
    if (!jobId) return;
    if (!runRecordsByJob.has(jobId)) runRecordsByJob.set(jobId, []);
    runRecordsByJob.get(jobId)!.push(conv as TChatConversation);
  });

  const groups: ScheduledGroup[] = [];
  cronJobs.forEach((job) => {
    const convs: TChatConversation[] = [];
    const seen = new Set<string>();

    // Pre-bound conversation (if any) appears in this job's group.
    const boundId = job.metadata.conversationId;
    if (boundId) {
      const bound = convById.get(boundId);
      if (bound) {
        convs.push(bound);
        seen.add(bound.id);
      }
    }

    // Per-run records tagged with this job id.
    (runRecordsByJob.get(job.id) || []).forEach((conv) => {
      if (!seen.has(conv.id)) {
        convs.push(conv);
        seen.add(conv.id);
      }
    });

    if (convs.length === 0) return;
    convs.sort(compareCronConversationsByCreatedTime);
    groups.push({
      jobId: job.id,
      jobName: job.name,
      conversations: convs,
      latestConversationTime: getCronConversationTime(convs[0]),
    });
  });

  // Sort groups by most recent conversation within each group, with stable fallbacks.
  groups.sort((a, b) => {
    const timeDiff = b.latestConversationTime - a.latestConversationTime;
    if (timeDiff !== 0) return timeDiff;
    return b.jobId.localeCompare(a.jobId);
  });
  return groups;
};

export const buildGroupedHistory = (
  conversations: ConversationItem[],
  t: (key: string) => string,
  cronJobs: ICronJob[] = [],
  /**
   * The person's agents, in the order the server gave them. Empty while it is
   * still loading, which leaves `agentGroups` empty so the sidebar shows the
   * timeline rather than flashing an ungrouped list.
   */
  agents: Array<{ ref: string; displayName: string; kind: AgentGroup['kind'] }> = []
): GroupedHistoryResult => {
  console.log('[buildGroupedHistory] Input:', {
    conversationsCount: conversations.length,
  });

  // Conversations with `extra.cronJobId` are cron-created run records → Scheduled only.
  // Pre-bound user conversations are NOT tagged; they stay in the regular timeline
  // and are also included in the scheduled group for every job that binds them
  // (resolved via cronJobs in buildScheduledGroups).

  // For pinned: include ALL conversations (cronJobId conversations can be pinned too)
  const pinnedConversations = conversations
    .filter((conversation) => isConversationPinned(conversation))
    .sort((a, b) => {
      const orderA = getConversationSortOrder(a as TChatConversation);
      const orderB = getConversationSortOrder(b as TChatConversation);
      if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
      if (orderA !== undefined) return -1;
      if (orderB !== undefined) return 1;
      return getConversationPinnedAt(b as TChatConversation) - getConversationPinnedAt(a as TChatConversation);
    });

  // Split pinned into timeline and scheduled tabs based on pinnedTab field.
  // Legacy conversations without pinnedTab default to timeline.
  const pinnedTimeline = pinnedConversations.filter((conv) => {
    const pinnedTab = getConversationPinnedTab(conv);
    return pinnedTab !== 'scheduled';
  });

  const pinnedScheduled = pinnedConversations.filter((conv) => {
    return getConversationPinnedTab(conv) === 'scheduled';
  });

  // For timeline sections: exclude cronJobId conversations AND pinned conversations
  const normalConversations = conversations.filter((conv) => !(conv.extra as any)?.cronJobId && !isConversationPinned(conv));

  const result = {
    pinnedTimeline: pinnedTimeline as TChatConversation[],
    pinnedScheduled: pinnedScheduled as TChatConversation[],
    timelineSections: groupConversationsByTimelineAndWorkspace(normalConversations as TChatConversation[], t),
    scheduledGroups: buildScheduledGroups(conversations, cronJobs),
    agentGroups: agents.length > 0 ? groupConversationsByAgent(normalConversations, agents) : [],
    recent: getRecentConversations(normalConversations),
  };

  console.log(
    '[buildGroupedHistory] Result timelineSections:',
    result.timelineSections.length,
    result.timelineSections.map((s) => ({ timeline: s.timeline, itemsCount: s.items.length }))
  );

  return result;
};

/** How many of the newest conversations the cross-agent section shows. */
export const RECENT_CONVERSATION_LIMIT = 8;

const getConversationAgentRef = (conversation: ConversationItem): string | undefined => {
  const extra = conversation.extra as { agentName?: unknown } | undefined;
  return typeof extra?.agentName === 'string' && extra.agentName ? extra.agentName : undefined;
};

/**
 * Conversations grouped by the agent each belongs to.
 *
 * The group is the agent, not the template it came from: two people who both
 * picked 「招聘专家」 have two agents, and each sees only their own. `agents`
 * comes from the server for that reason — only it knows which of the three
 * kinds a stored reference is and where each kind's name lives.
 *
 * Agents keep the order the server gave them (the person's own first, then the
 * ones they made, then templates they have used), so the sidebar does not
 * reshuffle as conversations come and go. An agent with no conversations is
 * still listed: it is somewhere to start one, and a user who just made an agent
 * would otherwise watch it vanish.
 */
export const groupConversationsByAgent = (conversations: ConversationItem[], agents: AgentGroup[] | Array<{ ref: string; displayName: string; kind: AgentGroup['kind'] }>): AgentGroup[] => {
  const byRef = new Map<string, ConversationItem[]>();
  for (const conversation of conversations) {
    const ref = getConversationAgentRef(conversation);
    if (!ref) continue;
    const bucket = byRef.get(ref);
    if (bucket) bucket.push(conversation);
    else byRef.set(ref, [conversation]);
  }

  const groups: AgentGroup[] = agents.map((agent) => ({
    ref: agent.ref,
    displayName: agent.displayName,
    kind: agent.kind,
    conversations: (byRef.get(agent.ref) ?? []).sort(compareConversationsByLatestActivity),
  }));

  // A conversation whose agent the server did not list still has to be
  // reachable — dropping it would hide a conversation the user can open from
  // the only place they can find it.
  const listed = new Set(groups.map((group) => group.ref));
  for (const [ref, bucket] of byRef) {
    if (listed.has(ref)) continue;
    groups.push({
      ref,
      displayName: ref,
      kind: 'template',
      conversations: bucket.sort(compareConversationsByLatestActivity),
    });
  }

  return groups;
};

/**
 * The newest conversations across every agent.
 *
 * Grouping only by agent would make "find the one from last week" start with
 * "remember whose it was", which is a step backwards from a flat list. This
 * keeps the by-time route open without giving up the grouping.
 */
export const getRecentConversations = (conversations: ConversationItem[], limit: number = RECENT_CONVERSATION_LIMIT): ConversationItem[] => [...conversations].sort(compareConversationsByLatestActivity).slice(0, limit);
