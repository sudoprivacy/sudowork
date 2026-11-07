import { expect, it } from 'vitest';
import { AcpAdapter } from '@sudowork/common/acpAdapter';
import { composeMessage, convertMossMessagesToTMessages } from '@sudowork/common/chatLib';
import { mossFrameToResponses } from '@sudowork/common/mossResponse';
import { transformMessage, type TMessage } from '@sudowork/common/chatLib';

it('projects scode ACP thinking chunks as reasoning, preserving whitespace and block boundaries', () => {
  const adapter = new AcpAdapter('conversation', 'scode');
  let rows: TMessage[] = [];
  const chunks = ['Review', ' ', 'this file.', '\n\n', 'Next paragraph.'];
  for (const text of chunks) {
    const [message] = adapter.convertSessionUpdate({ sessionId: 'native-session', update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text } } });
    expect(message.type).toBe('thought');
    rows = composeMessage(message, rows);
  }
  expect(rows).toHaveLength(1);
  expect(rows[0].content).toEqual({ subject: 'Thinking', description: chunks.join('') });
  adapter.convertSessionUpdate({ sessionId: 'native-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Answer' } } });
  const [next] = adapter.convertSessionUpdate({ sessionId: 'native-session', update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'New block' } } });
  expect(next.msg_id).not.toBe(rows[0].msg_id);
});

it('keeps repeated remote snapshots from duplicating thinking in desktop and WebUI', () => {
  let rows: TMessage[] = [];
  for (const thinking of ['First ', 'First paragraph.']) {
    const [response] = mossFrameToResponses({ type: 'assistant', uuid: 'reasoning', message: { content: [{ type: 'thinking', thinking }] } }, { sessionId: 'native-session', conversationId: 'conversation', nextMsgId: () => 'fallback' });
    rows = composeMessage(transformMessage(response)!, rows);
  }
  expect(rows).toHaveLength(1);
  expect(rows[0].content).toMatchObject({ description: 'First paragraph.' });
});

it('restores every reasoning block in its original order and with the same live identity', () => {
  const frame = {
    type: 'assistant',
    uuid: 'turn',
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: 'First paragraph.\n\nSecond paragraph.' },
        { type: 'text', text: 'Answer' },
        { type: 'thinking', thinking: 'Follow-up reasoning' },
      ],
    },
  };
  const live = mossFrameToResponses(frame, { sessionId: 'native-session', conversationId: 'conversation', nextMsgId: () => 'fallback' }).filter((message) => message.type === 'thought');
  const { messages } = convertMossMessagesToTMessages([frame], 'conversation', 'native-session');
  expect(messages.map((message) => message.type)).toEqual(['thought', 'text', 'thought']);
  const reasoning = messages.filter((message) => message.type === 'thought');
  expect(reasoning.map((message) => message.msg_id)).toEqual(live.map((message) => message.msg_id));
  expect(reasoning[0].content).toMatchObject({ description: 'First paragraph.\n\nSecond paragraph.' });
  expect(reasoning[1].content).toMatchObject({ description: 'Follow-up reasoning' });
});
