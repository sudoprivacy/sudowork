/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { IMAGE_ATTACHMENT_TRANSPORT_CAP_BYTES, formatBytes, validateImageAttachmentSize } from '@/common/image-attachment-guard';

describe('formatBytes', () => {
  it('formats bytes < 1KB as raw bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('formats < 1MB as KB (rounded)', () => {
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(190 * 1024)).toBe('190 KB');
  });

  it('formats >= 1MB as MB (1 decimal)', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(25 * 1024 * 1024)).toBe('25.0 MB');
    expect(formatBytes(Math.floor(52.5 * 1024 * 1024))).toBe('52.5 MB');
  });
});

describe('validateImageAttachmentSize', () => {
  it('returns null for undefined / null / empty input (no images = no problem)', () => {
    expect(validateImageAttachmentSize(undefined)).toBeNull();
    expect(validateImageAttachmentSize(null)).toBeNull();
    expect(validateImageAttachmentSize([])).toBeNull();
  });

  it('returns null when all images are under the cap', () => {
    const small = 'x'.repeat(100 * 1024); // 100KB base64
    expect(
      validateImageAttachmentSize([
        { data: small, mimeType: 'image/png' },
        { data: small, mimeType: 'image/jpeg' },
      ])
    ).toBeNull();
  });

  it('returns null at exactly the cap (boundary — only STRICTLY above cap triggers)', () => {
    const atCap = 'x'.repeat(IMAGE_ATTACHMENT_TRANSPORT_CAP_BYTES);
    expect(validateImageAttachmentSize([{ data: atCap, mimeType: 'image/png' }])).toBeNull();
  });

  it('returns a user-facing message when the first image exceeds the cap', () => {
    const oversize = 'x'.repeat(IMAGE_ATTACHMENT_TRANSPORT_CAP_BYTES + 1);
    const got = validateImageAttachmentSize([{ data: oversize, mimeType: 'image/png' }]);
    expect(got).not.toBeNull();
    expect(got).toMatch(/图片 #1 太大了/);
    expect(got).toMatch(/上限 25\.0 MB/);
    // User-facing message must NOT leak internal architecture jargon
    expect(got).not.toMatch(/sudocode|gRPC|transport|MAX_IMAGE_BYTES/);
  });

  it('reports the FIRST oversize image (early return, not aggregate)', () => {
    const small = 'x'.repeat(100);
    const oversize = 'x'.repeat(IMAGE_ATTACHMENT_TRANSPORT_CAP_BYTES + 1);
    const got = validateImageAttachmentSize([
      { data: small, mimeType: 'image/png' }, // #1 ok
      { data: small, mimeType: 'image/png' }, // #2 ok
      { data: oversize, mimeType: 'image/jpeg' }, // #3 too big
      { data: oversize, mimeType: 'image/jpeg' }, // #4 also too big but never reported
    ]);
    expect(got).toMatch(/图片 #3 太大了/);
    expect(got).not.toMatch(/图片 #4/);
  });

  it('respects a custom cap parameter (so tests + future callers can tune without env)', () => {
    const small = 'x'.repeat(1024);
    expect(validateImageAttachmentSize([{ data: small, mimeType: 'image/png' }], 100)).toMatch(/图片 #1 太大了/);
    expect(validateImageAttachmentSize([{ data: small, mimeType: 'image/png' }], 10_000)).toBeNull();
  });

  it('regression: cap is 25 MB (matches AcpAgent transport limit, documented in module header)', () => {
    // If this is bumped, also revisit the comment header explaining WHY 25MB
    // (covers typical screenshots while leaving 5× headroom over sudocode's
    // 5MB LLM-side preflight).
    expect(IMAGE_ATTACHMENT_TRANSPORT_CAP_BYTES).toBe(25 * 1024 * 1024);
  });
});
