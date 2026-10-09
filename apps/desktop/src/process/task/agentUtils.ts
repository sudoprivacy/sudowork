/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { getBuiltinSkillsDir, loadSkillsContent } from '@process/initStorage';
import { CRON_RESTRICTED_INSTRUCTION, isCronSkillAllowed } from '@process/services/cron/cronPolicy';
import type { PresetAgentType } from '@/types/acpTypes';
import { getNodeBinaryPath, isNodeInstalled } from '@process/services/claudeCli/NodeRuntimeService';
import { AcpSkillManager, buildSkillsIndexText, type SkillIndex } from './AcpSkillManager';

/** mcporter CLI 路径（解压后的 JS 文件，跨平台相同） */
const MCPORTER_CLI_PATH = path.join(os.homedir(), '.nexus', 'mcporter', 'package', 'node_modules', 'mcporter', 'dist', 'cli.js');

/** mcporter 配置文件路径 */
const MCPORTER_CONFIG_PATH = path.join(os.homedir(), '.nexus', 'mcporter', 'mcporter.json');

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
    if (!fs.existsSync(MCPORTER_CONFIG_PATH)) {
      return null;
    }
    const content = fs.readFileSync(MCPORTER_CONFIG_PATH, 'utf-8');
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
  const mcporterCommand = `${nodePath} ${MCPORTER_CLI_PATH}`;

  return `[MCP Integration]
When working with external services or APIs, use mcporter CLI to discover MCP tools available in your environment.

Discovery workflow:
1. List available MCP servers:
   ${mcporterCommand} list --output json
   (Environment: MCPORTER_CONFIG=${MCPORTER_CONFIG_PATH})

2. Discover tools from a server:
   ${mcporterCommand} list <server_name> --schema --output json

3. Call a tool:
   ${mcporterCommand} call <server_name>.<tool_name> key=value --output json

Example: If user asks about document operations, first run 'mcporter list' to see available MCP servers, then discover tools from relevant servers.

The mcporter config is at: ${MCPORTER_CONFIG_PATH}`;
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

export function buildDraftsInstruction(workspace: string): string {
  return `[Workspace files]
Workspace: ${workspace}
Drafts (草稿箱): ${workspace}/.drafts

Create temporary scripts, intermediate data and dependencies directly in .drafts/.
Keep final deliverables at the user-requested workspace path. Scripts in .drafts must
use explicit workspace output paths, not derive outputs from the script directory.
Keep file contents valid: never add @final/@draft markers to JSON, CSV or binary
files. No intent comments are required in any format. Preserve shebangs, encoding
and XML declarations, uploaded inputs, and existing workspace files.
Keep reusable drafts after a turn or cancellation. Do not delete dependencies or
move files still needed by another step. Use .drafts/ for the 草稿箱 UI name.
Before finishing, use moss_declare_artifacts when available to declare each newly
generated final or draft file. Mark release=true only for drafts that no later step
needs at the current path; this allows safe physical archival. Declare final files
only after validating their contents; JSON must parse with a standard JSON parser.
If validation fails, repair once and revalidate, otherwise report the failure.
[End workspace files]`;
}

/**
 * Build the [Output Convention] block — universal across all backends.
 *
 * Two-line summary the model needs to internalize:
 *   - Deliverables: directly at workspace root, with a DESCRIPTIVE filename.
 *   - Intermediates: anywhere ELSE (OS temp dir preferred, workspace subdir
 *     acceptable). Don't put them at workspace root, don't delete them
 *     yourself — sudowork hides them from the user automatically.
 *
 * This convention reflects Claude Cowork's observed behavior: the user sees
 * one deliverable file (e.g. `数牍科技公司介绍.pptx`) at the working folder
 * root, never intermediate slide frames / helper data.
 */
export function buildOutputConventionInstruction(workspace: string): string {
  return `[Output Convention]

When you generate files for the user:

DELIVERABLES — outputs the user explicitly asked for. Save them directly at
the workspace root (${workspace}/) with a DESCRIPTIVE filename matching the
user's request:

  ${workspace}/数牍科技公司介绍.pptx
  ${workspace}/q1-sales-review.docx
  ${workspace}/team-logo.png

Do NOT use placeholder names like "final.pptx", "output.docx", "result.csv",
"untitled.pdf". The filename must describe the content.

INTERMEDIATE files — helper scripts, working JSON and temporary data — belong
in ${workspace}/.drafts/ from creation. Preserve them across turns and cancellation.
Use explicit workspace paths for final outputs produced by scripts in .drafts/.
Keep all file formats valid. Do not insert classification comments into JSON,
CSV or binary files. A file at the workspace root is not automatically final.

[End of Output Convention]`;
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
    instructions.push(buildOutputConventionInstruction(config.workspace));
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
    instructions.push(buildOutputConventionInstruction(config.workspace));
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

  // Org policy: when client cron is disabled (enterprise client_cron_enabled=false),
  // the cron skill must NOT be advertised — so the agent never attempts it.
  const cronAllowed = await isCronSkillAllowed();
  const builtinSkillsIndex = skillManager.getBuiltinSkillsIndex().filter((s) => cronAllowed || s.name !== 'cron');
  if (builtinSkillsIndex.length > 0) {
    const systemSkillsDir = getBuiltinSkillsDir();
    const indexText = buildSkillsIndexText(builtinSkillsIndex);
    const cronExampleLine = cronAllowed ? `\n- Builtin "cron" skill: ${systemSkillsDir}/cron/SKILL.md` : '';

    // 告诉 Agent 只从 builtin skills 目录按需读取
    // Tell Agent to read only from the builtin skills directory on demand
    const skillsInstruction = `${indexText}

[Skills Location]
Builtin skills are stored at:
- ${systemSkillsDir}/{skill-name}/SKILL.md

Each skill has a SKILL.md file containing detailed instructions.
When a user request matches a skill's description, you MUST read that skill's SKILL.md and follow its instructions INSTEAD OF using any native tool for that capability. For example, use the "browser" skill for web browsing instead of any built-in WebFetch or WebSearch tool.

For example:
- Builtin "browser" skill: ${systemSkillsDir}/browser/SKILL.md${cronExampleLine}

Skill capabilities are subject to organization policy: if the system refuses a skill command as disabled by the organization, relay the refusal to the user and do not retry.`;

    instructions.push(skillsInstruction);
  }

  // Explicit creation ban: when cron is disabled, omitting the skill is not
  // enough — the agent may still hallucinate a created task from prior
  // knowledge. The instruction keeps the list/delete contract, since owners and
  // co-owners may still manage their existing jobs. (Omitted in personal mode
  // and when cron is enabled.)
  if (!cronAllowed) {
    instructions.push(CRON_RESTRICTED_INSTRUCTION);
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
            let skillFile = `${skillsDir}/${name}/SKILL.md`;
            try {
              // Agent file tools can read the target but may not traverse a
              // workspace junction through their virtual filesystem.
              skillFile = fs.realpathSync(skillFile);
            } catch {
              // Preserve discovery for a skill that is still being installed.
            }
            return desc ? `- ${name} (${desc}): ${skillFile}` : `- ${name}: ${skillFile}`;
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
