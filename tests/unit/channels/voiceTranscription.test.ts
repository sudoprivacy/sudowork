/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { resolveMediaText, VOICE_TRANSCRIPTION_PLATFORMS } from '@/channels/gateway/voiceTranscription';
import type { IUnifiedMessageContent } from '@/channels/types';

/**
 * WeChat voice → transcript integration coverage for the gateway voice branch.
 * Asserts the two contracts from the design doc:
 *   1. a voice message surfaces as transcribed text (the agent input), not the
 *      opaque `[voice message]` placeholder;
 *   2. when ASR fails (transcriber returns ''), the channel degrades gracefully
 *      back to the placeholder instead of breaking.
 */
describe('resolveMediaText (gateway voice transcription)', () => {
  const voiceContent = (overrides: Partial<IUnifiedMessageContent> = {}): IUnifiedMessageContent => ({
    type: 'voice',
    text: '',
    attachments: [{ type: 'voice', fileId: '/tmp/wechat_voice.amr', codec: 'silk' }],
    ...overrides,
  });

  it('replaces the [voice message] placeholder with the transcript for WeChat voice', async () => {
    const transcribe = vi.fn().mockResolvedValue('你好，明天上午十点开会');
    const text = await resolveMediaText(voiceContent(), 'wechat', transcribe);

    expect(text).toBe('你好，明天上午十点开会');
    // Adapter-supplied codec hint is forwarded so the SILK decode kicks in.
    expect(transcribe).toHaveBeenCalledWith('/tmp/wechat_voice.amr', 'silk');
  });

  it('falls back to [voice message] when ASR returns empty (graceful failure)', async () => {
    const transcribe = vi.fn().mockResolvedValue('');
    const text = await resolveMediaText(voiceContent(), 'wechat', transcribe);

    expect(text).toBe('[voice message]');
    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it('does not transcribe for channels that are not yet enabled (no-op)', async () => {
    const transcribe = vi.fn().mockResolvedValue('should not be used');
    // dingtalk is intentionally not in VOICE_TRANSCRIPTION_PLATFORMS yet.
    expect(VOICE_TRANSCRIPTION_PLATFORMS.has('dingtalk')).toBe(false);

    const text = await resolveMediaText(voiceContent(), 'dingtalk', transcribe);
    expect(text).toBe('[voice message]');
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('keeps platform-supplied transcription (content.text) without re-transcribing', async () => {
    const transcribe = vi.fn();
    // WeCom already delivers voice-to-text; content.text is pre-filled.
    const text = await resolveMediaText(voiceContent({ text: 'already transcribed' }), 'wechat', transcribe);

    expect(text).toBe('already transcribed');
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('falls back when there is no usable voice attachment', async () => {
    const transcribe = vi.fn();
    const text = await resolveMediaText(voiceContent({ attachments: [] }), 'wechat', transcribe);

    expect(text).toBe('[voice message]');
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('does not transcribe non-voice media (photo placeholder unchanged)', async () => {
    const transcribe = vi.fn();
    const content: IUnifiedMessageContent = {
      type: 'photo',
      text: '',
      attachments: [{ type: 'photo', fileId: '/tmp/pic.jpg' }],
    };
    const text = await resolveMediaText(content, 'wechat', transcribe);

    expect(text).toBe('[photo message]');
    expect(transcribe).not.toHaveBeenCalled();
  });
});
