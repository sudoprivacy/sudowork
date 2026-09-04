/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import semver from 'semver';

/**
 * True when `latest` is a strictly newer semver than `installed`.
 *
 * Tolerates non-strict tags via `coerce` (e.g. "v1.2" → "1.2.0") and returns
 * false on unparseable input (never updates on garbage, never downgrades).
 *
 * Kept in its own pure module — no I/O, no Electron imports — so the
 * update-decision logic is unit-testable without the main-process graph.
 */
export function isNewerVersion(latest: string, installed: string): boolean {
  const a = semver.valid(latest) || semver.coerce(latest)?.version;
  const b = semver.valid(installed) || semver.coerce(installed)?.version;
  if (!a || !b) return false;
  return semver.gt(a, b);
}
