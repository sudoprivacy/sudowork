import { mainWarn } from '@process/utils/mainLogger';
import type { ILocalKbSearchHit } from '@/common/types/localKnowledgeBase';

const MAX_LOCAL_KB_HITS = 8;
const MAX_LOCAL_KB_SPACES = 6;
const MAX_HIT_TEXT_LENGTH = 700;

export class KnowledgeRetrievalService {
  async augmentWithLocalKnowledge(query: string, message: string): Promise<string> {
    const context = await this.retrieveLocalKnowledgeContext(query);
    return context ? `${context}\n\n${message}` : message;
  }

  async retrieveLocalKnowledgeContext(query: string): Promise<string | null> {
    const q = query.trim();
    if (!q) return null;

    try {
      const { localKnowledgeBaseService } = await import('../local-kb/LocalKnowledgeBaseService');
      const spaces = localKnowledgeBaseService
        .listSpaces()
        .filter((space) => space.buildStatus === 'ready')
        .slice(0, MAX_LOCAL_KB_SPACES);
      if (spaces.length === 0) return null;

      const result = await localKnowledgeBaseService.searchMany(
        spaces.map((space) => space.id),
        q
      );
      const hits = result.hits.slice(0, MAX_LOCAL_KB_HITS);
      if (hits.length === 0) return null;

      return formatLocalKnowledgeContext(hits);
    } catch (err) {
      mainWarn('KnowledgeRetrievalService', 'local KB retrieval failed; continuing without context:', err);
      return null;
    }
  }
}

export function formatLocalKnowledgeContext(hits: ILocalKbSearchHit[]): string {
  const body = hits
    .map((hit, index) => {
      const text = escapeKnowledgeContextText(hit.text.replace(/\s+/g, ' ').trim().slice(0, MAX_HIT_TEXT_LENGTH));
      return [`[${index + 1}] ${escapeKnowledgeContextText(hit.title)}`, `source: local-kb://${encodeURIComponent(hit.spaceId)}/${encodeURIComponent(hit.file)}:${hit.lineNo}`, `match: ${hit.source}`, text].join('\n');
    })
    .join('\n\n');
  return `<knowledge_context source="local_knowledge_base">\n${body}\n</knowledge_context>`;
}

function escapeKnowledgeContextText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const knowledgeRetrievalService = new KnowledgeRetrievalService();
