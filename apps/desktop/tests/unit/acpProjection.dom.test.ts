import { AcpAdapter } from '@sudowork/common/acpAdapter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('shared ACP projection in a browser client', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps streaming blocks separate across thought and tool boundaries', () => {
    const adapter = new AcpAdapter('conversation', 'scode');
    const text = (value: string) => adapter.convertSessionUpdate({ sessionId: 'native-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: value } } })[0];
    const thought = (value: string) => adapter.convertSessionUpdate({ sessionId: 'native-session', update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: value } } })[0];

    const first = text('Hello ');
    const second = text('world');
    expect(second.msg_id).toBe(first.msg_id);
    expect(second.content).toEqual({ content: 'world' });

    const reasoning = thought('Consider ');
    const moreReasoning = thought('the file');
    expect(moreReasoning.msg_id).toBe(reasoning.msg_id);
    expect(moreReasoning.content).toMatchObject({ content: 'Consider the file' });
    const afterThought = text('I will read it.');
    expect(afterThought.msg_id).not.toBe(first.msg_id);

    adapter.convertSessionUpdate({ sessionId: 'native-session', update: { sessionUpdate: 'tool_call', toolCallId: 'read-1', title: 'Read', kind: 'read', status: 'pending', rawInput: { path: 'README.md' } } });
    const [completed] = adapter.convertSessionUpdate({ sessionId: 'native-session', update: { sessionUpdate: 'tool_call_update', toolCallId: 'read-1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'File contents' } }] } });
    expect(completed).toMatchObject({
      type: 'acp_tool_call',
      msg_id: 'read-1',
      conversation_id: 'conversation',
      content: { sessionId: 'native-session', update: { rawInput: { path: 'README.md' }, status: 'completed' } },
    });
    expect(text('Read complete.').msg_id).not.toBe(afterThought.msg_id);
    expect(thought('Next step').content).toMatchObject({ content: 'Next step' });
  });

  it('isolates projection state between concurrent remote sessions', () => {
    const first = new AcpAdapter('first', 'scode');
    const second = new AcpAdapter('second', 'scode');
    first.convertSessionUpdate({ sessionId: 'native-first', update: { sessionUpdate: 'tool_call', toolCallId: 'same-id', title: 'Read', kind: 'read', status: 'pending', rawInput: { path: 'first.md' } } });
    second.convertSessionUpdate({ sessionId: 'native-second', update: { sessionUpdate: 'tool_call', toolCallId: 'same-id', title: 'Read', kind: 'read', status: 'pending', rawInput: { path: 'second.md' } } });
    const [message] = second.convertSessionUpdate({ sessionId: 'native-second', update: { sessionUpdate: 'tool_call_update', toolCallId: 'same-id', status: 'completed' } });
    expect(message).toMatchObject({ conversation_id: 'second', content: { sessionId: 'native-second', update: { rawInput: { path: 'second.md' } } } });
  });
});
