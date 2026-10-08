/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@sudowork/common/storage';
import type { CronJobStatusEnums } from '@renderer/utils/enum';

/**
 * Unified conversation type for sidebar rendering
 *
 * With Provider abstraction layer, all conversations are TChatConversation:
 * - Local conversations (acp): stored in database
 * - Enterprise conversations (remote-agent): cached locally as TChatConversation
 */
export type ConversationItem = TChatConversation;

export type WorkspaceGroup = {
  workspace: string;
  displayName: string;
  conversations: ConversationItem[];
};

/**
 * One agent and the conversations that belong to it.
 *
 * The group is the agent, not the template it came from: two people who picked
 * 「招聘专家」 have two agents, and each sees only their own.
 */
export type AgentGroup = {
  /** Stable identity from the server; display names are presentation only. */
  ref: string;
  displayName: string;
  kind: 'default' | 'own' | 'template';
  conversations: ConversationItem[];
};

export type ScheduledGroup = {
  jobId: string;
  jobName: string;
  conversations: ConversationItem[]; // sorted newest-first
  latestConversationTime: number;
};

export type TimelineItem = {
  type: 'workspace' | 'conversation';
  time: number;
  workspaceGroup?: WorkspaceGroup;
  conversation?: ConversationItem;
};

export type TimelineSection = {
  timeline: string;
  items: TimelineItem[];
};

export type SidebarTabKey = 'timeline' | 'scheduled';

export type GroupedHistoryResult = {
  pinnedTimeline: ConversationItem[];
  pinnedScheduled: ConversationItem[];
  timelineSections: TimelineSection[];
  scheduledGroups: ScheduledGroup[];
  /**
   * Grouped by the agent each conversation belongs to. Empty until the agent
   * list has loaded, so the sidebar falls back to the timeline rather than
   * flashing an ungrouped list.
   */
  agentGroups: AgentGroup[];
  /**
   * The most recent conversations across every agent, newest first.
   *
   * Grouping only by agent would make "find the one from last week" start with
   * "remember whose it was". This keeps the by-time route open.
   */
  recent: ConversationItem[];
};

export type ExportZipFile = {
  name: string;
  content?: string;
  sourcePath?: string;
};

export type ExportTask = { mode: 'single'; conversation: TChatConversation } | { mode: 'batch'; conversationIds: string[] } | null;

export type ConversationRowProps = {
  conversation: ConversationItem;
  collapsed: boolean;
  tooltipEnabled: boolean;
  batchMode: boolean;
  checked: boolean;
  selected: boolean;
  menuVisible: boolean;
  onToggleChecked: (conversation: TChatConversation) => void;
  onConversationClick: (conversation: ConversationItem) => void;
  onOpenMenu: (conversation: ConversationItem) => void;
  onMenuVisibleChange: (conversationId: string, visible: boolean) => void;
  onEditStart: (conversation: ConversationItem) => void;
  onDelete: (conversation: ConversationItem) => void;
  onExport: (conversation: TChatConversation) => void;
  onTogglePin: (conversation: ConversationItem) => void;
  getJobStatus: (conversationId: string) => CronJobStatusEnums;
};

/**
 * Batch-action surface published by the history list up to the sider, so the
 * batch button there can present these actions inside a popover instead of an
 * inline toolbar block.
 */
export type BatchHistoryApi = {
  selectedCount: number;
  allSelected: boolean;
  onToggleSelectAll: () => void;
  onBatchExport: () => void;
  onBatchDelete: () => void;
};

export type WorkspaceGroupedHistoryProps = {
  onSessionClick?: () => void;
  collapsed?: boolean;
  tooltipEnabled?: boolean;
  batchMode?: boolean;
  onBatchModeChange?: (value: boolean) => void;
  activeTab?: SidebarTabKey;
  /** Publishes the current batch-action API (or null when batch mode is off). */
  onBatchApiChange?: (api: BatchHistoryApi | null) => void;
};

export type DragItemType = 'conversation' | 'workspace';

export type DragItem = {
  type: DragItemType;
  id: string;
  conversation?: TChatConversation;
  workspaceGroup?: WorkspaceGroup;
  sourceSection: 'pinned' | string;
  sourceWorkspace?: string;
};
