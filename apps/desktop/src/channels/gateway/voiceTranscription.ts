/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Gateway voice-transcription glue.
 *
 * Decides the plain-text the agent receives for an inbound media message: for an
 * enabled channel's voice message, transcribe it; otherwise keep the existing
 * placeholder. Kept as a pure function (transcriber injected) so the decision
 * logic — including the graceful fallback — is unit-testable without the full
 * ActionExecutor / DB / session machinery.
 */

import type { IUnifiedMessageContent, PluginType } from '../types';

/**
 * Channels for which inbound voice is transcribed. Per the rollout plan each
 * channel is enabled only once it has its own CI integration test; the shared
 * service stays a no-op for every channel not listed here.
 */
export const VOICE_TRANSCRIPTION_PLATFORMS: ReadonlySet<PluginType> = new Set<PluginType>(['wechat']);

/** A transcriber: audio path + optional codec hint → text ('' if unavailable). */
export type Transcriber = (audioPath: string, codec?: string) => Promise<string>;

export interface ResolvedMediaText {
  /** Text to forward to the agent. */
  text: string;
  /**
   * True when a voice message was successfully transcribed. The caller should
   * then NOT also attach the raw audio file: the agent can't read SILK/AMR and
   * attaching it alongside the transcript makes it ask for clarification.
   */
  transcribed: boolean;
}

/**
 * Resolve the agent-facing text for a media message.
 *
 * For a voice message on an enabled channel (and only when the platform didn't
 * already supply its own transcription as `content.text`), run ASR and use the
 * transcript. On any failure the transcriber returns '' and we fall back to the
 * `[voice message]` placeholder, so a voice message never breaks the channel.
 */
export async function resolveMediaText(content: IUnifiedMessageContent, platform: PluginType, transcribe: Transcriber): Promise<ResolvedMediaText> {
  const placeholder = content.text || `[${content.type} message]`;

  // Only transcribe voice, only when the channel didn't already give us text,
  // and only for channels enabled (with CI) above.
  if (content.type !== 'voice' || content.text || !VOICE_TRANSCRIPTION_PLATFORMS.has(platform)) {
    return { text: placeholder, transcribed: false };
  }

  const voice = content.attachments?.find((a) => a.type === 'voice' && !!a.fileId);
  if (!voice) return { text: placeholder, transcribed: false };

  const transcript = await transcribe(voice.fileId, voice.codec);
  if (transcript) return { text: transcript, transcribed: true };
  return { text: placeholder, transcribed: false };
}
