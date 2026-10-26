/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

/** Moss caps each decoded file at 50 MB. */
export const MAX_DOC_SIZE = 50 * 1024 * 1024;

/**
 * Raw bytes per folder-upload request. Moss caps the JSON body at 200 MB; base64
 * inflates by 4/3, so ~100 MB raw keeps a comfortable margin.
 */
export const FOLDER_BATCH_BYTES = 100 * 1024 * 1024;

/** Read a File as base64 (no `data:` prefix). */
export async function fileToBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatTime(ms: number | null | undefined): string {
  if (!ms) return '-';
  return new Date(ms).toLocaleString();
}

/** Split files into batches whose raw size stays under `limit` (an oversized file gets its own batch). */
export function batchBySize<T extends { size: number }>(files: T[], limit = FOLDER_BATCH_BYTES): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let currentSize = 0;
  for (const file of files) {
    if (current.length > 0 && currentSize + file.size > limit) {
      batches.push(current);
      current = [];
      currentSize = 0;
    }
    current.push(file);
    currentSize += file.size;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** Top-level folder name and the path below it, from a `webkitRelativePath` like `docs/a/b.md`. */
export function splitRelativePath(relativePath: string): { folderName: string; innerPath: string } {
  const parts = relativePath.split('/').filter(Boolean);
  if (parts.length <= 1) return { folderName: '', innerPath: parts[0] ?? relativePath };
  return { folderName: parts[0], innerPath: parts.slice(1).join('/') };
}

/** Arco Select `filterOption`: case-insensitive match on the option's text. */
export function filterOptionByText(input: string, option: unknown): boolean {
  const text = (option as { props?: { children?: unknown } } | undefined)?.props?.children;
  return String(text ?? '')
    .toLowerCase()
    .includes(input.toLowerCase());
}
