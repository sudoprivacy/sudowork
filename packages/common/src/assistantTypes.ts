/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure, cross-process assistant type definitions.
 *
 * These types are consumed by both the renderer and the main process (and,
 * later, a shared renderer package), so they live in @sudowork/common rather
 * than in a main-process module. AssistantManager and assistantStorage re-export
 * them for backward-compatible import paths.
 */

export type AssistantCategory = 'custom' | 'hub' | 'system' | 'tenant';

export interface IAssistantEnhancement {
  enabled: boolean;
  mode?: 'agent-chat' | 'workflow' | 'rag-only';
  /** Surfaced for debugging; client code should not call Dify directly with it. */
  difyAppId?: string;
}

/**
 * Assistant preset metadata stored in _sudowork_meta.json.
 * Parallel to ISkillMeta in SkillManager.ts.
 *
 * Skills are NOT embedded — they are referenced by name in `defaultEnabledSkills`.
 * The SSOT for skills remains `~/.nexus/skills/`.
 *
 * Agent rules are always stored as `AGENT.md` in the assistant directory.
 */
export interface IAssistantMeta {
  id?: string;
  /** Assistant name (directory name, used as identifier) */
  name?: string;
  /** Display name from API (may be snake_case) */
  display_name?: string;
  /** Role/profession label from Assistant Hub package metadata */
  profession?: string;
  nameI18n?: Record<string, string>;
  descriptionI18n?: Record<string, string>;
  promptsI18n?: Record<string, string[]>;
  presetAgentType?: string;
  /** Skill names referenced from ~/.nexus/skills/ (SSOT) */
  defaultEnabledSkills?: string[];
  /** User's current skill selections (overrides defaultEnabledSkills) */
  enabledSkills?: string[];
  defaultMode?: string;
  apiKeyFields?: Array<{
    key: string;
    label: string;
    type: 'text' | 'password' | 'select' | 'number' | 'boolean';
    required?: boolean;
    options?: string[];
    default?: string | number | boolean;
  }>;
  avatar?: string;
  emoji?: string | null;
  /**
   * Path to an ops entry point script (e.g. 'tests/e2e/run_op.py').
   * When set, direct ai-dev-browser CLI calls are redirected through this wrapper.
   */
  opsEntryPoint?: string;
  /**
   * Model config overrides (temperature, thinkingBudget, etc).
   * Written to .gemini/settings.json in the conversation workspace before CLI starts.
   */
  modelConfigs?: Record<string, unknown>;
  /** Source filename for agent rules, e.g. 'copilot.md'. Used during init to produce AGENT.md. */
  ruleFile?: string;
  /** Source filename for skill rules. Used during init to produce SKILLS.md. */
  skillFile?: string;
  /**
   * Directory containing all resources for this preset (relative to project root).
   * Resolved at init time to locate ruleFile, skillFile, scripts/, etc.
   */
  resourceDir?: string;
  // Storage tracking fields
  source_type?: 'hub' | 'custom' | 'builtin' | 'tenant';
  is_builtin?: boolean;
  enabled?: boolean;
  installed_version?: string;
  installed_at?: string;
  // Hub API fields
  /** Source tag from Hub API: 'hub' (store), 'custom' (user-created), 'system' (builtin), 'tenant' (enterprise-exclusive) */
  tag?: 'hub' | 'custom' | 'system' | 'tenant';
  /** Associated skill IDs from Hub API (skills guaranteed to exist in Skill Hub) */
  skills?: string[];
  /** Hub category ID */
  category_id?: string;
  /** Hub categories (display names) */
  categories?: string[];
  /** Hub author ID */
  author_id?: string;
  /** Hub homepage URL */
  homepage?: string | null;
  /** Applicable scenarios (JSON string from Hub) */
  applicable_scenarios?: string | null;
  /** Core features (JSON string from Hub) */
  core_features?: string | null;
  /** Default initial prompt to pre-fill input when selecting this assistant */
  defaultInitPrompt?: string | null;
  /** Primary tenant code from Assistant Hub, retained for compatibility. */
  tenantId?: string | null;
  /** Complete tenant visibility list from Assistant Hub. */
  tenantIds?: string[];
  /** Visibility configuration for enterprise assistants (department_ids filter) */
  visible_to?: { department_ids: string[] | null } | null;
  /** Whether this assistant has been uploaded to Moss Server */
  uploaded?: boolean;
  /** Timestamp when uploaded to Moss Server */
  uploaded_at?: string;
  /** Publish status for tenant-exclusive assistants */
  publish_status?: 'pending' | 'approved' | 'rejected';
  /** Timestamp when published as tenant-exclusive */
  published_at?: string;
}

export interface IAssistantInfo {
  /** Unique identifier from server */
  id?: string;
  /** Directory name (used as lookup key) */
  name: string;
  isBuiltin: boolean;
  isHubInstalled: boolean;
  enabled: boolean;
  category: AssistantCategory;
  meta: IAssistantMeta;
  /**
   * Filled in when `getInstalledAssistantsWithVisibility(accessToken)` is
   * called. `undefined` means we haven't checked / can't check (offline);
   * `{enabled: false}` is the explicit "no enhancement" answer.
   */
  enhancement?: IAssistantEnhancement;
}
