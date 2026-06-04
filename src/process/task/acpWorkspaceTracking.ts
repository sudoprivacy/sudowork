import * as nodePath from 'node:path';

export const ACP_WORKSPACE_TRACKING_SKIP_DIRS = new Set(['.codex', '.drafts', '.git', '.nexus', '.sandbox-home', '.sandbox-tmp', '.scode', 'node_modules', '__pycache__', '.venv', 'venv']);

export const ACP_WORKSPACE_TRACKING_SKIP_FILES = new Set(['.gitignore', '.env', '.env.local', '.DS_Store', 'Thumbs.db']);

export const SCODE_COMPLETION_REMINDER = `<system-reminder>
任务完成时，请始终使用用户提问的语言发送一条普通助手消息，总结执行结果并列出生成或更新的文件。不要只以工具调用结束。
</system-reminder>

`;

export function shouldSkipAcpWorkspaceTrackingPath(relativePath: string): boolean {
  const normalizedPath = relativePath.replace(/\\/g, '/');
  if (!normalizedPath || normalizedPath.startsWith('..') || nodePath.isAbsolute(normalizedPath)) return true;

  const parts = normalizedPath.split('/').filter(Boolean);
  if (parts.some((part) => ACP_WORKSPACE_TRACKING_SKIP_DIRS.has(part))) return true;

  const fileName = parts.at(-1) ?? normalizedPath;
  return ACP_WORKSPACE_TRACKING_SKIP_FILES.has(fileName);
}
