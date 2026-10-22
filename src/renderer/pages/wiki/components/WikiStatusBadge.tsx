/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Tag } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { WikiBuildStatus } from '../api/types';

const COLORS: Record<WikiBuildStatus, string> = {
  pending: 'gray',
  running: 'arcoblue',
  succeeded: 'green',
  failed: 'red',
};

export default function WikiStatusBadge({ status, isStale, progress }: IWikiStatusBadgeProps) {
  const { t } = useTranslation();
  const label = status === 'running' && typeof progress === 'number' ? `${t(`wiki.status.${status}`)} ${Math.round(progress)}%` : t(`wiki.status.${status}`);
  return (
    <span className='inline-flex items-center gap-4px'>
      <Tag size='small' color={COLORS[status]}>
        {label}
      </Tag>
      {isStale && status !== 'running' && (
        <Tag size='small' color='orange'>
          {t('wiki.status.needsRebuild')}
        </Tag>
      )}
    </span>
  );
}

interface IWikiStatusBadgeProps {
  status: WikiBuildStatus;
  isStale?: boolean;
  progress?: number;
}
