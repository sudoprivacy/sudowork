import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExternalAgent } from '@sudowork/contracts/external-provider';
import { externalProviders } from '@sudowork/host-bridge/ipcBridge';
import { useAuth } from '@renderer/context/AuthContext';
import { addEventListener } from '@renderer/utils/emitter';

export function useExternalIdentity() {
  const { user, isGuest } = useAuth();
  return !user || isGuest ? '' : `${user.id}:${user.enterprise_code || ''}`;
}

export function useExternalDirectory() {
  const identity = useExternalIdentity();
  const [state, setState] = useState<{ identity: string; agents: ExternalAgent[]; isLoading: boolean; isFailed: boolean }>({ identity: '', agents: [], isLoading: true, isFailed: false });
  const generation = useRef(0);
  const onRefresh = useCallback(async () => {
    const current = ++generation.current;
    if (!identity) return;
    setState((previous) => ({ ...previous, isLoading: true }));
    try {
      const result = await externalProviders.agents.invoke();
      if (generation.current !== current) return;
      if (!result.success || !Array.isArray(result.data)) throw new Error('Directory unavailable');
      setState({ identity, agents: result.data, isLoading: false, isFailed: false });
    } catch {
      if (generation.current === current) setState({ identity, agents: [], isLoading: false, isFailed: true });
    }
  }, [identity]);
  useEffect(() => {
    void onRefresh();
    const off = addEventListener('chat.history.refresh', () => void onRefresh());
    return () => {
      generation.current++;
      off();
    };
  }, [onRefresh]);
  return { ...(state.identity === identity && identity ? state : { agents: [], isLoading: Boolean(identity), isFailed: false }), identity, onRefresh };
}
