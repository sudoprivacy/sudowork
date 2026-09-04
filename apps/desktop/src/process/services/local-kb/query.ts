import fs from 'fs/promises';
import path from 'path';
import type { ILocalKbSearchHit, ILocalKbSearchResult } from '@/common/types/localKnowledgeBase';
import { LOCAL_KB_SPACE_INDEX_FILE } from './paths';
import { searchLocalKbVector } from './vectorIndex';

const MIN_VECTOR_SCORE = 0.25;
const VECTOR_SEARCH_TIMEOUT_MS = 1_500;

export async function searchLocalKbSpaceGrep(spaceId: string, spaceDir: string, query: string, limit = 100): Promise<ILocalKbSearchResult> {
  const startedAt = Date.now();
  const grepHits: ILocalKbSearchHit[] = [];
  const q = query.trim().toLowerCase();
  if (!q) {
    return { mode: 'grep-only', hits: [], tookMs: Date.now() - startedAt, spaceIds: [spaceId] };
  }

  let entries: Array<{ name: string; isFile: () => boolean }>;
  try {
    entries = await fs.readdir(spaceDir, { withFileTypes: true });
  } catch {
    return { mode: 'grep-only', hits: [], tookMs: Date.now() - startedAt, spaceIds: [spaceId] };
  }

  const files = entries
    .filter((entry) => entry.isFile() && (entry.name === LOCAL_KB_SPACE_INDEX_FILE || /^chunk-\d+-.+\.md$/i.test(entry.name)))
    .map((entry) => entry.name)
    .sort();

  for (const file of files) {
    const content = await fs.readFile(path.join(spaceDir, file), 'utf8').catch((): string => '');
    if (!content) continue;
    const title = extractTitle(content, file);
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? '';
      if (!line.toLowerCase().includes(q)) continue;
      grepHits.push({
        spaceId,
        file,
        title,
        lineNo: i + 1,
        text: line.trim(),
        score: 1 / (grepHits.length + 1),
        source: 'grep',
      });
      if (grepHits.length >= limit) {
        break;
      }
    }
    if (grepHits.length >= limit) {
      break;
    }
  }

  const vecHits = await searchVectorWithTimeout(spaceDir, query);
  if (vecHits.length === 0) {
    return { mode: 'grep-only', hits: grepHits.slice(0, limit), tookMs: Date.now() - startedAt, spaceIds: [spaceId] };
  }

  const fused = rrfFuse(
    grepHits,
    vecHits.map((hit) => ({
      spaceId,
      file: hit.file,
      title: hit.title,
      lineNo: hit.startLine,
      text: `[vec] ${hit.text.replace(/\s+/g, ' ').slice(0, 240)}`,
      score: hit.score,
      source: 'vec' as const,
    }))
  ).slice(0, limit);
  return { mode: 'hybrid', hits: fused, tookMs: Date.now() - startedAt, spaceIds: [spaceId] };
}

async function searchVectorWithTimeout(spaceDir: string, query: string): Promise<Awaited<ReturnType<typeof searchLocalKbVector>>> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const vectorPromise = searchLocalKbVector(spaceDir, query)
    .then((hits) => hits.filter((hit) => hit.score >= MIN_VECTOR_SCORE))
    .catch((): Awaited<ReturnType<typeof searchLocalKbVector>> => []);
  const timeoutPromise = new Promise<Awaited<ReturnType<typeof searchLocalKbVector>>>((resolve) => {
    timeout = setTimeout(() => resolve([]), VECTOR_SEARCH_TIMEOUT_MS);
  });
  const hits = await Promise.race([vectorPromise, timeoutPromise]);
  if (timeout) clearTimeout(timeout);
  return hits;
}

export function extractTitle(markdown: string, fallbackFile: string): string {
  const fm = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  if (fm?.[1]) {
    for (const line of fm[1].split('\n')) {
      const match = line.match(/^title:\s*(.+?)\s*$/);
      if (match?.[1]) return match[1].replace(/^['"]|['"]$/g, '').trim();
    }
  }
  const h1 = markdown.match(/^\s*#\s+(.+?)\s*$/m);
  return h1?.[1]?.trim() || fallbackFile.replace(/\.md$/i, '');
}

export function rrfFuse(grepHits: ILocalKbSearchHit[], vecHits: ILocalKbSearchHit[], k = 60): ILocalKbSearchHit[] {
  const map = new Map<string, ILocalKbSearchHit>();
  grepHits.forEach((hit, rank) => {
    const key = `${hit.file}:${hit.lineNo}`;
    map.set(key, { ...hit, score: 1 / (k + rank), source: 'grep' });
  });
  vecHits.forEach((hit, rank) => {
    const key = `${hit.file}:${hit.lineNo}`;
    const inc = 1 / (k + rank);
    const existing = map.get(key);
    if (existing) {
      map.set(key, { ...existing, score: existing.score + inc, source: 'both' });
    } else {
      map.set(key, { ...hit, score: inc, source: 'vec' });
    }
  });
  return [...map.values()].sort((a, b) => b.score - a.score);
}
