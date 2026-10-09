/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { bodyKey, ctaKey, formatBytes, showsBytes, titleKey, toRuntimeErrorClass } from '@/common/runtime-errors';

describe('toRuntimeErrorClass', () => {
  it.each(['context_window_exceeded', 'single_request_too_large', 'request_body_too_large', 'quota', 'rate_limit', 'auth', 'network', 'timeout'])('preserves known runtime class: %s', (cls) => {
    expect(toRuntimeErrorClass(cls)).toBe(cls);
  });

  it('returns null for unknown class (forward-compat: renderer falls back to legacy text path)', () => {
    expect(toRuntimeErrorClass('unknown')).toBeNull();
    expect(toRuntimeErrorClass('some_future_class')).toBeNull();
    expect(toRuntimeErrorClass('')).toBeNull();
  });
});

describe('i18n key builders', () => {
  it('produces stable key shapes for each class', () => {
    expect(titleKey('single_request_too_large')).toBe('runtimeError.single_request_too_large.title');
    expect(bodyKey('context_window_exceeded')).toBe('runtimeError.context_window_exceeded.body');
  });

  it('classes with no actionable CTA return null', () => {
    // rate_limit / network / timeout are informational — they share the
    // generic "请重试" UX outside the banner, so no class-specific CTA.
    expect(ctaKey('rate_limit')).toBeNull();
    expect(ctaKey('network')).toBeNull();
    expect(ctaKey('timeout')).toBeNull();
  });

  it.each(['context_window_exceeded', 'single_request_too_large', 'request_body_too_large', 'quota', 'auth'] as const)('classes with actionable CTA return a key: %s', (cls) => {
    expect(ctaKey(cls)).toBe(`runtimeError.${cls}.cta`);
  });
});

describe('showsBytes', () => {
  it('only size-driven errors show the offending byte count', () => {
    expect(showsBytes('single_request_too_large')).toBe(true);
    expect(showsBytes('request_body_too_large')).toBe(true);
    expect(showsBytes('context_window_exceeded')).toBe(false);
    expect(showsBytes('rate_limit')).toBe(false);
    expect(showsBytes('quota')).toBe(false);
  });
});

describe('formatBytes', () => {
  it('formats < 1KB as bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('formats < 1MB as KB (rounded)', () => {
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(190 * 1024)).toBe('190 KB');
  });

  it('formats >= 1MB as MB (1 decimal)', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(25 * 1024 * 1024)).toBe('25.0 MB');
    expect(formatBytes(Math.floor(25.2 * 1024 * 1024))).toBe('25.2 MB');
  });
});
