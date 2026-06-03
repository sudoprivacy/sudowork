/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SlashCommandItem } from './types';

const ACP_LITERAL_SLASH_PREFIX = '\u200C';
const LEADING_SLASH_RE = /^(\s*)\/(\S*)/;
const SUDOWORK_ACP_SLASH_COMMANDS = new Set(['image']);
const KNOWN_ACP_SLASH_COMMANDS = new Set(['model', 'status', 'cost', 'config', 'diff', 'doctor', 'help']);

const IMAGE_COMMAND: SlashCommandItem = {
  name: 'image',
  description: 'Generate an image',
  hint: 'generate an image',
  kind: 'template',
  source: 'builtin',
};

export function getSudoworkAcpSlashCommands(): SlashCommandItem[] {
  return [{ ...IMAGE_COMMAND }];
}

export function isSudoworkAcpSlashCommand(name: string): boolean {
  return SUDOWORK_ACP_SLASH_COMMANDS.has(name);
}

export function isKnownAcpSlashCommand(name: string): boolean {
  return KNOWN_ACP_SLASH_COMMANDS.has(name);
}

export function protectUnsupportedAcpSlashPrompt(prompt: string, availableAcpCommandNames: readonly string[] = []): string {
  const match = prompt.match(LEADING_SLASH_RE);
  if (!match) {
    return prompt;
  }

  const [, leadingWhitespace, commandName] = match;
  if (isSudoworkAcpSlashCommand(commandName) || isKnownAcpSlashCommand(commandName) || availableAcpCommandNames.includes(commandName)) {
    return prompt;
  }

  return `${leadingWhitespace}${ACP_LITERAL_SLASH_PREFIX}${prompt.slice(leadingWhitespace.length)}`;
}
