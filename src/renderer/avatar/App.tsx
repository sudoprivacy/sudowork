/**
 * @license
 * Copyright 2025 Sudowork (sudowork.ai)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';

/**
 * Avatar root component — MVP-0 placeholder orb with a 3-state FSM driven
 * by the ACP response stream forwarded over the dedicated avatar:bridge
 * channel.
 *
 * State machine (MVP-0 simplified — MVP-1 expands to 7 states):
 *   - idle      Initial state; resumed 1s after a 'finish' event
 *   - thinking  Entered on 'start' / 'thought' / 'content' / 'tool_call'
 *               / 'acp_tool_call'
 *   - error     Entered on 'error'; sticks until the next 'start'
 *
 * Visual differentiation lives in CSS classes (.orb-idle / .orb-thinking
 * / .orb-error). Transitions are <150ms.
 */

type AvatarFsmState = 'idle' | 'thinking' | 'error';

const FINISH_TO_IDLE_DEBOUNCE_MS = 1000;

/**
 * Minimal subset of ACP IResponseMessage shape this renderer cares about.
 * The full type lives in src/common/ipcBridge.ts and is intentionally NOT
 * imported here to keep the avatar renderer bundle lean and decoupled from
 * the main renderer's typings.
 */
type AcpResponseMessage = {
  type: string;
};

const isAcpResponseMessage = (data: unknown): data is AcpResponseMessage => {
  return typeof data === 'object' && data !== null && 'type' in data && typeof (data as { type: unknown }).type === 'string';
};

const App: React.FC = () => {
  const [fsmState, setFsmState] = useState<AvatarFsmState>('idle');

  useEffect(() => {
    const api = window.avatarApi;
    if (!api) {
      console.warn('[Avatar] window.avatarApi missing; preload may not be wired');
      return;
    }

    let finishDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    const clearDebounce = (): void => {
      if (finishDebounceTimer !== null) {
        clearTimeout(finishDebounceTimer);
        finishDebounceTimer = null;
      }
    };

    const unsubscribe = api.onBridge((msg) => {
      if (msg.name !== 'chat.response.stream') return;
      if (!isAcpResponseMessage(msg.data)) return;

      const eventType = msg.data.type;
      switch (eventType) {
        case 'start':
        case 'thought':
        case 'content':
        case 'tool_call':
        case 'acp_tool_call':
          clearDebounce();
          setFsmState('thinking');
          break;
        case 'finish':
          clearDebounce();
          finishDebounceTimer = setTimeout(() => {
            setFsmState('idle');
            finishDebounceTimer = null;
          }, FINISH_TO_IDLE_DEBOUNCE_MS);
          break;
        case 'error':
          clearDebounce();
          setFsmState('error');
          break;
        default:
          break;
      }
    });

    return () => {
      clearDebounce();
      unsubscribe();
    };
  }, []);

  return (
    <div className='orb-container'>
      <div className={`orb orb-${fsmState}`} data-state={fsmState} />
    </div>
  );
};

export default App;
