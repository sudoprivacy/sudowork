/**
 * Skill subdirectory names for categorized skill storage.
 * All prefixed with `_` to distinguish from legacy flat skill directories.
 */
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
