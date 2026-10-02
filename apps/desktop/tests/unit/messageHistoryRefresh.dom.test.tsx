import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { TMessage } from '@sudowork/common/chatLib';

const read = vi.hoisted(() => vi.fn());
vi.mock('@sudowork/host-bridge/ipcBridge', () => ({
  conversation: { flushPendingMessages: { invoke: async () => undefined } },
  database: { getConversationMessages: { invoke: read } },
}));
import { MessageListProvider, useMessageList, useMessageLstCache } from '@renderer/messages/hooks';
import { emitter } from '@renderer/utils/emitter';

afterEach(cleanup);

it('refreshes a mounted conversation after a background turn without mixing other conversations', async () => {
  const user: TMessage = { id: 'user', conversation_id: 'cron', type: 'text', position: 'right', content: { content: 'Run' } };
  const answer: TMessage = { id: 'answer', conversation_id: 'cron', type: 'text', position: 'left', content: { content: 'Done' } };
  read.mockResolvedValueOnce([user]).mockResolvedValue([user, answer]);
  const { result } = renderHook(
    () => {
      useMessageLstCache('cron');
      return useMessageList();
    },
    { wrapper: ({ children }) => <MessageListProvider value={[]}>{children}</MessageListProvider> }
  );
  await waitFor(() => expect(result.current).toEqual([user]));
  act(() => emitter.emit('conversation.messages.refresh', 'another-conversation'));
  expect(read).toHaveBeenCalledTimes(1);
  act(() => emitter.emit('conversation.messages.refresh', 'cron'));
  await waitFor(() => expect(result.current).toEqual([user, answer]));
});
