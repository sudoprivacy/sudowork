/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import { DRAFTS_DIR_NAME } from '@/common/constants';
import { getBuiltinSkillsDir, loadSkillsContent } from '@process/initStorage';
import { AcpSkillManager, buildSkillsIndexText, type SkillIndex } from './AcpSkillManager';
import type { PresetAgentType } from '@/types/acpTypes';
import { getNodeBinaryPath, isNodeInstalled } from '@process/services/claudeCli/NodeRuntimeService';
import { getDataPath } from '@process/utils';
import * as path from 'path';
import * as fs from 'fs';

/** mcporter CLI 路径（解压后的 JS 文件，跨平台相同） */
const getMcporterCliPath = (): string => path.join(getDataPath(), 'mcporter', 'package', 'node_modules', 'mcporter', 'dist', 'cli.js');

/** mcporter 配置文件路径 */
const getMcporterConfigPath = (): string => path.join(getDataPath(), 'mcporter', 'mcporter.json');

/**
 * mcporter 配置格式
 */
interface McporterConfig {
  mcpServers: Record<string, McporterServerConfig>;
}

interface McporterServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  baseUrl?: string;
  headers?: Record<string, string>;
  description?: string;
}

/**
 * 同步读取 mcporter 配置
 * Read mcporter config synchronously
 */
export function readMcporterConfigSync(): McporterConfig | null {
  try {
    const configPath = getMcporterConfigPath();
    if (!fs.existsSync(configPath)) {
      return null;
    }
    const content = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(content) as McporterConfig;
  } catch {
    return null;
  }
}

/**
 * 检查是否有 MCP 服务器配置
 * Check if any MCP servers are configured
 */
export function hasMcpServersConfigured(): boolean {
  const config = readMcporterConfigSync();
  return config && Object.keys(config.mcpServers).length > 0;
}

/**
 * 构建 mcporter 执行命令提示词（跨平台）
 * Build mcporter execution command hint (cross-platform)
 */
export function buildMcporterCommandHint(): string {
  const isWindows = process.platform === 'win32';
  const nodeInstalled = isNodeInstalled();

  if (!nodeInstalled) {
    // Node 未安装时的提示
    return `[MCP Integration]
MCP servers are configured but Node.js runtime is not installed.
To use MCP tools, install Node.js first via the app settings.`;
  }

  const nodePath = getNodeBinaryPath();

  // 跨平台命令格式：node <mcporter_cli_path> <args>
  // Windows 和 Mac/Linux 都用这个格式，只是 node 路径不同
  const mcporterConfigPath = getMcporterConfigPath();
  const mcporterCommand = `${nodePath} ${getMcporterCliPath()}`;

  return `[MCP Integration]
When working with external services or APIs, use mcporter CLI to discover MCP tools available in your environment.

Discovery workflow:
1. List available MCP servers:
   ${mcporterCommand} list --output json
   (Environment: MCPORTER_CONFIG=${mcporterConfigPath})

2. Discover tools from a server:
   ${mcporterCommand} list <server_name> --schema --output json

3. Call a tool:
   ${mcporterCommand} call <server_name>.<tool_name> key=value --output json

Example: If user asks about document operations, first run 'mcporter list' to see available MCP servers, then discover tools from relevant servers.

The mcporter config is at: ${mcporterConfigPath}`;
}

/**
 * 构建 Node.js 运行时提示词
 * Build Node.js runtime hint for agent prompts
 *
 * 告诉 agent 托管的 Node.js 可用路径，使其在调用工具时能直接使用 node/npm/npx。
 * Informs the agent about the managed Node.js runtime path so it can use
 * node/npm/npx directly when calling tools.
 */
export function buildNodeRuntimeHint(): string | null {
  if (!isNodeInstalled()) {
    return null;
  }

  const nodePath = getNodeBinaryPath();
  const nodeBinDir = path.dirname(nodePath);

  return `[Node.js Runtime]
A managed Node.js runtime is available in your environment and has been added to PATH.
- Node.js binary: ${nodePath}
- Bin directory (contains node, npm, npx): ${nodeBinDir}
You can use \`node\`, \`npm\`, and \`npx\` commands directly in your tool calls.
If PATH resolution fails, use the full path: ${nodePath}`;
}

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
 * 构建草稿箱使用指令（优化版）
 * Build drafts box usage instructions for Agent (optimized)
 *
 * 通过系统提示词告诉 Agent：
 * 1. 使用 @draft/@final 标记显式声明文件意图
 * 2. 中间产物写入 .drafts/ 目录
 * 3. 最终结果文件写入工作空间根目录
 *
 * Via system prompt, instruct the Agent:
 * 1. Use @draft/@final markers to declare file intent explicitly
 * 2. Intermediate artifacts go to .drafts/
 * 3. Final deliverables go to workspace root
 */
export function buildDraftsInstruction(workspace: string): string {
  const draftsPath = `${workspace}/${DRAFTS_DIR_NAME}`;

  return `[CRITICAL: File Intent Marking System - MANDATORY]

Your workspace is: ${workspace}
A drafts directory exists at: ${draftsPath}

**Drafts path mapping**:
- "草稿箱" and "Drafts" are UI display names only.
- The real filesystem directory is always ${draftsPath}
- When the user says "copy/move to 草稿箱" or "copy/move to Drafts", use ${DRAFTS_DIR_NAME}/
- Never create or use "drafts/", "Drafts/", or "草稿箱/" directories.
- Correct command example: \`cp file.ext ${DRAFTS_DIR_NAME}/\`

**CORE RULE: When creating files using write() tool, ALWAYS add intent markers**

**Intent Markers** (add as FIRST LINE in file content):
- '# @final' → Final deliverable (user-requested output)
- '# @draft' → Intermediate/temporary file (helper scripts, temp data)

**Language-specific comment syntax**:
- Python/Shell/Ruby/Perl: '#' prefix (e.g., '# @final')
- JavaScript/TypeScript/Go/C++: '//' prefix (e.g., '// @final')
- HTML/XML: '<!-- ... -->' format (e.g., '<!-- @final -->')
- Markdown/Config files: '#' prefix (default)

**Decision Logic** (apply to EVERY file you create):

Ask yourself: "Is this file what the user ultimately wants?"

**YES → @final** (this file IS what user requested)
- User requests "Python script for X" → script.py = @final
- User requests "Word document about X" → report.docx = @final
- User requests "PDF report" → report.pdf = @final
- User requests "data analysis script" → analysis.py = @final

**NO → @draft** (this file HELPS produce what user wants)
- User requests Word document, you create JS script to generate it → script.js = @draft
- User requests PDF, you create Python conversion script → convert.py = @draft
- User requests analysis report, you create data processing script → process.py = @draft
- User requests output in format X, you create script to produce X → script = @draft

**Key rule**: If you create a SCRIPT that produces user's final output → SCRIPT = @draft, OUTPUT = @final

**Examples for write() tool**:

✅ Correct - User requests Python script:
  write(file_path="analysis.py", content="# @final\nimport pandas...")

✅ Correct - User requests Word document, you create generation script:
  write(file_path="generate_report.js", content="// @draft - generates report.docx\n...")
  write(file_path="report.docx", content="...") ← @final or no marker

✅ Correct - User requests PDF, you create conversion script:
  write(file_path="convert_to_pdf.py", content="# @draft - converts docx to pdf\n...")

❌ Wrong - User requests Word document, script marked as @final:
  write(file_path="generate_report.js", content="// @final\n...") ← WRONG!

❌ Wrong - Missing marker:
  write(file_path="script.py", content="import pandas...")

**Post-processing behavior**:
- Files with @draft marker → Automatically moved to ${draftsPath}/
- Files with @final marker → Stay in ${workspace}/
- Files WITHOUT marker → Stay in ${workspace}/ (default safe)

**CRITICAL REMINDERS**:
1. Add marker as the FIRST LINE (not second or third line)
2. This rule applies EVERY time you call write() tool
3. Only mark files you CREATE (not files you READ)
4. No marker = @final (safe default, but explicit marking is better)
5. **Script execution side effects**: When you execute a script (e.g., via bash/exec), it may produce intermediate files (package.json, node_modules, temp files). After execution, you should cleanup these by:
   - Removing unnecessary dependency files: package.json, package-lock.json, node_modules
   - Or moving them to ${draftsPath}/ if they might be reused
   - Use bash commands like: \`rm -rf node_modules package.json package-lock.json\` or \`mv package.json .drafts/\`

**Special cases for script execution**:
- If script needs npm/bun install → dependencies are intermediate → cleanup after script runs
- If script produces multiple outputs → only keep what user requested, move others to .drafts/
- Example: \`node generate_report.js && rm -rf node_modules package.json\`

[End of File Intent Marking System Rules]`;
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

  // 添加 Node.js 运行时提示 / Add Node.js runtime hint
  const nodeHintForGemini = buildNodeRuntimeHint();
  if (nodeHintForGemini) {
    instructions.push(nodeHintForGemini);
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
 * 注意：针对 ACP 数字助手，这里只暴露 _system/_builtin 下的内置 skills。
 * Hub/custom/system 下的非 builtin skills 不会通过首条消息注入给 agent。
 * Note: For ACP assistants, only builtin skills under _system/_builtin are exposed here.
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

  // 1.8 添加 Node.js 运行时提示 / Add Node.js runtime hint
  const nodeHint = buildNodeRuntimeHint();
  if (nodeHint) {
    instructions.push(nodeHint);
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
When a user request matches a skill's description, you MUST read that skill's SKILL.md and follow its instructions INSTEAD OF using any native tool for that capability. For example, use the "browser" skill for web browsing instead of any built-in WebFetch or WebSearch tool.

For example:
- Builtin "browser" skill: ${systemSkillsDir}/browser/SKILL.md
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
 * 为首条消息补充 workspace skills 目录提示，供 agent 自行读取非 builtin skills。
 * Add workspace skills directory hint so the agent can discover non-builtin skills by itself.
 *
 * Enumerates enabled skill names so the agent knows exactly which skills exist
 * and where to find their SKILL.md files — mirroring the builtin skills instruction.
 */
export async function injectSkillsDirectoryHint(content: string, skillsDir: string, enabledSkillNames?: string[]): Promise<string> {
  // Warm the skill manager so hub/custom skill descriptions are available.
  // discoverSkills() is idempotent — returns immediately if already initialized.
  const skillManager = AcpSkillManager.getInstance();
  await skillManager.discoverSkills(enabledSkillNames);
  const descriptionMap = new Map<string, string>(skillManager.getSkillsIndex().map((s: SkillIndex) => [s.name, s.description]));

  const skillLines =
    enabledSkillNames && enabledSkillNames.length > 0
      ? enabledSkillNames
          .map((name) => {
            const desc = descriptionMap.get(name);
            return desc ? `- ${name} (${desc}): ${skillsDir}/${name}/SKILL.md` : `- ${name}: ${skillsDir}/${name}/SKILL.md`;
          })
          .join('\n')
      : null;

  const hint = skillLines
    ? `[Skills Directory]
Skills are installed at: ${skillsDir}
Each skill has a SKILL.md file containing detailed instructions. When a user request matches a skill's description, you MUST read that skill's SKILL.md and follow its instructions INSTEAD OF using any native tool for that capability.

Available workspace skills:
${skillLines}

When skill instructions reference relative paths like "skills/{name}/scripts/...", resolve them as "${skillsDir}/{name}/scripts/...".`
    : `[Skills Directory]
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

  // 添加 Node.js 运行时提示 / Add Node.js runtime hint
  const nodeHintForGeminiIndex = buildNodeRuntimeHint();
  if (nodeHintForGeminiIndex) {
    instructions.push(nodeHintForGeminiIndex);
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
