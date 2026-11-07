import { describe, expect, it } from 'vitest';
import type { TMessage } from '@sudowork/common/chatLib';
import { areTurnActionsEqual, buildMessagePresentation } from '@renderer/messages/messagePresentation';

const options = { isProcessing: false, isToolCallsVisible: true, conversationId: 'conversation' };
const text = (id: string, content: string): TMessage => ({ type: 'text', position: 'left', id, msg_id: id, conversation_id: 'conversation', content: { content } });
const diff: TMessage = { type: 'codex_tool_call', position: 'left', id: 'diff-source', msg_id: 'diff-source', conversation_id: 'conversation', content: { subtype: 'turn_diff', data: { unified_diff: '--- a/test.rs\n+++ b/test.rs\n@@ -1 +1 @@\n-old\n+new\n' } } } as TMessage;

describe('stable transcript presentation', () => {
  it('keeps existing diff keys stable when another message streams', () => {
    const before = buildMessagePresentation([diff, text('answer', 'First')], options);
    const after = buildMessagePresentation([diff, text('answer', 'First and next')], options);
    expect(before.find((row) => row.type === 'file_summary')?.id).toBe('file-summary-diff-source');
    expect(after.find((row) => row.type === 'file_summary')?.id).toBe('file-summary-diff-source');
  });

  it('uses the message identity when a tool has no call identity', () => {
    const tool = { type: 'tool_group', id: 'tool-source', msg_id: 'tool-source', content: [], position: 'left', conversation_id: 'conversation' } as TMessage;
    expect(buildMessagePresentation([tool], options).map((row) => row.id)).toEqual(buildMessagePresentation([tool], options).map((row) => row.id));
  });

  it('compares footer contents and conversation without depending on React element identity', () => {
    const action = { type: 'turn_actions' as const, id: 'actions', conversationId: 'first', turnTexts: ['body'], turnTextsRaw: ['**body**'] };
    expect(areTurnActionsEqual(action, { ...action, turnTexts: ['body'], turnTextsRaw: ['**body**'] })).toBe(true);
    expect(areTurnActionsEqual(action, { ...action, conversationId: 'second' })).toBe(false);
    expect(areTurnActionsEqual(action, { ...action, turnTextsRaw: ['Changed'] })).toBe(false);
  });
});
