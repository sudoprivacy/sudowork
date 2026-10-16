import type { TChatConversation } from '@sudowork/common/storage';
import type { GroupedHistoryResult, TimelineItem } from '@renderer/pages/conversation/grouped-history/types';
import { getTimelineLabel } from '@renderer/utils/timeline';
import type { ExternalConversationView } from './navigation';

export type UnifiedHistoryConversation = TChatConversation | ExternalConversationView;
type UnifiedTimelineItem = Omit<TimelineItem, 'conversation'> & { conversation?: UnifiedHistoryConversation };

/** Merge projections into chronological views, keeping native actions and personal-agent groups native. */
export function mergeExternalHistory(history: GroupedHistoryResult, external: ExternalConversationView[], t: (key: string) => string) {
  const sections = new Map<string, UnifiedTimelineItem[]>(history.timelineSections.map((section) => [section.timeline, [...section.items]]));
  for (const conversation of external) {
    const time = conversation.modifyTime || conversation.createTime;
    const timeline = getTimelineLabel(time, Date.now(), t);
    const items = sections.get(timeline) ?? [];
    items.push({ type: 'conversation', time, conversation });
    sections.set(timeline, items);
  }
  const order = ['conversation.history.today', 'conversation.history.yesterday', 'conversation.history.recent7Days', 'conversation.history.earlier'].map(t);
  return {
    ...history,
    timelineSections: order.filter((timeline) => sections.has(timeline)).map((timeline) => ({ timeline, items: sections.get(timeline)!.sort((a, b) => b.time - a.time) })),
  };
}
