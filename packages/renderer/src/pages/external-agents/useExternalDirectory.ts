import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExternalAgent } from '@sudowork/contracts/external-provider';
import { externalProviders } from '@sudowork/host-bridge/ipcBridge';
import { useAuth } from '@renderer/context/AuthContext';
import { sharedExternalRead } from './pendingReads';
import { addEventListener } from '@renderer/utils/emitter';

export function useExternalIdentity() {
  const { user, isGuest } = useAuth();
  const authIdentity = !user || isGuest ? '' : `${user.id}:${user.enterprise_code || ''}:${Boolean(user.localAuth)}`;
  const [context, setContext] = useState({ authIdentity: '', identity: '' });
  useEffect(() => {
    let isActive = true;
    if (!authIdentity) return;
    const onCheck = (): void =>
      void sharedExternalRead(authIdentity, 'context', () => externalProviders.context.invoke())
        .then((result) => {
          if (isActive) setContext({ authIdentity, identity: result.success && result.data?.isAvailable ? result.data.identity : '' });
        })
        .catch(() => {
          if (isActive) setContext({ authIdentity, identity: '' });
        });
    onCheck();
    const onVisible = () => {
      if (!document.hidden) onCheck();
    };
    const off = addEventListener('chat.history.refresh', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      isActive = false;
      off();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [authIdentity]);
  return authIdentity && context.authIdentity === authIdentity && context.identity ? `${authIdentity}:${context.identity}` : '';
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
      const result = await sharedExternalRead(identity, 'agents', () => externalProviders.agents.invoke());
      if (generation.current !== current) return;
      if (!result.success || !Array.isArray(result.data)) throw new Error('Directory unavailable');
      setState({ identity, agents: result.data, isLoading: false, isFailed: false });
    } catch {
      if (generation.current === current) setState({ identity, agents: [], isLoading: false, isFailed: true });
    }
  }, [identity]);
  useEffect(() => {
    void onRefresh();
    const onVisible = () => {
      if (!document.hidden) void onRefresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      generation.current++;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [onRefresh]);
  return { ...(state.identity === identity && identity ? state : { agents: [], isLoading: Boolean(identity), isFailed: false }), identity, onRefresh };
}
