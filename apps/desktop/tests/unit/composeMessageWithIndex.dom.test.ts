import { describe, expect, it } from 'vitest';
import type { TMessage } from '@sudowork/common/chatLib';
import { buildMessageIndex, composeMessageWithIndex } from '@renderer/messages/hooks';

type ThoughtMessage = Extract<TMessage, { type: 'thought' }>;

function thought(msgId: string, subject: string, description: string, suffix = description): ThoughtMessage {
  return {
    id: `${msgId}-${suffix}`,
    type: 'thought',
    msg_id: msgId,
    position: 'left',
    conversation_id: 'c',
    content: { subject, description, descriptionMode: 'delta' },
  } as ThoughtMessage;
}

describe('composeMessageWithIndex — thought append', () => {
  it('merges a first tool lifecycle within one batch even when the transcript starts empty', () => {
    let rows: TMessage[] = [];
    const index = buildMessageIndex(rows);
    const call = { id: 'first', msg_id: 'call', type: 'acp_tool_call', position: 'left', conversation_id: 'c', content: { sessionId: 'native', update: { toolCallId: 'call', status: 'pending' } } } as TMessage;
    rows = composeMessageWithIndex(call, rows, index);
    const completed = { ...call, id: 'next', content: { sessionId: 'native', update: { toolCallId: 'call', status: 'completed' } } } as TMessage;
    rows = composeMessageWithIndex(completed, rows, index);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('first');
    expect(rows[0].content).toMatchObject({ update: { status: 'completed' } });
  });
  it('replaces a reasoning snapshot instead of appending it after earlier deltas', () => {
    let list: TMessage[] = [];
    const index = buildMessageIndex(list);
    list = composeMessageWithIndex(thought('t1', 'Thinking', 'first'), list, index);
    list = composeMessageWithIndex({ ...thought('t1', 'Thinking', 'first complete'), content: { subject: 'Thinking', description: 'first complete' } }, list, index);
    expect((list[0] as ThoughtMessage).content.description).toBe('first complete');
    list = composeMessageWithIndex(thought('t1', 'Thinking', '\n\n'), list, index);
    expect((list[0] as ThoughtMessage).content.description).toBe('first complete\n\n');
  });
  it('concatenates description across same-msg_id thought deltas and takes latest subject', () => {
    let list: TMessage[] = [];
    const index = buildMessageIndex(list);

    list = composeMessageWithIndex(thought('t1', 's1', 'a'), list, index);
    expect(list).toHaveLength(1);
    expect((list[0] as ThoughtMessage).content.description).toBe('a');
    expect((list[0] as ThoughtMessage).content.subject).toBe('s1');

    list = composeMessageWithIndex(thought('t1', 's2', 'b'), list, index);
    expect(list).toHaveLength(1);
    expect((list[0] as ThoughtMessage).content.description).toBe('ab');
    expect((list[0] as ThoughtMessage).content.subject).toBe('s2');

    list = composeMessageWithIndex(thought('t1', 's3', 'c'), list, index);
    expect(list).toHaveLength(1);
    expect((list[0] as ThoughtMessage).content.description).toBe('abc');
    expect((list[0] as ThoughtMessage).content.subject).toBe('s3');
  });

  it('keeps distinct thought msg_ids as separate messages', () => {
    let list: TMessage[] = [];
    const index = buildMessageIndex(list);
    list = composeMessageWithIndex(thought('t1', 's1', 'a'), list, index);
    list = composeMessageWithIndex(thought('t2', 's2', 'b'), list, index);
    expect(list).toHaveLength(2);
  });

  it('does not affect tips (still replace by msg_id)', () => {
    const tips = (msgId: string, content: string): TMessage =>
      ({
        id: msgId,
        type: 'tips',
        msg_id: msgId,
        position: 'left',
        conversation_id: 'c',
        content: { content, type: 'info' },
      }) as TMessage;

    let list: TMessage[] = [];
    const index = buildMessageIndex(list);
    list = composeMessageWithIndex(tips('k1', 'old'), list, index);
    list = composeMessageWithIndex(tips('k1', 'new'), list, index);
    expect(list).toHaveLength(1);
    expect((list[0].content as { content: string }).content).toBe('new');
  });
});
