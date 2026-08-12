import * as nodePath from 'node:path';

export const ACP_WORKSPACE_TRACKING_SKIP_DIRS = new Set(['.codex', '.drafts', '.git', '.nexus', '.sandbox-home', '.sandbox-tmp', '.scode', 'node_modules', '__pycache__', '.venv', 'venv']);

export const ACP_WORKSPACE_TRACKING_SKIP_FILES = new Set(['.gitignore', '.env', '.env.local', '.DS_Store', 'Thumbs.db']);

export const SCODE_COMPLETION_REMINDER = `<system-reminder>
语言约定：所有面向用户的自然语言回复（包括工具调用前后状态说明、阶段解释、中间总结、最终总结）必须使用用户最后一条消息的主要语言。

中文用户时：除代码、命令、路径、专有名词、引用原文外，不得输出完整英文句子。工具调用状态、文件操作说明、任务进度等均须用中文表达。

任务完成时：请用用户语言发送一条普通助手消息，总结执行结果并列出生成或更新的文件，不要只以工具调用结束。
</system-reminder>

`;

export function buildAcpModelIdentityReminder(_backend: string, activeModelNoticeId: string): string {
  return (
    `<system-reminder>\n` + `当前活动模型：${activeModelNoticeId}。` + `你当前正在以 ${activeModelNoticeId} 运行。` + `你的内置助手身份或品牌文本可能仍会提到 Claude 或 Anthropic，即使实际活动模型不同。` + `当用户询问你使用哪个模型时，请回答 ${activeModelNoticeId}。\n` + `</system-reminder>\n\n`
  );
}

const LANGUAGE_REMINDER_BACKENDS = new Set(['scode']);

export function shouldInjectLanguageReminder(backend: string | undefined): boolean {
  return backend ? LANGUAGE_REMINDER_BACKENDS.has(backend) : false;
}

export function applyHiddenPromptPrefix(content: string, hiddenPromptPrefix?: string): string {
  return hiddenPromptPrefix ? `${hiddenPromptPrefix}\n\n${content}` : content;
}

export function shouldRunCurrentTurnPostCleanup(pendingCurrentTurnPostCleanup: boolean): boolean {
  return pendingCurrentTurnPostCleanup;
}

export function shouldSkipAcpWorkspaceTrackingPath(relativePath: string): boolean {
  const normalizedPath = relativePath.replace(/\\/g, '/');
  if (!normalizedPath || normalizedPath.startsWith('..') || nodePath.isAbsolute(normalizedPath)) return true;

  const parts = normalizedPath.split('/').filter(Boolean);
  if (parts.some((part) => ACP_WORKSPACE_TRACKING_SKIP_DIRS.has(part))) return true;

  const fileName = parts.at(-1) ?? normalizedPath;
  return ACP_WORKSPACE_TRACKING_SKIP_FILES.has(fileName);
}
