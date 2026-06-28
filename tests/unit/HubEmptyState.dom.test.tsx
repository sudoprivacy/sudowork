/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? _key }),
}));

import HubEmptyState from '../../src/renderer/components/HubEmptyState';

describe('HubEmptyState', () => {
  it('renders nothing when error is null (falls through to caller default)', () => {
    const { container } = render(<HubEmptyState error={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('TOKEN_MISSING: shows lock-state copy + NO retry button', () => {
    render(<HubEmptyState error={{ code: 'TOKEN_MISSING', message: 'skillhub token missing (assistantHub)', retriable: false }} onRetry={vi.fn()} />);
    expect(screen.getByText(/Skill Hub/i)).toBeTruthy();
    // Retry button must not appear — retrying the fetch with the same
    // (missing) token wouldn't help; user needs to fix login first.
    expect(screen.queryByText('重试')).toBeNull();
  });

  it('FETCH_FAILED: shows fetch-failed copy + retry button + invokes onRetry', () => {
    const onRetry = vi.fn();
    render(<HubEmptyState error={{ code: 'FETCH_FAILED', message: 'ETIMEDOUT', retriable: true }} onRetry={onRetry} />);
    expect(screen.getByText(/拉取失败/)).toBeTruthy();
    const btn = screen.getByText('重试');
    fireEvent.click(btn);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('FETCH_FAILED: omits retry button when onRetry not provided', () => {
    render(<HubEmptyState error={{ code: 'FETCH_FAILED', message: '', retriable: true }} />);
    expect(screen.queryByText('重试')).toBeNull();
  });

  it('renders debug message text when present', () => {
    render(<HubEmptyState error={{ code: 'FETCH_FAILED', message: 'detailed cause here', retriable: true }} />);
    expect(screen.getByText('detailed cause here')).toBeTruthy();
  });

  it('skips message paragraph when empty', () => {
    // When message is empty, the optional detail line should not
    // render at all (no extra noise in the empty state).
    const { container } = render(<HubEmptyState error={{ code: 'TOKEN_MISSING', message: '', retriable: false }} />);
    // The detail line is rendered with class `text-tertiary` only
    // when message is non-empty. Verify the absence.
    expect(container.querySelector('.text-tertiary')).toBeNull();
  });

  it('exposes data-testid by error code (for e2e selectors)', () => {
    const { container } = render(<HubEmptyState error={{ code: 'TOKEN_MISSING', message: '', retriable: false }} />);
    expect(container.querySelector('[data-testid="hub-empty-state-token_missing"]')).not.toBeNull();
  });
});
