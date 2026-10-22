/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Tag } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import type { UsableWiki } from '../api/types';

export type WikiOrigin = 'tenant' | 'shared' | 'mine';

/** Tenant (企业) wikis, private wikis someone shared with me, or my own. */
export function wikiOrigin(wiki: Pick<UsableWiki, 'scope' | 'is_owner'>): WikiOrigin {
  if (wiki.scope === 'tenant') return 'tenant';
  return wiki.is_owner ? 'mine' : 'shared';
}

const COLORS: Record<WikiOrigin, string> = { tenant: 'arcoblue', shared: 'purple', mine: 'green' };

export default function WikiScopeTag({ wiki }: IWikiScopeTagProps) {
  const { t } = useTranslation();
  const origin = wikiOrigin(wiki);
  return (
    <Tag size='small' color={COLORS[origin]}>
      {t(`wiki.origin.${origin}`)}
    </Tag>
  );
}

interface IWikiScopeTagProps {
  wiki: Pick<UsableWiki, 'scope' | 'is_owner'>;
}
