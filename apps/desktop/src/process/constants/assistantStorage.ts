/**
 * Assistant subdirectory names for categorized assistant preset storage.
 * Personal mode: All prefixed with `_` to distinguish from legacy flat assistant files.
 * Enterprise mode: No prefix (hub/custom/tenant/system).
 */

/** Personal mode subdirectory names (prefixed with `_`) */
export const ASSISTANT_SUBDIRS = {
  /** Hub-installed assistant presets (source_type: 'hub') */
  hub: '_hub',
  /** Builtin/system assistant presets (is_builtin: true) */
  system: '_system',
  /** User-created custom assistants (source_type: 'custom') */
  custom: '_my-custom-assistant',
} as const;

/** Enterprise mode subdirectory names (no prefix) */
export const ENTERPRISE_ASSISTANT_SUBDIRS = {
  /** Hub-installed assistants (synced from Moss Server) */
  hub: 'hub',
  /** User-created custom assistants */
  custom: 'custom',
  /** Enterprise tenant-exclusive assistants (approved by admin) */
  tenant: 'tenant',
  /** System/builtin assistants */
  system: 'system',
} as const;

/** Metadata file name for assistant presets (personal mode) */
export const ASSISTANT_META_FILE = '_sudowork_meta.json';

/** Metadata file name for assistant presets (enterprise mode - matches Moss Server) */
export const MOSS_ASSISTANT_META_FILE = '_moss_meta.json';

/**
 * Assistant preset metadata stored in _sudowork_meta.json.
 *
 * The pure type now lives in @sudowork/common so it can be shared with the
 * renderer; re-exported here for backward-compatible import paths.
 */
export type { IAssistantMeta } from '@sudowork/common/assistantTypes';
