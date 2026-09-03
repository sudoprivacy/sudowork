/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import type { TChatConversation } from '@sudowork/common/storage';

export function resolveWorkspaceSkillsDir(conversation: Pick<TChatConversation, 'type' | 'extra'> | undefined): string | undefined {
  const workspace = conversation?.extra?.workspace;
  if (!workspace) {
    return undefined;
  }

  if (conversation.extra?.backend === 'claude') {
    return path.join(workspace, '.claude', 'skills');
  }

  if (conversation.extra?.backend === 'scode') {
    return path.join(workspace, '.nexus', 'sudocode', 'skills');
  }

  return path.join(workspace, 'skills');
}
