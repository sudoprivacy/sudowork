/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: { count?: number }) => (opts?.count !== undefined ? `${key}:${opts.count}` : key) }),
}));

import WikiPicker, { WikiChips } from '../../src/renderer/components/wiki/WikiPicker';
import type { UsableWiki } from '../../src/renderer/pages/wiki/api/types';

const wiki = (id: string, name: string, overrides: Partial<UsableWiki> = {}): UsableWiki => ({
  id,
  name,
  description: null,
  scope: 'tenant',
  owner_id: 'admin',
  is_owner: false,
  build_status: 'succeeded',
  has_built: true,
  updated_at: 0,
  ...overrides,
});

const wikis = [wiki('w1', 'Handbook'), wiki('w2', 'Specs', { scope: 'private', is_owner: true }), wiki('w3', 'Draft', { has_built: false })];

function renderPicker(props: Partial<React.ComponentProps<typeof WikiPicker>> = {}) {
  const onChange = vi.fn();
  const onMentionPick = vi.fn();
  render(<WikiPicker wikis={wikis} isLoading={false} selectedIds={[]} mentionQuery={null} onChange={onChange} onMentionPick={onMentionPick} onMentionDismiss={vi.fn()} {...props} />);
  return { onChange, onMentionPick };
}

describe('WikiPicker', () => {
  it('shows the selected count on the chip', () => {
    renderPicker({ selectedIds: ['w1', 'w2'] });
    expect(screen.getByText('wiki.chat.chipWithCount:2')).toBeTruthy();
  });

  it('lists only built wikis and toggles the sticky selection', () => {
    const { onChange } = renderPicker({ selectedIds: ['w2'] });
    fireEvent.click(screen.getByText('wiki.chat.chipWithCount:1'));
    expect(screen.getByText('Handbook')).toBeTruthy();
    expect(screen.queryByText('Draft')).toBeNull();
    fireEvent.click(screen.getByText('Handbook'));
    expect(onChange).toHaveBeenCalledWith(['w2', 'w1']);
    fireEvent.click(screen.getByText('Specs'));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('opens in mention mode, filters by the query and picks one wiki', async () => {
    const { onMentionPick, onChange } = renderPicker({ mentionQuery: 'spe' });
    expect(await screen.findByText('wiki.chat.mentionHint')).toBeTruthy();
    expect(screen.queryByText('Handbook')).toBeNull();
    fireEvent.click(screen.getByText('Specs'));
    expect(onMentionPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'w2' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('WikiChips', () => {
  it('renders names, marks unknown ids unavailable and removes on close', () => {
    const onRemove = vi.fn();
    const { container } = render(<WikiChips wikis={wikis} selectedIds={['w1', 'gone']} onRemove={onRemove} />);
    expect(screen.getByText('Handbook')).toBeTruthy();
    expect(screen.getByText('wiki.chat.unavailable')).toBeTruthy();
    const close = container.querySelector('.arco-tag-close-btn');
    expect(close).toBeTruthy();
    fireEvent.click(close!);
    expect(onRemove).toHaveBeenCalledWith('w1');
  });

  it('renders nothing without a selection', () => {
    const { container } = render(<WikiChips wikis={wikis} selectedIds={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
