/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { Bot } from 'lucide-react';
import React from 'react';
import coworkSvg from '@renderer/assets/cowork.svg';
import { getAgentLogo } from '@renderer/utils/agentLogo';
import { resolveExtensionAssetUrl } from '@renderer/utils/platform';

const ASSISTANT_AVATAR_IMAGE_MAP: Record<string, string> = {
  'cowork.svg': coworkSvg,
  '🛠️': coworkSvg,
};

export type TeamAssistantIconKind = 'image' | 'emoji' | 'fallback';

export interface ITeamAssistantIconInput {
  assistantId?: string | null;
  source?: 'agent' | 'assistant' | null;
  backend?: string | null;
  avatar?: string | null;
  name?: string | null;
}

export interface IResolvedTeamAssistantIcon {
  kind: TeamAssistantIconKind;
  value?: string;
}

export function resolveTeamAssistantIcon(input: ITeamAssistantIconInput): IResolvedTeamAssistantIcon {
  if (input.source !== 'agent' && input.source !== 'assistant') {
    const avatarIcon = resolveAvatarIcon(input.avatar);
    if (avatarIcon.kind !== 'fallback') return avatarIcon;

    if (input.assistantId) {
      const assistantLogo = getAgentLogo(resolveAssistantBackendName(input.assistantId));
      if (assistantLogo) return { kind: 'image', value: assistantLogo };
    }

    const backendLogo = getAgentLogo(input.backend);
    return backendLogo ? { kind: 'image', value: backendLogo } : { kind: 'fallback' };
  }

  if (input.source === 'agent') {
    const logo = getAgentLogo(input.backend);
    return logo ? { kind: 'image', value: logo } : { kind: 'fallback' };
  }

  const avatarIcon = resolveAvatarIcon(input.avatar);
  if (avatarIcon.kind !== 'fallback') return avatarIcon;
  const backendLogo = getAgentLogo(input.backend);
  return backendLogo ? { kind: 'image', value: backendLogo } : { kind: 'fallback' };
}

export function getTeamAssistantDisplaySource(input: ITeamAssistantIconInput): 'agent' | 'assistant' {
  if (input.source === 'agent' || input.source === 'assistant') return input.source;
  if (input.assistantId && input.backend && input.assistantId === input.backend) return 'agent';
  return input.avatar?.trim() ? 'assistant' : 'agent';
}

export function renderTeamAssistantIcon(input: ITeamAssistantIconInput, options?: IRenderTeamAssistantIconOptions): React.ReactNode {
  const icon = resolveTeamAssistantIcon(input);
  const size = options?.size ?? 16;
  if (icon.kind === 'image' && icon.value) {
    return <img src={icon.value} alt={input.name ?? ''} width={size} height={size} style={{ objectFit: 'contain', display: 'block' }} />;
  }
  if (icon.kind === 'emoji' && icon.value) {
    return <span style={{ fontSize: size, lineHeight: 1 }}>{icon.value}</span>;
  }
  return <Bot size={size} strokeWidth={1.8} />;
}

export function toChatLayoutAgentLogo(icon: IResolvedTeamAssistantIcon): { agentLogo?: string; agentLogoIsEmoji?: boolean } {
  if (icon.kind === 'image' && icon.value) return { agentLogo: icon.value, agentLogoIsEmoji: false };
  if (icon.kind === 'emoji' && icon.value) return { agentLogo: icon.value, agentLogoIsEmoji: true };
  return {};
}

function resolveAvatarIcon(avatar: string | null | undefined): IResolvedTeamAssistantIcon {
  const value = avatar?.trim();
  if (!value) return { kind: 'fallback' };
  const mapped = ASSISTANT_AVATAR_IMAGE_MAP[value];
  if (mapped) return { kind: 'image', value: mapped };
  const resolved = resolveExtensionAssetUrl(value) || value;
  const isImage = /\.(svg|png|jpe?g|webp|gif)$/i.test(resolved) || /^(https?:|aion-asset:\/\/|file:\/\/|data:)/i.test(resolved);
  if (isImage) return { kind: 'image', value: resolved };
  if (isEmojiAvatar(value)) return { kind: 'emoji', value };
  return { kind: 'fallback' };
}

function isEmojiAvatar(avatar: string): boolean {
  const emojiRegex = /^(?:\p{Emoji_Presentation}|\p{Emoji}️)(?:‍(?:\p{Emoji_Presentation}|\p{Emoji}️))*$/u;
  return emojiRegex.test(avatar);
}

function resolveAssistantBackendName(assistantId: string): string {
  return assistantId.startsWith('builtin-') ? assistantId.slice('builtin-'.length) : assistantId;
}

interface IRenderTeamAssistantIconOptions {
  size?: number;
}
