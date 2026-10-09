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
    content: { subject, description },
  } as ThoughtMessage;
}

describe('composeMessageWithIndex — thought append', () => {
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
