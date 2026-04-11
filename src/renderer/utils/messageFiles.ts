import { NEXUS_FILES_MARKER } from '@/common/constants';
import type { FileOrFolderItem } from '@/renderer/types/files';
import { isTemporaryWorkspace } from '@/renderer/utils/workspace';

export const collectSelectedFiles = (uploadFile: string[], atPath: Array<string | FileOrFolderItem>): string[] => {
  const atPathFiles = atPath.map((item) => (typeof item === 'string' ? item : item.path)).filter(Boolean);
  return Array.from(new Set([...uploadFile, ...atPathFiles]));
};

/** Filter out internal temp workspace paths that should not be shown to users */
export const filterUserVisibleFiles = (paths: string[]): string[] => paths.filter((p) => !isTemporaryWorkspace(p));

/** Filter atPath items whose path is a temp workspace (for SendBox display) */
export const filterUserVisibleAtPath = <T extends Array<string | FileOrFolderItem>>(items: T): T =>
  items.filter((item) => {
    const path = typeof item === 'string' ? item : item.path;
    return path && !isTemporaryWorkspace(path);
  }) as T;

export const buildDisplayMessage = (input: string, files: string[], workspacePath: string): string => {
  const visibleFiles = filterUserVisibleFiles(files);
  if (!visibleFiles.length) return input;
  const displayPaths = visibleFiles.map((filePath) => {
    // bdpan remote files: show as workspace/<filename> (file will be downloaded before send)
    if (filePath.startsWith('bdpan://')) {
      const raw = filePath.slice('bdpan://'.length);
      const remotePath = raw.includes('?') ? raw.slice(0, raw.indexOf('?')) : raw;
      const fileName = remotePath.split('/').filter(Boolean).pop() || remotePath;
      return workspacePath ? `${workspacePath}/${fileName}` : fileName;
    }
    if (!workspacePath) return filePath;
    const isAbsolute = filePath.startsWith('/') || /^[A-Za-z]:/.test(filePath);
    if (isAbsolute) {
      const parts = filePath.split(/[\\/]/);
      let fileName = parts[parts.length - 1] || filePath;
      return `${workspacePath}/${fileName}`;
    }
    return `${workspacePath}/${filePath}`;
  });
  return `${input}\n\n${NEXUS_FILES_MARKER}\n${displayPaths.join('\n')}`;
};
