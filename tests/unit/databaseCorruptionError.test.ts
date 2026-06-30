/**
 * Guards the data-safety contract behind sudowork's DB recovery: ONLY a genuinely
 * corrupt SQLite *file* may be sidelined and recreated. Every engine/environment
 * failure (missing/ABI-mismatched native binding, permissions, locked db) must be
 * classified NOT-corrupt so the recovery never moves the user's intact data aside —
 * the regression that once turned an install hiccup into apparent data loss.
 */
import { describe, it, expect } from 'vitest';
import { isCorruptDatabaseFileError } from '@process/database/corruptionError';

const err = (message: string, code?: string): Error => Object.assign(new Error(message), code ? { code } : {});

describe('isCorruptDatabaseFileError — corrupt FILE (safe to sideline) → true', () => {
  it('SQLITE_CORRUPT code', () => expect(isCorruptDatabaseFileError(err('x', 'SQLITE_CORRUPT'))).toBe(true));
  it('SQLITE_NOTADB code', () => expect(isCorruptDatabaseFileError(err('x', 'SQLITE_NOTADB'))).toBe(true));
  it('lower-case code is normalized', () => expect(isCorruptDatabaseFileError(err('x', 'sqlite_corrupt'))).toBe(true));
  it('"database disk image is malformed"', () => expect(isCorruptDatabaseFileError(err('database disk image is malformed'))).toBe(true));
  it('"file is not a database"', () => expect(isCorruptDatabaseFileError(err('file is not a database'))).toBe(true));
  it('"file is encrypted or is not a database"', () => expect(isCorruptDatabaseFileError(err('file is encrypted or is not a database'))).toBe(true));
  it('message match is case-insensitive', () => expect(isCorruptDatabaseFileError(err('Database Disk Image Is MALFORMED'))).toBe(true));
});

describe('isCorruptDatabaseFileError — engine/environment failure (data intact) → false', () => {
  it('missing native binding (the original incident)', () => expect(isCorruptDatabaseFileError(err('Could not locate the bindings file. Tried: .../better_sqlite3.node'))).toBe(false));
  it('ABI mismatch (NODE_MODULE_VERSION)', () => expect(isCorruptDatabaseFileError(err('The module was compiled against a different Node.js version using NODE_MODULE_VERSION 143'))).toBe(false));
  it('permission denied (EACCES)', () => expect(isCorruptDatabaseFileError(err('permission denied', 'EACCES'))).toBe(false));
  it('permission denied (EPERM)', () => expect(isCorruptDatabaseFileError(err('operation not permitted', 'EPERM'))).toBe(false));
  it('locked db (SQLITE_BUSY / "database is locked")', () => expect(isCorruptDatabaseFileError(err('database is locked', 'SQLITE_BUSY'))).toBe(false));
  it('generic error', () => expect(isCorruptDatabaseFileError(err('something went wrong'))).toBe(false));
});

describe('isCorruptDatabaseFileError — non-Error inputs (never throw, default false)', () => {
  it('plain string', () => expect(isCorruptDatabaseFileError('malformed' as unknown)).toBe(true)); // string is stringified + matched
  it('string without signature', () => expect(isCorruptDatabaseFileError('nope' as unknown)).toBe(false));
  it('null', () => expect(isCorruptDatabaseFileError(null)).toBe(false));
  it('undefined', () => expect(isCorruptDatabaseFileError(undefined)).toBe(false));
  it('object without code/message', () => expect(isCorruptDatabaseFileError({} as unknown)).toBe(false));
});
