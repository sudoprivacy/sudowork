/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

// Stub react-i18next so tests are deterministic — t() echoes the key,
// with {{bytes}} interpolation simulated.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { bytes?: string; defaultValue?: string }) => {
      if (opts?.bytes && key.endsWith('.body')) return `body(${key}, bytes=${opts.bytes})`;
      if (opts?.defaultValue !== undefined && !key.startsWith('runtimeError.')) return opts.defaultValue;
      return key;
    },
  }),
}));

// Stub the icon library — @icon-park/react ESM imports can be heavy in jsdom.
vi.mock('@icon-park/react', () => ({
  Attention: (props: Record<string, unknown>) => <span data-testid='icon-attention' {...props} />,
}));

vi.mock('@office-ai/platform', () => ({
  theme: { Color: { FunctionalColor: { error: '#f00' } } },
}));

import RuntimeErrorBanner from '@renderer/messages/RuntimeErrorBanner';

describe('RuntimeErrorBanner', () => {
  it('renders differentiated banner with data-testid per class (regression: lets e2e select by class)', () => {
    render(<RuntimeErrorBanner errorClass='context_window_exceeded' fallbackContent='raw error msg' />);
    expect(screen.getByTestId('runtime-error-context_window_exceeded')).toBeTruthy();
  });

  it('size-driven class interpolates {{bytes}} into the body copy', () => {
    render(<RuntimeErrorBanner errorClass='single_request_too_large' errorBytes={25 * 1024 * 1024} fallbackContent='raw' />);
    // Body uses bytes interpolation — formatBytes(25MB) → "25.0 MB"
    expect(screen.getByText(/25\.0 MB/)).toBeTruthy();
  });

  it('non-size-driven class does NOT interpolate bytes even if errorBytes provided', () => {
    // context_window_exceeded ignores bytes — copy is history-size driven, not request-size driven.
    const { queryByText } = render(<RuntimeErrorBanner errorClass='context_window_exceeded' errorBytes={999999} fallbackContent='raw' />);
    expect(queryByText(/999999/)).toBeNull();
  });

  it('renders CTA button when class has a CTA AND onCtaClick provided', () => {
    const onCta = vi.fn();
    render(<RuntimeErrorBanner errorClass='quota' fallbackContent='raw' onCtaClick={onCta} />);
    const btn = screen.getByTestId('runtime-error-cta-quota');
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(onCta).toHaveBeenCalledWith('quota');
  });

  it('omits CTA when class has no CTA (rate_limit / network / timeout are informational only)', () => {
    const onCta = vi.fn();
    const { queryByTestId } = render(<RuntimeErrorBanner errorClass='rate_limit' fallbackContent='raw' onCtaClick={onCta} />);
    expect(queryByTestId('runtime-error-cta-rate_limit')).toBeNull();
  });

  it('omits CTA when onCtaClick not provided even if class has a CTA (caller opts in to actions)', () => {
    const { queryByTestId } = render(<RuntimeErrorBanner errorClass='quota' fallbackContent='raw' />);
    expect(queryByTestId('runtime-error-cta-quota')).toBeNull();
  });

  it('forward-compat: unknown errorClass falls back to legacy text row with raw content (does NOT render empty banner)', () => {
    // Renderer must degrade gracefully when back-end ships a new errorClass
    // before the renderer's i18n catches up — otherwise users see an empty
    // banner. This is the version-skew regression guard.
    render(<RuntimeErrorBanner errorClass='some_future_class_we_havent_shipped' fallbackContent='upstream raw error text' />);
    expect(screen.getByTestId('runtime-error-fallback')).toBeTruthy();
    expect(screen.getByText('upstream raw error text')).toBeTruthy();
  });
});
