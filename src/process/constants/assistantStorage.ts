/**
 * Assistant subdirectory names for categorized assistant preset storage.
 * All prefixed with `_` to distinguish from legacy flat assistant files.
 */
export const ASSISTANT_SUBDIRS = {
  /** Hub-installed assistant presets (source_type: 'hub') */
  hub: '_hub',
  /** Builtin/system assistant presets (is_builtin: true) */
  system: '_system',
  /** User-created custom assistants (source_type: 'custom') */
  custom: '_my-custom-assistant',
} as const;

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
  source_type?: 'hub' | 'custom' | 'builtin';
  is_builtin?: boolean;
  enabled?: boolean;
  installed_version?: string;
  installed_at?: string;
}
