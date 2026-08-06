import { describe, it, expect } from 'vitest';

import { isNewerVersion } from '@process/services/skillUpdate/version';

/**
 * Regression guard for the auto-update decision. The live e2e proved the full
 * flow (a stale shareone-skill v1.2.0 auto-updated to v1.2.7 on launch); this
 * pins the version comparison that decides *whether* to update, including the
 * traps that would silently break it (string-vs-semver ordering, downgrades,
 * garbage input).
 */
describe('isNewerVersion (skill auto-update decision)', () => {
  it('updates a stale skill — the real case this feature fixes', () => {
    expect(isNewerVersion('1.2.7', '1.2.0')).toBe(true);
  });

  it('does not update when already at the latest version', () => {
    expect(isNewerVersion('1.2.7', '1.2.7')).toBe(false);
  });

  it('never downgrades (hub older than installed)', () => {
    expect(isNewerVersion('1.2.0', '1.2.7')).toBe(false);
  });

  it('orders by semver, not string — 1.10.0 is newer than 1.9.0', () => {
    // A naive string compare would report 1.10.0 < 1.9.0 and miss the update.
    expect(isNewerVersion('1.10.0', '1.9.0')).toBe(true);
    expect(isNewerVersion('1.9.0', '1.10.0')).toBe(false);
  });

  it('bumps across minor/major boundaries', () => {
    expect(isNewerVersion('2.0.0', '1.9.9')).toBe(true);
    expect(isNewerVersion('1.3.0', '1.2.9')).toBe(true);
  });

  it('tolerates non-strict tags via coerce (v-prefix, missing patch)', () => {
    expect(isNewerVersion('v1.3', '1.2.9')).toBe(true);
    expect(isNewerVersion('1.2', '1.2.0')).toBe(false);
  });

  it('is safe on unparseable input — no update, no throw', () => {
    expect(isNewerVersion('', '1.2.0')).toBe(false);
    expect(isNewerVersion('not-a-version', '1.2.0')).toBe(false);
    expect(isNewerVersion('1.2.7', '')).toBe(false);
  });
});
