import { useCallback, useEffect, useRef, useState } from 'react';
import type { HostedAgent } from '@sudowork/contracts/task';
import { hostedTasks } from '@sudowork/host-bridge/ipcBridge';
import { sharedExternalRead } from '../external-agents/pendingReads';
import { useExternalIdentity } from '../external-agents/useExternalDirectory';

export function useHostedDirectory() {
  const identity = useExternalIdentity();
  const [state, setState] = useState<{ identity: string; agents: HostedAgent[]; isLoading: boolean; isFailed: boolean }>({ identity: '', agents: [], isLoading: true, isFailed: false });
  const generation = useRef(0);
  const onRefresh = useCallback(async () => {
    const current = ++generation.current;
    if (!identity) return;
    setState((previous) => ({ ...previous, isLoading: true }));
    try {
      const result = await sharedExternalRead(identity, 'hosted-agents', () => hostedTasks.agents.invoke());
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
    window.addEventListener('expert-library-refresh', onVisible);
    return () => {
      generation.current++;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('expert-library-refresh', onVisible);
    };
  }, [onRefresh]);
  return { ...(state.identity === identity && identity ? state : { agents: [], isLoading: Boolean(identity), isFailed: false }), identity, onRefresh };
}
