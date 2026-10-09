/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * True ONLY for errors indicating the SQLite *file* itself is corrupt/unreadable as
 * a database — the single case where renaming it aside is safe. Engine/environment
 * failures (missing or ABI-mismatched native binding, permission denied, locked db)
 * must NOT sideline the user's data: doing so turns a recoverable install/runtime
 * problem into apparent data loss. When in doubt, treat as NOT corrupt (fail loud,
 * keep the file).
 */
export function isCorruptDatabaseFileError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  const code = String((error as { code?: unknown })?.code ?? '').toUpperCase();
  return (
    code === 'SQLITE_CORRUPT' ||
    code === 'SQLITE_NOTADB' ||
    msg.includes('malformed') || // SQLITE_CORRUPT: "database disk image is malformed"
    msg.includes('file is not a database') || // SQLITE_NOTADB
    msg.includes('file is encrypted or is not a database')
  );
}
