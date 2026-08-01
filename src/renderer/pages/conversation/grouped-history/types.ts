/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/storage';
import type { CronJobStatusEnums } from '@/renderer/utils/enum';

/**
 * Unified conversation type for sidebar rendering
 *
 * With Provider abstraction layer, all conversations are TChatConversation:
 * - Local conversations (acp): stored in database
 * - Enterprise conversations (remote-agent): cached locally as TChatConversation
 */
export type ConversationItem = TChatConversation;

export type ScheduledGroup = {
  jobId: string;
  jobName: string;
  conversations: ConversationItem[]; // sorted newest-first
  latestConversationTime: number;
};

export type SidebarTabKey = 'timeline' | 'scheduled';

export type GroupedHistoryResult = {
  pinnedTimeline: ConversationItem[];
  pinnedScheduled: ConversationItem[];
  timelineConversations: ConversationItem[];
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
  collapsed?: boolean;
  tooltipEnabled?: boolean;
  batchMode?: boolean;
  onBatchModeChange?: (value: boolean) => void;
  activeTab?: SidebarTabKey;
  /** Publishes the current batch-action API (or null when batch mode is off). */
  onBatchApiChange?: (api: BatchHistoryApi | null) => void;
};
