/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/storage';
import { getActivityTime, getTimelineLabel } from '@/renderer/utils/timeline';
import { getWorkspaceDisplayName } from '@/renderer/utils/workspace';
import { getWorkspaceUpdateTime } from '@/renderer/utils/workspaceHistory';

import type { GroupedHistoryResult, ScheduledGroup, TimelineItem, TimelineSection, WorkspaceGroup } from '../types';
import { getConversationSortOrder } from './sortOrderHelpers';

export const getConversationTimelineLabel = (conversation: TChatConversation, t: (key: string) => string): string => {
  const time = getActivityTime(conversation);
  return getTimelineLabel(time, Date.now(), t);
};

export const isConversationPinned = (conversation: TChatConversation): boolean => {
  const extra = conversation.extra as { pinned?: boolean } | undefined;
  return Boolean(extra?.pinned);
};

export const getConversationPinnedAt = (conversation: TChatConversation): number => {
  const extra = conversation.extra as { pinnedAt?: number } | undefined;
  if (typeof extra?.pinnedAt === 'number') {
    return extra.pinnedAt;
  }
  return 0;
};

export const groupConversationsByTimelineAndWorkspace = (conversations: TChatConversation[], t: (key: string) => string): TimelineSection[] => {
  const allWorkspaceGroups = new Map<string, TChatConversation[]>();
  const withoutWorkspaceConvs: TChatConversation[] = [];

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
    const sortedConvs = [...convList].sort((a, b) => getActivityTime(b) - getActivityTime(a));
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
      conversations: sortedConvs,
    });
  });

  const withoutWorkspaceByTimeline = new Map<string, TChatConversation[]>();

  withoutWorkspaceConvs.forEach((conv) => {
    const timeline = getConversationTimelineLabel(conv, t);
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
      const time = updateTime > 0 ? updateTime : getActivityTime(group.conversations[0]);
      items.push({
        type: 'workspace',
        time,
        workspaceGroup: group,
      });
    });

    withoutWorkspace.forEach((conv) => {
      items.push({
        type: 'conversation',
        time: getActivityTime(conv),
        conversation: conv,
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

const buildScheduledGroups = (cronConvs: TChatConversation[]): ScheduledGroup[] => {
  const groupMap = new Map<string, TChatConversation[]>();

  cronConvs.forEach((conv) => {
    const jobName = ((conv.extra as any)?.cronJobName as string) || 'Scheduled';
    if (!groupMap.has(jobName)) {
      groupMap.set(jobName, []);
    }
    groupMap.get(jobName)!.push(conv);
  });

  const groups: ScheduledGroup[] = [];
  groupMap.forEach((convs, jobName) => {
    const sorted = [...convs].sort((a, b) => getActivityTime(b) - getActivityTime(a));
    groups.push({ jobName, conversations: sorted });
  });

  // Sort groups by most recent conversation within each group
  groups.sort((a, b) => getActivityTime(b.conversations[0]) - getActivityTime(a.conversations[0]));
  return groups;
};

export const buildGroupedHistory = (conversations: TChatConversation[], t: (key: string) => string): GroupedHistoryResult => {
  // Separate cron-execution conversations — they go to the Scheduled section, not Recents
  const cronConvs = conversations.filter((conv) => !!(conv.extra as any)?.cronJobId);
  const regularConvs = conversations.filter((conv) => !(conv.extra as any)?.cronJobId);

  const pinnedConversations = regularConvs
    .filter((conversation) => isConversationPinned(conversation))
    .sort((a, b) => {
      const orderA = getConversationSortOrder(a);
      const orderB = getConversationSortOrder(b);
      if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
      if (orderA !== undefined) return -1;
      if (orderB !== undefined) return 1;
      return getConversationPinnedAt(b) - getConversationPinnedAt(a);
    });

  const normalConversations = regularConvs.filter((conversation) => !isConversationPinned(conversation));

  return {
    pinnedConversations,
    timelineSections: groupConversationsByTimelineAndWorkspace(normalConversations, t),
    scheduledGroups: buildScheduledGroups(cronConvs),
  };
};
