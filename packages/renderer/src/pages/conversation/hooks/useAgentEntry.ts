import { Message } from '@arco-design/web-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { clearGuidDraft } from '@renderer/pages/guid/hooks/useGuidDraft';
import { emitter } from '@renderer/utils/emitter';
import { useConversationHistory } from '../context/ConversationHistoryContext';
import { getLatestAgentConversation } from '../utils/agentIdentity';

/** Enter the latest Session for this Agent, or its first draft when history is empty. */
export function useAgentEntry() {
  const { getFreshConversations, scopeKey } = useConversationHistory();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [openingReference, setOpeningReference] = useState<string | null>(null);
  const pending = useRef<string | null>(null);
  const request = useRef(0);

  useEffect(() => {
    pending.current = null;
    setOpeningReference(null);
    return () => {
      request.current += 1;
    };
  }, [scopeKey]);

  const onOpenAgent = useCallback(
    async (reference: string, onPrepare?: () => Promise<unknown>) => {
      if (pending.current) return;
      pending.current = reference;
      setOpeningReference(reference);
      const epoch = ++request.current;
      try {
        await onPrepare?.();
        if (epoch !== request.current) return;
        const conversations = await getFreshConversations();
        if (epoch !== request.current) return;
        const latest = getLatestAgentConversation(conversations, reference);
        clearGuidDraft();
        emitter.emit('guid.reset');
        void navigate(latest ? `/conversation/${encodeURIComponent(latest.id)}` : `/guid?assistant=${encodeURIComponent(reference)}`);
      } catch {
        if (epoch === request.current) Message.error(t('agent.mine.openFailed'));
      } finally {
        if (epoch === request.current) {
          pending.current = null;
          setOpeningReference(null);
        }
      }
    },
    [getFreshConversations, navigate, t]
  );

  return { openingReference, onOpenAgent };
}
