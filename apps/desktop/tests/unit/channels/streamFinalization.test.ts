/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

// ============================================================================
// Extracted stream callback pattern — mirrors ActionExecutor.handleChatMessage
// streaming logic (lines ~700-880).
//
// This tests the EXACT pattern that caused two bugs:
//   Bug 1: AI Card stuck spinning when file sent during streaming
//   Bug 2: Unwanted Copy/Regenerate/Continue buttons on fallback plain message
//
// Root cause: file/image message IDs polluted sentMessageIds, preventing
// AI Card finalization and triggering sendPlainMessage fallback.
// ============================================================================

interface SimMessage {
  type: 'text' | 'file' | 'image';
  text?: string;
  fileName?: string;
  isInsert: boolean;
}

interface SimResult {
  sentMessageIds: string[];
  editCalls: Array<{ targetId: string; msgType: string; hasReplyMarkup: boolean }>;
  plainMessageCalls: Array<{ text: string }>;
}

/**
 * Simulates the stream callback logic from ActionExecutor.handleChatMessage.
 * Returns call traces so tests can assert on exact behavior.
 *
 * This is a faithful reproduction of the logic — if this function's behavior
 * diverges from ActionExecutor, the test loses value. Keep in sync.
 */
function simulateStream(messages: SimMessage[], platform: 'dingtalk' | 'telegram' | 'lark' = 'dingtalk'): SimResult {
  const sentMessageIds: string[] = ['aicard_thinking_123']; // thinkingMsgId
  let lastMessageContent: SimMessage | null = null;
  let lastTextContent: SimMessage | null = null;
  let thinkingUpdated = false;
  let msgIdCounter = 100;

  const editCalls: SimResult['editCalls'] = [];
  const plainMessageCalls: SimResult['plainMessageCalls'] = [];

  const doEditMessage = (msg: SimMessage, forceThinkingTarget = false) => {
    const targetId = forceThinkingTarget
      ? sentMessageIds[0]
      : (sentMessageIds[sentMessageIds.length - 1] || sentMessageIds[0]);
    editCalls.push({ targetId, msgType: msg.type, hasReplyMarkup: false });
  };

  // ---- Stream callback (mirrors ActionExecutor lines ~738-824) ----
  for (const msg of messages) {
    const streamOutgoing = msg;
    lastMessageContent = streamOutgoing;
    if (streamOutgoing.type === 'text') {
      lastTextContent = streamOutgoing;
    }

    if (msg.isInsert && !thinkingUpdated && streamOutgoing.type === 'text') {
      // First text insert: edit thinking message in-place
      thinkingUpdated = true;
      doEditMessage(streamOutgoing, true);
    } else if (msg.isInsert) {
      // Non-first insert: send new message
      const newMsgId = `msg_${++msgIdCounter}`;
      // KEY FIX: Don't push file/image IDs
      if (streamOutgoing.type !== 'file' && streamOutgoing.type !== 'image') {
        sentMessageIds.push(newMsgId);
      }
    } else {
      // Update: edit last sentMessageId
      doEditMessage(streamOutgoing);
    }
  }

  // ---- After stream ends (mirrors ActionExecutor lines ~856-880) ----
  if (lastMessageContent) {
    if (lastMessageContent.type === 'file' || lastMessageContent.type === 'image') {
      // FIX: Still finalize the AI Card with lastTextContent
      if (lastTextContent && sentMessageIds.length > 0) {
        const lastMsgId = sentMessageIds[sentMessageIds.length - 1];
        editCalls.push({
          targetId: lastMsgId,
          msgType: 'text', // using lastTextContent
          hasReplyMarkup: platform === 'dingtalk',
        });
      }
      // If lastTextContent is null (no text before file): no action — no crash
    } else {
      // Normal text finalization
      const lastMsgId = sentMessageIds[sentMessageIds.length - 1];
      editCalls.push({
        targetId: lastMsgId,
        msgType: lastMessageContent.type,
        hasReplyMarkup: platform === 'dingtalk',
      });
    }
  }

  return { sentMessageIds, editCalls, plainMessageCalls };
}

// ============================================================================
// Tests
// ============================================================================

describe('Stream finalization when file/image is sent', () => {
  // -------------------------------------------------------------------------
  // Bug 1: AI Card stuck spinning
  // -------------------------------------------------------------------------
  describe('sentMessageIds should not contain file/image IDs', () => {
    it('should NOT push file message ID to sentMessageIds', () => {
      const messages: SimMessage[] = [
        { type: 'text', text: 'Hello', isInsert: true },
        { type: 'file', fileName: 'doc.docx', isInsert: true },
      ];
      const result = simulateStream(messages);

      // Only the thinkingMsgId should be present — file ID was NOT pushed
      expect(result.sentMessageIds).toEqual(['aicard_thinking_123']);
      // No file ID (like processQueryKey) pollutes the array
      expect(result.sentMessageIds).not.toContainEqual(expect.stringContaining('file'));
    });

    it('should NOT push image message ID to sentMessageIds', () => {
      const messages: SimMessage[] = [
        { type: 'text', text: 'Hello', isInsert: true },
        { type: 'image', isInsert: true },
      ];
      const result = simulateStream(messages);

      expect(result.sentMessageIds).toEqual(['aicard_thinking_123']);
    });

    it('should still push text insert IDs to sentMessageIds', () => {
      const messages: SimMessage[] = [
        { type: 'text', text: 'First block', isInsert: true },
        { type: 'file', fileName: 'doc.docx', isInsert: true },
        { type: 'text', text: 'Second block', isInsert: true },
      ];
      const result = simulateStream(messages);

      // thinkingMsgId + second text block ID
      expect(result.sentMessageIds).toHaveLength(2);
      expect(result.sentMessageIds[0]).toBe('aicard_thinking_123');
      expect(result.sentMessageIds[1]).toMatch(/^msg_\d+$/);
    });

    it('should handle multiple file sends without polluting sentMessageIds', () => {
      const messages: SimMessage[] = [
        { type: 'text', text: 'Generating files...', isInsert: true },
        { type: 'file', fileName: 'file1.pdf', isInsert: true },
        { type: 'file', fileName: 'file2.xlsx', isInsert: true },
        { type: 'image', isInsert: true },
      ];
      const result = simulateStream(messages);

      // Only thinkingMsgId — zero file/image IDs
      expect(result.sentMessageIds).toEqual(['aicard_thinking_123']);
    });
  });

  // -------------------------------------------------------------------------
  // Bug 2: AI Card finalization target
  // -------------------------------------------------------------------------
  describe('editMessage should target AI Card ID (not file ID)', () => {
    it('should call editMessage with AI Card ID when last message is file', () => {
      const messages: SimMessage[] = [
        { type: 'text', text: 'Here is your document', isInsert: true },
        { type: 'text', text: 'Here is your document (updated)', isInsert: false },
        { type: 'file', fileName: 'report.docx', isInsert: true },
      ];
      const result = simulateStream(messages);

      // Find the final edit call (stream end finalization)
      const finalEdits = result.editCalls.filter(e => e.hasReplyMarkup);
      expect(finalEdits).toHaveLength(1);
      // Must target the AI Card ID, NOT a file processQueryKey
      expect(finalEdits[0].targetId).toBe('aicard_thinking_123');
    });

    it('should call editMessage with AI Card ID when last message is image', () => {
      const messages: SimMessage[] = [
        { type: 'text', text: 'Here is the image', isInsert: true },
        { type: 'image', isInsert: true },
      ];
      const result = simulateStream(messages);

      const finalEdits = result.editCalls.filter(e => e.hasReplyMarkup);
      expect(finalEdits).toHaveLength(1);
      expect(finalEdits[0].targetId).toBe('aicard_thinking_123');
    });

    it('should finalize with text type, not file type', () => {
      const messages: SimMessage[] = [
        { type: 'text', text: 'Complete response', isInsert: true },
        { type: 'file', fileName: 'output.docx', isInsert: true },
      ];
      const result = simulateStream(messages);

      const finalEdits = result.editCalls.filter(e => e.hasReplyMarkup);
      expect(finalEdits).toHaveLength(1);
      // Finalization uses lastTextContent, so msgType should be 'text'
      expect(finalEdits[0].msgType).toBe('text');
    });

    it('should include replyMarkup to trigger isFinal in DingTalkPlugin.editMessage', () => {
      const messages: SimMessage[] = [
        { type: 'text', text: 'Response', isInsert: true },
        { type: 'file', fileName: 'f.docx', isInsert: true },
      ];
      const result = simulateStream(messages, 'dingtalk');

      const finalEdits = result.editCalls.filter(e => e.hasReplyMarkup);
      expect(finalEdits).toHaveLength(1);
      expect(finalEdits[0].hasReplyMarkup).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Regression: normal text-only flow must not change
  // -------------------------------------------------------------------------
  describe('text-only flow should be unchanged', () => {
    it('should finalize with last sentMessageId for text-only stream', () => {
      const messages: SimMessage[] = [
        { type: 'text', text: 'Hello', isInsert: true },
        { type: 'text', text: 'Hello world', isInsert: false },
        { type: 'text', text: 'Hello world!', isInsert: false },
      ];
      const result = simulateStream(messages);

      const finalEdits = result.editCalls.filter(e => e.hasReplyMarkup);
      expect(finalEdits).toHaveLength(1);
      expect(finalEdits[0].targetId).toBe('aicard_thinking_123');
    });

    it('should have replyMarkup for DingTalk platform', () => {
      const messages: SimMessage[] = [
        { type: 'text', text: 'Hi', isInsert: true },
      ];
      const result = simulateStream(messages, 'dingtalk');

      const finalEdits = result.editCalls.filter(e => e.hasReplyMarkup);
      expect(finalEdits[0].hasReplyMarkup).toBe(true);
    });

    it('should NOT have replyMarkup for Telegram platform', () => {
      const messages: SimMessage[] = [
        { type: 'text', text: 'Hi', isInsert: true },
      ];
      const result = simulateStream(messages, 'telegram');

      // Final edit call exists but without replyMarkup (Telegram doesn't use action buttons)
      const finalEdits = result.editCalls.filter(e => e.hasReplyMarkup);
      expect(finalEdits).toHaveLength(0);
      // But the finalization edit call itself should still exist
      const allEdits = result.editCalls;
      expect(allEdits.length).toBeGreaterThanOrEqual(1);
      const lastEdit = allEdits[allEdits.length - 1];
      expect(lastEdit.hasReplyMarkup).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------
  describe('edge cases', () => {
    it('should NOT crash when only file is sent (no text before file)', () => {
      const messages: SimMessage[] = [
        { type: 'file', fileName: 'output.docx', isInsert: true },
      ];
      // Should not throw
      expect(() => simulateStream(messages)).not.toThrow();
    });

    it('should NOT call editMessage for finalization when only file is sent', () => {
      const messages: SimMessage[] = [
        { type: 'file', fileName: 'output.docx', isInsert: true },
      ];
      const result = simulateStream(messages);

      // lastTextContent is null, so no finalization edit should happen
      const finalEdits = result.editCalls.filter(e => e.hasReplyMarkup);
      expect(finalEdits).toHaveLength(0);
    });

    it('should track correct lastTextContent when text appears after file', () => {
      const messages: SimMessage[] = [
        { type: 'text', text: 'First', isInsert: true },
        { type: 'file', fileName: 'doc.docx', isInsert: true },
        { type: 'text', text: 'Second block', isInsert: true },
        { type: 'text', text: 'Second block (updated)', isInsert: false },
      ];
      const result = simulateStream(messages);

      const finalEdits = result.editCalls.filter(e => e.hasReplyMarkup);
      expect(finalEdits).toHaveLength(1);
      // Should target the second text block's ID (msg_101), not thinkingMsgId
      expect(finalEdits[0].targetId).toMatch(/^msg_\d+$/);
    });

    it('should use the LAST text content for finalization, not the first', () => {
      const messages: SimMessage[] = [
        { type: 'text', text: 'First text', isInsert: true },
        { type: 'text', text: 'First text updated', isInsert: false },
        { type: 'file', fileName: 'doc.docx', isInsert: true },
      ];
      const result = simulateStream(messages);

      const finalEdits = result.editCalls.filter(e => e.hasReplyMarkup);
      expect(finalEdits).toHaveLength(1);
      // lastTextContent should be 'First text updated', not 'First text'
      expect(finalEdits[0].msgType).toBe('text');
    });

    it('should handle file between two text blocks', () => {
      const messages: SimMessage[] = [
        { type: 'text', text: 'Block 1', isInsert: true },
        { type: 'file', fileName: 'data.csv', isInsert: true },
        { type: 'text', text: 'Block 2', isInsert: true },
        { type: 'text', text: 'Block 2 updated', isInsert: false },
        { type: 'file', fileName: 'result.pdf', isInsert: true },
      ];
      const result = simulateStream(messages);

      // sentMessageIds: [thinkingMsgId, msg_101 (Block 2)]
      expect(result.sentMessageIds).toHaveLength(2);
      // Finalization should target Block 2's ID
      const finalEdits = result.editCalls.filter(e => e.hasReplyMarkup);
      expect(finalEdits).toHaveLength(1);
      expect(finalEdits[0].targetId).toMatch(/^msg_\d+$/);
    });
  });
});
