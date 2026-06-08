/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/storage';

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
  getJobStatus: (conversationId: string) => 'none' | 'active' | 'paused' | 'error' | 'unread';
};

export type WorkspaceGroupedHistoryProps = {
  onSessionClick?: () => void;
  collapsed?: boolean;
  tooltipEnabled?: boolean;
  batchMode?: boolean;
  onBatchModeChange?: (value: boolean) => void;
  activeTab?: SidebarTabKey;
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
