import { createContext, useCallback, useContext, useEffect, useMemo, type PropsWithChildren } from 'react';
import useSWR from 'swr';
import type { TChatConversation } from '@sudowork/common/storage';
import type { IMyAgent } from '@sudowork/common/personalAgents';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import { useAuth } from '@renderer/context/AuthContext';
import { addEventListener } from '@renderer/utils/emitter';

const EMPTY_CONVERSATIONS: TChatConversation[] = [];
const EMPTY_AGENTS: IMyAgent[] = [];
const ConversationHistoryContext = createContext<IConversationHistory | null>(null);

async function fetchConversations(): Promise<TChatConversation[]> {
  const data = await ipcBridge.database.getUserConversations.invoke({ page: 0, pageSize: 10000, includeAllExecutionTargets: true });
  if (!Array.isArray(data)) throw new Error('Conversation history unavailable');
  return data.filter((conversation) => conversation.extra?.isHealthCheck !== true);
}

/** Share one account-scoped history source across the sidebar and conversation header. */
export function ConversationHistoryProvider({ children }: PropsWithChildren) {
  const { user, ready, status } = useAuth();
  const scope = ready && (status === 'authenticated' || status === 'guest') ? [user?.id ?? 'local', user?.enterprise_code ?? '', user?.role ?? status] : null;
  const scopeKey = scope ? JSON.stringify(scope) : null;
  const history = useSWR(scope ? ['conversation.history', ...scope] : null, fetchConversations, { refreshInterval: 30_000 });
  const agentList = useSWR(scope && status === 'authenticated' ? ['conversation.agents', ...scope] : null, async () => {
    const result = await ipcBridge.eeclaw.getMyAgents.invoke();
    if (!result?.success || !Array.isArray(result.data)) throw new Error('Agent list unavailable');
    return result.data;
  });
  const { mutate: refreshHistory } = history;
  const { mutate: refreshAgents } = agentList;

  const getFreshConversations = useCallback(async () => {
    if (!scopeKey) throw new Error('Conversation history unavailable');
    const conversations = await refreshHistory(fetchConversations(), { revalidate: false, throwOnError: true });
    if (!conversations) throw new Error('Conversation history unavailable');
    return conversations;
  }, [scopeKey, refreshHistory]);

  const refresh = useCallback(async () => {
    await Promise.allSettled([refreshHistory(), refreshAgents()]);
  }, [refreshHistory, refreshAgents]);

  useEffect(() => {
    function onRefresh() {
      void refresh();
    }
    const removeLocalListener = addEventListener('chat.history.refresh', onRefresh);
    const removeBridgeListener = ipcBridge.database.conversationChanged.on(onRefresh);
    return () => {
      removeLocalListener();
      removeBridgeListener();
    };
  }, [refresh]);

  const value = useMemo(
    () => ({
      conversations: history.data ?? EMPTY_CONVERSATIONS,
      agents: agentList.data ?? EMPTY_AGENTS,
      isLoading: history.isLoading || agentList.isLoading,
      isLoadFailed: Boolean(history.error),
      isAgentsLoading: agentList.isLoading,
      isAgentsLoadFailed: Boolean(agentList.error),
      refresh,
      getFreshConversations,
      scopeKey,
    }),
    [history.data, agentList.data, history.isLoading, agentList.isLoading, history.error, agentList.error, refresh, getFreshConversations, scopeKey]
  );

  return <ConversationHistoryContext.Provider value={value}>{children}</ConversationHistoryContext.Provider>;
}

/** Read history without installing another poller or event subscription. */
export function useConversationHistory(): IConversationHistory {
  const history = useContext(ConversationHistoryContext);
  if (!history) throw new Error('useConversationHistory must be used within ConversationHistoryProvider');
  return history;
}

interface IConversationHistory {
  conversations: TChatConversation[];
  agents: IMyAgent[];
  isLoading: boolean;
  isLoadFailed: boolean;
  isAgentsLoading: boolean;
  isAgentsLoadFailed: boolean;
  refresh: () => Promise<void>;
  getFreshConversations: () => Promise<TChatConversation[]>;
  scopeKey: string | null;
}
