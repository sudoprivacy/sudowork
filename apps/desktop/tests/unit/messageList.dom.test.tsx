import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TMessage } from '@sudowork/common/chatLib';
const state = vi.hoisted(() => ({ messages: [] as TMessage[], rows: [] as TMessage[], initialIndex: -1 }));
vi.mock('@renderer/messages/hooks', () => ({ useMessageList: () => state.messages }));
vi.mock('@renderer/context/ConversationContext', () => ({ useConversationContextSafe: () => ({ conversationId: 'test' }) }));
vi.mock('@renderer/hooks/useShowToolCalls', () => ({ useShowToolCalls: () => true }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({ systemSettings: { getShowTokenUsageBadges: { invoke: async () => false }, showTokenUsageBadgesChanged: { on: () => () => {} } } }));
vi.mock('@renderer/messages/MessagetText', () => ({
  default: ({ message, footer }: { message: Extract<TMessage, { type: 'text' }>; footer?: React.ReactNode }) => (
    <div>
      {message.content.content}
      {footer}
    </div>
  ),
}));
vi.mock('@renderer/messages/TurnActions', () => ({ default: () => <div>Turn actions</div> }));
vi.mock('@renderer/messages/MessageFileChanges', () => ({ default: () => null, parseDiff: () => [] }));
vi.mock('@renderer/messages/acp/MessageAcpPermission', () => ({ default: () => null }));
vi.mock('@renderer/messages/acp/MessageAcpQuestion', () => ({ default: () => null }));
vi.mock('@renderer/messages/acp/MessageAcpToolCall', () => ({ default: () => null }));
vi.mock('@renderer/messages/MessageAgentStatus', () => ({ default: () => null }));
vi.mock('@renderer/messages/codex/MessageCodexToolCall', () => ({ default: () => null }));
vi.mock('@renderer/messages/MessageFileSend', () => ({ default: () => null }));
vi.mock('@renderer/messages/MessagePlan', () => ({ default: () => null }));
vi.mock('@renderer/messages/MessageThought', () => ({ default: () => null }));
vi.mock('@renderer/messages/MessageTips', () => ({ default: () => null }));
vi.mock('@renderer/messages/MessageToolCall', () => ({ default: () => null }));
vi.mock('@renderer/messages/MessageToolGroup', () => ({ default: () => null }));
vi.mock('@renderer/messages/MessageToolGroupSummary', () => ({ default: () => null }));
vi.mock('@renderer/messages/useAutoScroll', () => ({ BOTTOM_BUFFER_PX: 40, useAutoScroll: () => ({ virtuosoRef: { current: null }, bottomSpacerHeight: 0 }) }));
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({ data, initialTopMostItemIndex, itemContent }: { data: TMessage[]; initialTopMostItemIndex: number; itemContent: (index: number, item: TMessage) => React.ReactNode }) => {
    state.rows = data;
    state.initialIndex = initialTopMostItemIndex;
    return (
      <>
        {data.map((item, index) => (
          <div key={item.id}>{itemContent(index, item)}</div>
        ))}
      </>
    );
  },
}));
import MessageList from '@renderer/messages/MessageList';
const message = (id: string, position: 'left' | 'right', content: string): TMessage => ({ id, msg_id: id, conversation_id: 'test', type: 'text', position, content: { content } });
afterEach(cleanup);
describe('chat virtual rows', () => {
  it('starts empty at a valid index and accepts later history', () => {
    state.messages = [];
    const view = render(<MessageList />);
    expect(state.initialIndex).toBe(0);
    state.messages = [message('user', 'right', 'Translate the video'), message('answer', 'left', 'Video ready')];
    view.rerender(<MessageList />);
    expect(screen.getByText('Translate the video')).toBeTruthy();
    expect(screen.getByText('Video ready')).toBeTruthy();
    expect(state.rows.map((item) => item.id)).toEqual(['user', 'answer']);
    expect(state.initialIndex).toBe(1);
    expect(screen.getAllByText('Turn actions')).toHaveLength(1);
  });
  it('attaches completed turn toolbars without zero-height virtual rows', () => {
    state.messages = [message('u1', 'right', 'First'), message('a1', 'left', 'One'), message('u2', 'right', 'Second'), message('a2', 'left', 'Two')];
    render(<MessageList />);
    expect(state.rows.map((item) => item.id)).toEqual(['u1', 'a1', 'u2', 'a2']);
    expect(screen.getAllByText('Turn actions')).toHaveLength(2);
    expect(state.initialIndex).toBe(3);
  });
});
