import { useCallback, useEffect, useRef, useState } from 'react';
import { externalProviders } from '@sudowork/host-bridge/ipcBridge';
import { addEventListener } from '@renderer/utils/emitter';
import { externalSessionView, type ExternalConversationView } from './navigation';
import { useExternalIdentity } from './useExternalDirectory';

export function useExternalHistory() {
  const identity = useExternalIdentity();
  const [state, setState] = useState<{ identity: string; conversations: ExternalConversationView[]; isFailed: boolean }>({ identity: '', conversations: [], isFailed: false });
  const generation = useRef(0);
  const onRefresh = useCallback(async () => {
    const current = ++generation.current;
    if (!identity) return;
    try {
      const response = await externalProviders.sessions.invoke();
      if (current !== generation.current) return;
      if (!response.success || !response.data) throw new Error('External history unavailable');
      setState({ identity, conversations: response.data.map(externalSessionView), isFailed: false });
    } catch {
      if (current === generation.current) setState({ identity, conversations: [], isFailed: true });
    }
  }, [identity]);
  useEffect(() => {
    if (!identity) return;
    void onRefresh();
    const off = addEventListener('chat.history.refresh', () => void onRefresh());
    const timer = setInterval(() => void onRefresh(), 30_000);
    return () => {
      generation.current++;
      off();
      clearInterval(timer);
    };
  }, [identity, onRefresh]);
  return { ...(identity && state.identity === identity ? state : { conversations: [], isFailed: false }), onRefresh };
}
