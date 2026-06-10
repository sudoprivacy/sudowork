/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Wire format for "files the AI just generated this turn", shared between the
 * main process (AcpAgent / RemoteAgent / future Codex handlers) and the
 * renderer chat view (MessagetText.tsx → GeneratedFileCard).
 *
 * Design choices:
 *  - The marker is appended to an assistant `content` string so it travels
 *    through the existing message pipeline + DB persistence with zero schema
 *    change. The renderer's MessagetText already splits out a `[[NEXUS_FILES]]`
 *    marker (for user-side uploads); this is its sibling for assistant-side
 *    deliverables, kept on a separate marker so the two never collide.
 *  - Payload is JSON (not newline-separated paths) so we can add `mime`,
 *    `size`, future thumbnail hints, etc. without re-parsing every consumer.
 *  - Envelope carries an explicit version so older renderers can detect
 *    "newer than I understand" and degrade gracefully.
 */

export const NEXUS_GENERATED_FILES_MARKER = '[[NEXUS_GENERATED_FILES]]';

/** Single deliverable surfaced to the renderer. */
export interface GeneratedFileEntry {
  /** Absolute path on disk. */
  path: string;
  /** Path relative to the conversation workspace (when resolvable). */
  relativePath?: string;
  /**
   * What the agent did to this file in this turn.
   *  - 'create': new file
   *  - 'edit'  : pre-existing file modified
   */
  kind: 'create' | 'edit';
  /** Lowercase extension without leading dot (e.g. 'html', 'pptx'); '' if none. */
  ext: string;
  /** Best-effort MIME type. Useful for icon / renderer dispatch. */
  mime?: string;
  /** File size in bytes at marker emit time. */
  size?: number;
  /** When the agent finished this write. ms since epoch. */
  createdAt: number;
}

/** Top-level envelope carried by the marker payload. */
export interface GeneratedFilesPayload {
  /** Schema version. Bump on incompatible changes; readers must tolerate unknown >v. */
  v: 1;
  files: GeneratedFileEntry[];
}

/**
 * Append a marker + payload to an assistant `content` string. Idempotent for
 * the empty-files case: returns the original string when files is empty.
 */
export function appendGeneratedFilesMarker(content: string, files: GeneratedFileEntry[]): string {
  if (!files || files.length === 0) return content;
  const payload: GeneratedFilesPayload = { v: 1, files };
  const trimmed = content.replace(/\s+$/, '');
  // Two newlines so the marker doesn't visually merge into the trailing paragraph if rendered.
  return `${trimmed}\n\n${NEXUS_GENERATED_FILES_MARKER}${JSON.stringify(payload)}`;
}

/** Result of splitting a string at the marker boundary. */
export interface ParsedGeneratedFiles {
  /** The original content with the marker (and everything after) removed. */
  textBefore: string;
  /** Parsed files when the marker was found and decodable; empty array otherwise. */
  files: GeneratedFileEntry[];
  /** True only when a marker was present AND its payload parsed cleanly. */
  ok: boolean;
}

/**
 * Split an assistant `content` string at the first occurrence of the marker
 * and decode the payload. Tolerant: malformed JSON or unknown schema version
 * returns `ok: false, files: []` but still strips the marker text so it
 * doesn't show through to the user.
 */
export function parseGeneratedFilesMarker(content: string): ParsedGeneratedFiles {
  const markerIndex = content.indexOf(NEXUS_GENERATED_FILES_MARKER);
  if (markerIndex === -1) {
    return { textBefore: content, files: [], ok: false };
  }
  const textBefore = content.slice(0, markerIndex).replace(/\s+$/, '');
  const afterMarker = content.slice(markerIndex + NEXUS_GENERATED_FILES_MARKER.length).trim();
  if (!afterMarker) {
    return { textBefore, files: [], ok: false };
  }
  try {
    const parsed = JSON.parse(afterMarker) as Partial<GeneratedFilesPayload>;
    if (!parsed || typeof parsed !== 'object' || parsed.v !== 1 || !Array.isArray(parsed.files)) {
      return { textBefore, files: [], ok: false };
    }
    const files = parsed.files.filter((f): f is GeneratedFileEntry => {
      return !!f && typeof f.path === 'string' && (f.kind === 'create' || f.kind === 'edit') && typeof f.createdAt === 'number';
    });
    return { textBefore, files, ok: files.length > 0 };
  } catch {
    return { textBefore, files: [], ok: false };
  }
}

/**
 * Strip the marker WITHOUT decoding it. Useful for any code path that wants
 * the human-readable text alone (search indexing, copy-to-clipboard, etc.).
 */
export function stripGeneratedFilesMarker(content: string): string {
  const markerIndex = content.indexOf(NEXUS_GENERATED_FILES_MARKER);
  if (markerIndex === -1) return content;
  return content.slice(0, markerIndex).replace(/\s+$/, '');
}

/**
 * Common MIME hints by extension. Kept conservative (covers everything the
 * existing PreviewPanel renders, plus a few common extras the chip can show
 * with a generic icon).
 */
const MIME_BY_EXT: Record<string, string> = {
  // Text & code
  html: 'text/html',
  htm: 'text/html',
  md: 'text/markdown',
  txt: 'text/plain',
  json: 'application/json',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  csv: 'text/csv',
  // Office
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // Images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

/** Look up a MIME hint for an extension; returns undefined for unknowns. */
export function mimeForExtension(ext: string): string | undefined {
  return MIME_BY_EXT[ext.toLowerCase()];
}

/** Extract the lowercase extension without leading dot. '' when no extension. */
export function extractExtension(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  const basename = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
  const dot = basename.lastIndexOf('.');
  if (dot <= 0) return '';
  return basename.slice(dot + 1).toLowerCase();
}
