/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { CodexToolCallUpdate } from '@sudowork/common/chatLib';
import FileChangesPanel from '@renderer/components/base/FileChangesPanel';
import { useDiffPreviewHandlers } from '@renderer/hooks/useDiffPreviewHandlers';
import { parseDiff } from '@renderer/utils/diffUtils';

type TurnDiffContent = Extract<CodexToolCallUpdate, { subtype: 'turn_diff' }>;

const TurnDiffDisplay: React.FC<{ content: TurnDiffContent }> = ({ content }) => {
  const { t } = useTranslation();
  const { data } = content;
  const { unified_diff } = data;

  const fileInfo = useMemo(() => parseDiff(unified_diff), [unified_diff]);
  const { handleFileClick, handleDiffClick } = useDiffPreviewHandlers({ diffText: unified_diff, displayName: fileInfo.fileName, filePath: fileInfo.fullPath });

  return <FileChangesPanel title={t('messages.fileChangesCount', { count: 1 })} files={[fileInfo]} onFileClick={handleFileClick} onDiffClick={handleDiffClick} defaultExpanded={true} />;
};

export default TurnDiffDisplay;
