/**
 * Skill subdirectory names for categorized skill storage.
 * Personal mode: All prefixed with `_` to distinguish from legacy flat skill directories.
 * Enterprise mode: No prefix (hub/custom/tenant/system).
 */

/** Personal mode subdirectory names (prefixed with `_`) */
export const SKILL_SUBDIRS = {
  /** Hub-installed skills (source_type: 'hub') */
  hub: '_hub',
  /** Builtin/system skills (is_builtin: true) */
  system: '_system',
  /** User-uploaded custom skills (source_type: 'upload') */
  custom: '_my-custom-skill',
  /** Legacy builtin directory (pre-migration) */
  legacyBuiltin: '_builtin',
} as const;

/** Enterprise mode subdirectory names (no prefix) */
export const ENTERPRISE_SKILL_SUBDIRS = {
  /** Hub-installed skills (synced from Moss Server) */
  hub: 'hub',
  /** User-created custom skills */
  custom: 'custom',
  /** Enterprise tenant-exclusive skills (approved by admin) */
  tenant: 'tenant',
  /** System/builtin skills */
  system: 'system',
} as const;

/** Metadata file name for skills (personal mode) */
export const SKILL_HUB_META_FILE = '_sudowork_meta.json';

/** Metadata file name for skills (enterprise mode - matches Moss Server) */
export const MOSS_SKILL_META_FILE = '_moss_meta.json';
