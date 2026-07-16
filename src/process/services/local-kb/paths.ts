import fs from 'fs';
import path from 'path';
import { getDataPath, ensureDirectory } from '@process/utils';

export const LOCAL_KB_DIR_NAME = 'sudowork/local-kb';
export const LOCAL_KB_SPACE_INDEX_FILE = 'SPACE.md';
export const LOCAL_KB_META_FILE = '_sudowork_meta.json';
export const LOCAL_KB_IMAGES_FILE = '_sudowork_images.md';
export const LOCAL_KB_VECTOR_BIN_FILE = '_sudowork_index.bin';
export const LOCAL_KB_VECTOR_JSONL_FILE = '_sudowork_index.jsonl';

export function getLocalKbRootDir(): string {
  return path.join(getDataPath(), LOCAL_KB_DIR_NAME);
}

export function getLocalKbDocsDir(): string {
  return path.join(getLocalKbRootDir(), 'docs');
}

export function getLocalKbSpacesDir(): string {
  return path.join(getLocalKbRootDir(), 'spaces');
}

export function getLocalKbModelsDir(): string {
  return path.join(getLocalKbRootDir(), 'models');
}

export function getLocalKbStageDir(): string {
  return path.join(getLocalKbRootDir(), '.stage');
}

export function getLocalKbDocDir(docId: string): string {
  return path.join(getLocalKbDocsDir(), docId);
}

export function getLocalKbDocOriginalDir(docId: string): string {
  return path.join(getLocalKbDocDir(docId), 'original');
}

export function getLocalKbDocExtractedDir(docId: string): string {
  return path.join(getLocalKbDocDir(docId), 'extracted');
}

export function getLocalKbDocExtractedPath(docId: string): string {
  return path.join(getLocalKbDocExtractedDir(docId), `${docId}.md`);
}

export function getLocalKbSpaceDir(spaceId: string): string {
  return path.join(getLocalKbSpacesDir(), spaceId);
}

export function getLocalKbSpaceStagePath(spaceId: string, jobId: string): string {
  return path.join(getLocalKbStageDir(), `${spaceId}.${jobId}`);
}

export function ensureLocalKbDirectories(): void {
  for (const dir of [getLocalKbDocsDir(), getLocalKbSpacesDir(), getLocalKbModelsDir(), getLocalKbStageDir()]) {
    ensureDirectory(dir);
  }
}

export function sanitizeLocalKbFileName(name: string): string {
  return (
    name
      .split('')
      .map((char) => {
        const code = char.charCodeAt(0);
        return char === '/' || char === '\\' || code < 32 ? '_' : char;
      })
      .join('')
      .slice(0, 200) || 'document'
  );
}

export function isPathInside(parent: string, child: string): boolean {
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(child);
  return resolvedChild === resolvedParent || resolvedChild.startsWith(`${resolvedParent}${path.sep}`);
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.stat(filePath);
    return true;
  } catch {
    return false;
  }
}
