import { hostedSessionView } from './navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { hostedTasks } from '@sudowork/host-bridge/ipcBridge';
import { addEventListener } from '@renderer/utils/emitter';
import { type ExternalConversationView } from '../external-agents/navigation';
import { sharedExternalRead } from '../external-agents/pendingReads';
import { useExternalIdentity } from '../external-agents/useExternalDirectory';

export function useHostedHistory() {
  const identity = useExternalIdentity();
  const [state, setState] = useState<{ identity: string; conversations: ExternalConversationView[]; isFailed: boolean }>({ identity: '', conversations: [], isFailed: false });
  const generation = useRef(0);
  const onRefresh = useCallback(async () => {
    const current = ++generation.current;
    if (!identity || document.hidden) return;
    try {
      const response = await sharedExternalRead(identity, 'hosted-sessions', () => hostedTasks.sessions.invoke());
      if (current !== generation.current) return;
      if (!response.success || !response.data) throw new Error('External history unavailable');
      setState({ identity, conversations: response.data.map(hostedSessionView), isFailed: false });
    } catch {
      if (current === generation.current) setState({ identity, conversations: [], isFailed: true });
    }
  }, [identity]);
  useEffect(() => {
    if (!identity) return;
    void onRefresh();
    const off = addEventListener('chat.history.refresh', () => void onRefresh());
    const timer = setInterval(() => void onRefresh(), 30_000);
    const onVisibility = () => {
      if (!document.hidden) void onRefresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      generation.current++;
      off();
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [identity, onRefresh]);
  return { ...(identity && state.identity === identity ? state : { conversations: [], isFailed: false }), onRefresh };
}
