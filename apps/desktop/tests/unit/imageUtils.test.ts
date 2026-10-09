/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';

import { getImageTargetSize, IMAGE_TARGET_RAW_SIZE, parseImageCapability } from '@/common/imageUtils';

// ---------------------------------------------------------------------------
// parseImageCapability — the wire-shape parser sudowork uses to pull the
// sudocode-side `_meta.sudocode.imageCapability` extension out of an ACP
// `initialize` response. Per the design (image-handling-non-user-facing.html
// Decision 1), every shape that ISN'T the full advertised capability must
// produce `null` — never throw, never warn — so the silent-fallback rule
// holds across pre-extension backends, malformed payloads, and partial fills.
// ---------------------------------------------------------------------------
describe('parseImageCapability', () => {
  it('returns null when initResponse is null/undefined', () => {
    expect(parseImageCapability(null)).toBeNull();
    expect(parseImageCapability(undefined)).toBeNull();
  });

  it('returns null when _meta is missing (legacy backend)', () => {
    expect(parseImageCapability({ protocolVersion: 1 } as never)).toBeNull();
  });

  it('returns null when _meta has no `sudocode` namespace', () => {
    expect(parseImageCapability({ _meta: { other: { stuff: 1 } } })).toBeNull();
  });

  it('returns null when sudocode namespace has no `imageCapability`', () => {
    expect(parseImageCapability({ _meta: { sudocode: { other: 1 } } })).toBeNull();
  });

  it('parses the full sudocode-advertised shape', () => {
    const cap = parseImageCapability({
      _meta: {
        sudocode: {
          imageCapability: {
            maxBytes: 5242880,
            maxDimension: 8000,
            downsampleTargetBytes: 524288,
            autoHandlesOversized: true,
            autoHandlesWrongModel: true,
          },
        },
      },
    });
    expect(cap).toEqual({
      maxBytes: 5242880,
      maxDimension: 8000,
      downsampleTargetBytes: 524288,
      autoHandlesOversized: true,
      autoHandlesWrongModel: true,
    });
  });

  it('coerces missing fields to undefined (partial advertisement is allowed)', () => {
    const cap = parseImageCapability({
      _meta: { sudocode: { imageCapability: { maxBytes: 1024 } } },
    });
    expect(cap).toEqual({
      maxBytes: 1024,
      maxDimension: undefined,
      downsampleTargetBytes: undefined,
      autoHandlesOversized: undefined,
      autoHandlesWrongModel: undefined,
    });
  });

  it('ignores wrong-typed fields (defence in depth — never coerce)', () => {
    const cap = parseImageCapability({
      _meta: {
        sudocode: {
          imageCapability: {
            maxBytes: '5MB', // bogus type
            autoHandlesOversized: 'yes', // bogus type
            downsampleTargetBytes: 12345, // valid — kept
          },
        },
      },
    });
    expect(cap?.maxBytes).toBeUndefined();
    expect(cap?.autoHandlesOversized).toBeUndefined();
    expect(cap?.downsampleTargetBytes).toBe(12345);
  });
});

// ---------------------------------------------------------------------------
// getImageTargetSize — the cap resolver. Per Decision 3 the order is
//   1. economyMode === true → 128 KB (user opt-in)
//   2. capability.downsampleTargetBytes → backend-advertised
//   3. IMAGE_TARGET_RAW_SIZE (512 KB sudowork default)
// modelId is intentionally NOT consulted any more (the old empirical
// `gemini|claude → 128KB` heuristic was wrong for SOTA vision models).
// ---------------------------------------------------------------------------
describe('getImageTargetSize', () => {
  const ECONOMY = 128 * 1024;

  it('returns sudowork default when called with no options', () => {
    expect(getImageTargetSize(null)).toBe(IMAGE_TARGET_RAW_SIZE);
    expect(getImageTargetSize('anything')).toBe(IMAGE_TARGET_RAW_SIZE);
  });

  it('returns 128 KB when economyMode is true, overriding everything', () => {
    expect(getImageTargetSize('anything', { economyMode: true })).toBe(ECONOMY);
    expect(getImageTargetSize('claude-opus-4-8', { economyMode: true, capability: { downsampleTargetBytes: 5_000_000 } })).toBe(ECONOMY);
  });

  it('returns backend-advertised cap when capability has downsampleTargetBytes', () => {
    expect(getImageTargetSize('claude-opus-4-8', { capability: { downsampleTargetBytes: 1_048_576 } })).toBe(1_048_576);
  });

  it('falls back to default when capability is null (graceful-degradation hard rule)', () => {
    expect(getImageTargetSize('claude-opus-4-8', { capability: null })).toBe(IMAGE_TARGET_RAW_SIZE);
  });

  it('falls back to default when downsampleTargetBytes is absent', () => {
    expect(getImageTargetSize('claude-opus-4-8', { capability: { maxBytes: 5242880, autoHandlesOversized: true } })).toBe(IMAGE_TARGET_RAW_SIZE);
  });

  it('falls back to default when downsampleTargetBytes is zero (defensive)', () => {
    expect(getImageTargetSize('claude-opus-4-8', { capability: { downsampleTargetBytes: 0 } })).toBe(IMAGE_TARGET_RAW_SIZE);
  });

  it('legacy modelId-only call signature still works (no regression vs callers that don\'t know about opts yet)', () => {
    expect(getImageTargetSize('gemini-3.5-flash')).toBe(IMAGE_TARGET_RAW_SIZE);
    expect(getImageTargetSize('claude-opus-4-8')).toBe(IMAGE_TARGET_RAW_SIZE);
    expect(getImageTargetSize('gpt-4.1')).toBe(IMAGE_TARGET_RAW_SIZE);
    // Pre-Decision-3 behaviour returned 128 KB for these via the
    // LOW_IMAGE_TARGET_PATTERN heuristic — this is the regression
    // assertion that the heuristic is gone.
  });
});
