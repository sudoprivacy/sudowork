/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { deriveConversationTitle, isUnnamedConversation } from '@sudowork/common/conversationTitle';

/**
 * Titles used to be derived twice — once in the desktop renderer, once in the
 * WebUI server, with different think-tag handling — and the WebUI copy ran on
 * the read path, so a conversation nobody re-opened stayed nameless. These
 * cover the single derivation both surfaces now share.
 */
describe('deriveConversationTitle', () => {
  it('takes the first line of the message', () => {
    expect(deriveConversationTitle('帮我看下这个报错\n下面是日志')).toBe('帮我看下这个报错');
  });

  it('truncates to 50 characters', () => {
    const title = deriveConversationTitle('x'.repeat(200));
    expect(title).toHaveLength(50);
  });

  it('leaves the conversation unnamed when there is nothing to name it after', () => {
    expect(deriveConversationTitle('')).toBeNull();
    expect(deriveConversationTitle('   \n  ')).toBeNull();
  });

  it('strips reasoning rather than titling the conversation after it', () => {
    expect(deriveConversationTitle('<think>先想一下</think>实际问题')).toBe('实际问题');
  });

  it('strips reasoning that omits the opening tag', () => {
    // MiniMax-style output. The WebUI copy used a single <think>...</think>
    // regex and titled these conversations after the model's thinking.
    expect(deriveConversationTitle('盘算一下用户要什么\n</think>\n真正的问题')).toBe('真正的问题');
  });

  it('returns null rather than a blank name when the message is only reasoning', () => {
    expect(deriveConversationTitle('<think>只有思考</think>')).toBeNull();
  });
});

describe('isUnnamedConversation', () => {
  it('treats absence as unnamed', () => {
    expect(isUnnamedConversation(null)).toBe(true);
    expect(isUnnamedConversation(undefined)).toBe(true);
    expect(isUnnamedConversation('')).toBe(true);
  });

  it('treats a real title as named', () => {
    expect(isUnnamedConversation('帮我看下这个报错')).toBe(false);
  });

  it('recognises the placeholder names older builds stored', () => {
    expect(isUnnamedConversation('Remote Agent')).toBe(true);
    expect(isUnnamedConversation('Moss Server')).toBe(true);
  });

  it('recognises the caller-supplied localized default', () => {
    expect(isUnnamedConversation('新对话', { localizedDefaults: ['新对话'] })).toBe(true);
    // The same conversation under a different UI language.
    expect(isUnnamedConversation('New Conversation', { localizedDefaults: ['新对话'] })).toBe(false);
  });

  it('recognises a conversation named after its own id', () => {
    const id = '53b79918-acd4-4f1e-9b0a-2c1d8f6e4a77';
    expect(isUnnamedConversation(id, { conversationId: id })).toBe(true);
    // A title that merely looks like an id, on a conversation with a different
    // id, is still a title — the check is equality, not shape.
    expect(isUnnamedConversation(id, { conversationId: 'some-other-id' })).toBe(false);
  });

  it('re-derives when a whole message was stored as the name', () => {
    expect(isUnnamedConversation('x'.repeat(51))).toBe(true);
    expect(isUnnamedConversation('x'.repeat(50))).toBe(false);
  });
});
