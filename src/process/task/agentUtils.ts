/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { DRAFTS_DIR_NAME } from '@/common/constants';
import { getBuiltinSkillsDir, loadSkillsContent } from '@process/initStorage';
import { AcpSkillManager, buildSkillsIndexText } from './AcpSkillManager';
import type { PresetAgentType } from '@/types/acpTypes';

/**
 * 首次消息处理配置
 * First message processing configuration
 */
export interface FirstMessageConfig {
  /** 预设上下文/规则 / Preset context/rules */
  presetContext?: string;
  /** 启用的 skills 列表 / Enabled skills list */
  enabledSkills?: string[];
  /** 工作空间路径 / Workspace path (used for drafts instruction) */
  workspace?: string;
  /** 预设 Agent 类型 / Preset agent type - used to control skill injection behavior */
  presetAgentType?: PresetAgentType | string;
}

/**
 * 构建草稿箱使用指令
 * Build drafts box usage instructions for Agent
 *
 * 通过系统提示词告诉 Agent：
 * 1. 中间产物（脚本、临时数据、草稿等）应写入 .drafts/ 目录
 * 2. 最终结果文件直接写入工作空间根目录
 *
 * Via system prompt, instruct the Agent:
 * 1. Intermediate artifacts (scripts, temp data, drafts) should be written to .drafts/
 * 2. Final result files should be written directly to workspace root
 */
export function buildDraftsInstruction(workspace: string): string {
  const draftsPath = `${workspace}/${DRAFTS_DIR_NAME}`;
  return `[Workspace File Management Rules]
Your workspace is: ${workspace}
A drafts directory exists at: ${draftsPath}

File output rules:
- Intermediate/temporary files (scripts, temp data, draft versions, processing steps, helper code) → Write to ${draftsPath}/
- Final deliverable files (reports, final outputs, completed documents) → Write to ${workspace}/
- When executing multi-step tasks, save each step's intermediate output to the drafts directory
- The final completed result should always be in the workspace root, not in drafts
- Examples of intermediate files: .py scripts, .sh scripts, temp .json/.csv data files, draft .md files
- Examples of final files: final reports, processed datasets, completed documents`;
}

/**
 * 构建系统指令内容（完整 skills 内容注入 - 用于 Gemini）
 * Build system instructions content (full skills content injection - for Gemini)
 *
 * @param config - 首次消息配置 / First message configuration
 * @returns 系统指令字符串或 undefined / System instructions string or undefined
 */
export async function buildSystemInstructions(config: FirstMessageConfig): Promise<string | undefined> {
  const instructions: string[] = [];

  // 添加预设上下文 / Add preset context
  if (config.presetContext) {
    instructions.push(config.presetContext);
  }

  // 添加草稿箱使用指令 / Add drafts box instructions
  if (config.workspace) {
    instructions.push(buildDraftsInstruction(config.workspace));
  }

  // 加载并添加 skills 内容 / Load and add skills content
  if (config.enabledSkills && config.enabledSkills.length > 0) {
    const skillsContent = await loadSkillsContent(config.enabledSkills);
    if (skillsContent) {
      instructions.push(skillsContent);
    }
  }

  if (instructions.length === 0) {
    return undefined;
  }

  return instructions.join('\n\n');
}

/**
 * 为首次消息注入系统指令（完整 skills 内容 - 用于 Gemini）
 * Inject system instructions for first message (full skills content - for Gemini)
 *
 * 注意：使用直接前缀方式而非 XML 标签，以确保 Claude Code CLI 等外部 agent 能正确识别
 * Note: Use direct prefix instead of XML tags to ensure external agents like Claude Code CLI can recognize it
 *
 * @param content - 原始消息内容 / Original message content
 * @param config - 首次消息配置 / First message configuration
 * @returns 注入系统指令后的消息内容 / Message content with system instructions injected
 */
export async function prepareFirstMessage(content: string, config: FirstMessageConfig): Promise<string> {
  const systemInstructions = await buildSystemInstructions(config);

  if (!systemInstructions) {
    return content;
  }

  // 使用与 Gemini Agent 类似的直接前缀格式，确保 Claude/Codex 等外部 agent 能正确识别
  // Use direct prefix format similar to Gemini Agent to ensure Claude/Codex can recognize it
  return `[Assistant Rules - You MUST follow these instructions]\n${systemInstructions}\n\n[User Request]\n${content}`;
}

/**
 * 为首条消息准备内容：注入规则 + 内置 skills 索引（而非完整内容）
 * Prepare first message: inject rules + builtin skills INDEX (not full content)
 *
 * 用于 ACP agents (Claude/OpenCode) 和 Codex，Agent 通过 Read 工具按需读取 skill 文件
 * Used for ACP agents (Claude/OpenCode) and Codex, Agent reads skill files on-demand using Read tool
 *
 * 注意：针对 ACP/OpenClaw 数字助手，这里只暴露 _system/_builtin 下的内置 skills。
 * Hub/custom/system 下的非 builtin skills 不会通过首条消息注入给 agent。
 * Note: For ACP/OpenClaw assistants, only builtin skills under _system/_builtin are exposed here.
 * Non-builtin skills from hub/custom/system are not injected via the first message.
 *
 * @param content - 原始消息内容 / Original message content
 * @param config - 首次消息配置 / First message configuration
 * @returns 注入系统指令后的消息内容 / Message content with system instructions injected
 */
export async function prepareFirstMessageWithSkillsIndex(content: string, config: FirstMessageConfig): Promise<string> {
  const instructions: string[] = [];

  // 1. 添加预设规则 / Add preset rules
  if (config.presetContext) {
    instructions.push(config.presetContext);
  }

  // 1.5 添加草稿箱使用指令 / Add drafts box instructions
  if (config.workspace) {
    instructions.push(buildDraftsInstruction(config.workspace));
  }

  // 2. 仅加载内置 skills 索引
  // Load builtin skills index only
  const skillManager = AcpSkillManager.getInstance();
  await skillManager.discoverBuiltinSkills();

  const builtinSkillsIndex = skillManager.getBuiltinSkillsIndex();
  if (builtinSkillsIndex.length > 0) {
    const systemSkillsDir = getBuiltinSkillsDir();
    const indexText = buildSkillsIndexText(builtinSkillsIndex);

    // 告诉 Agent 只从 builtin skills 目录按需读取
    // Tell Agent to read only from the builtin skills directory on demand
    const skillsInstruction = `${indexText}

[Skills Location]
Builtin skills are stored at:
- ${systemSkillsDir}/{skill-name}/SKILL.md

Each skill has a SKILL.md file containing detailed instructions.
To use a skill, read its SKILL.md file when needed.

For example:
- Builtin "cron" skill: ${systemSkillsDir}/cron/SKILL.md`;

    instructions.push(skillsInstruction);
  }

  if (instructions.length === 0) {
    return content;
  }

  const systemInstructions = instructions.join('\n\n');
  return `[Assistant Rules - You MUST follow these instructions]\n${systemInstructions}\n\n[User Request]\n${content}`;
}

/**
 * 为首条消息补充 workspace skills 目录提示，供 OpenClaw 自行读取非 builtin skills。
 * Add workspace skills directory hint so OpenClaw can discover non-builtin skills by itself.
 */
export function injectSkillsDirectoryHint(content: string, skillsDir: string): string {
  const hint = `[Skills Directory]
Skills are installed at: ${skillsDir}
When skill instructions reference relative paths like "skills/{name}/scripts/...", resolve them as "${skillsDir}/{name}/scripts/...".`;

  if (content.includes('[User Request]')) {
    return content.replace('[User Request]', `${hint}\n\n[User Request]`);
  }

  return `${hint}\n\n${content}`;
}

/**
 * 构建系统指令（仅 skills 索引，不注入全文 - 用于 Gemini）
 * Build system instructions with skills INDEX only (no full content - for Gemini)
 *
 * Gemini 没有文件读取工具，无法自行读取 SKILL.md 文件。
 * 当 Gemini 需要某个 skill 的详细指令时，输出 [LOAD_SKILL: skill-name]，
 * 由系统截获并将 skill 全文作为 [System Response] 发回。
 *
 * Gemini has no file read tool and cannot read SKILL.md files on its own.
 * When Gemini needs detailed instructions for a skill, it outputs [LOAD_SKILL: skill-name],
 * and the system intercepts it and sends back the full skill content as [System Response].
 *
 * @param config - 首次消息配置 / First message configuration
 * @returns 系统指令字符串或 undefined / System instructions string or undefined
 */
export async function buildSystemInstructionsWithSkillsIndex(config: FirstMessageConfig): Promise<string | undefined> {
  const instructions: string[] = [];

  // 添加预设上下文 / Add preset context
  if (config.presetContext) {
    instructions.push(config.presetContext);
  }

  // 添加草稿箱使用指令 / Add drafts box instructions
  if (config.workspace) {
    instructions.push(buildDraftsInstruction(config.workspace));
  }

  // 加载 skills 索引（包括内置 skills + 可选 skills）
  // Load skills INDEX (including builtin skills + optional skills)
  const skillManager = AcpSkillManager.getInstance(config.enabledSkills);
  await skillManager.discoverSkills(config.enabledSkills);

  if (skillManager.hasAnySkills()) {
    const skillsIndex = skillManager.getSkillsIndex();
    if (skillsIndex.length > 0) {
      const indexText = buildSkillsIndexText(skillsIndex);
      instructions.push(indexText);
    }
  }

  if (instructions.length === 0) {
    return undefined;
  }

  return instructions.join('\n\n');
}
