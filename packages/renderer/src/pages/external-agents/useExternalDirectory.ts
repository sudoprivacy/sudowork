import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExternalAgent, ExternalProviderAccess } from '@sudowork/contracts/external-provider';
import { externalProviders } from '@sudowork/host-bridge/ipcBridge';
import { useAuth } from '@renderer/context/AuthContext';
import { addEventListener } from '@renderer/utils/emitter';

export function useExternalIdentity() {
  const { user, isGuest } = useAuth();
  return !user || isGuest ? '' : `${user.id}:${user.enterprise_code || ''}`;
}

export function useExternalDirectory() {
  const identity = useExternalIdentity();
  const [state, setState] = useState<{ identity: string; agents: ExternalAgent[]; access: ExternalProviderAccess | null; isLoading: boolean; isFailed: boolean }>({ identity: '', agents: [], access: null, isLoading: true, isFailed: false });
  const generation = useRef(0);
  const onRefresh = useCallback(async () => {
    const current = ++generation.current;
    if (!identity) return;
    setState((previous) => ({ ...previous, isLoading: true }));
    const [agents, access] = await Promise.allSettled([externalProviders.agents.invoke(), externalProviders.access.invoke()]);
    if (generation.current !== current) return;
    const isAgentsValid = agents.status === 'fulfilled' && agents.value.success && Array.isArray(agents.value.data);
    setState({ identity, agents: isAgentsValid && agents.status === 'fulfilled' ? agents.value.data! : [], access: access.status === 'fulfilled' && access.value.success ? (access.value.data ?? null) : null, isLoading: false, isFailed: !isAgentsValid });
  }, [identity]);
  useEffect(() => {
    void onRefresh();
    const off = addEventListener('chat.history.refresh', () => void onRefresh());
    return () => {
      generation.current++;
      off();
    };
  }, [onRefresh]);
  return { ...(state.identity === identity && identity ? state : { agents: [], access: null, isLoading: Boolean(identity), isFailed: false }), identity, onRefresh };
}
