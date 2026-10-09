/**
 * @license
 * Copyright 2026 SudoPrivacy
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import * as ipcBridge from '@sudowork/host-bridge/ipcBridge';
import { emitter } from '@renderer/utils/emitter';
import type { AgentGroup } from '../types';

type MyAgent = { ref: string; displayName: string; kind: AgentGroup['kind'] };

/**
 * The agents this person has, as the sidebar groups by.
 *
 * Deliberately not the template catalog: a template is a shared definition
 * anybody can instantiate, and one the user has never opened a session with is
 * not their agent. The server decides which is which, because only it knows
 * where each kind's name lives.
 *
 * Starts empty so the sidebar keeps showing the timeline until the list
 * arrives, rather than flashing an ungrouped one.
 */
export const useMyAgents = (): MyAgent[] => {
  const [agents, setAgents] = useState<MyAgent[]>([]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await ipcBridge.eeclaw.getMyAgents.invoke();
        if (cancelled) return;
        setAgents(res?.success && Array.isArray(res.data) ? res.data : []);
      } catch {
        // A sidebar that cannot name its groups still has to list conversations,
        // so an unreachable server leaves the timeline in place rather than
        // emptying the sidebar.
        if (!cancelled) setAgents([]);
      }
    };

    void load();
    // A new agent, or a first conversation under a template, changes this list.
    emitter.on('chat.history.refresh', load);
    return () => {
      cancelled = true;
      emitter.off('chat.history.refresh', load);
    };
  }, []);

  return agents;
};
