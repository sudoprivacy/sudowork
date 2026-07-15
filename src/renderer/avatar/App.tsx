import React, { useEffect, useState } from 'react';
import staticLogo from '../assets/sudowork-icon-dark.svg';
import thinkingGif from '../assets/sudoclaw_transparent_large.gif';

type AvatarFsmState = 'idle' | 'thinking' | 'error';

const FINISH_TO_IDLE_DEBOUNCE_MS = 1000;

type AcpResponseMessage = { type: string };

const isAcpResponseMessage = (data: unknown): data is AcpResponseMessage => typeof data === 'object' && data !== null && 'type' in data && typeof (data as { type: unknown }).type === 'string';

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

      switch (msg.data.type) {
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
      }
    });

    return () => {
      clearDebounce();
      unsubscribe();
    };
  }, []);

  const isThinking = fsmState === 'thinking';

  return (
    <div className='avatar-container'>
      <div className={`avatar-wrapper avatar-wrapper--${fsmState}`}>
        {/* 粒子环绕 — 外圈顺时针 + 内圈逆时针 */}
        {
          <>
            <div className='avatar-particles avatar-particles--outer'>
              <span className='avatar-particle p1' />
              <span className='avatar-particle p2' />
              <span className='avatar-particle p3' />
              <span className='avatar-particle p4' />
              <span className='avatar-particle p5' />
              <span className='avatar-particle p6' />
              <span className='avatar-particle p7' />
              <span className='avatar-particle p8' />
            </div>
            <div className='avatar-particles avatar-particles--inner'>
              <span className='avatar-particle q1' />
              <span className='avatar-particle q2' />
              <span className='avatar-particle q3' />
              <span className='avatar-particle q4' />
              <span className='avatar-particle q5' />
            </div>
          </>
        }

        {/* 拖尾残影 */}
        {isThinking ? (
          <>
            <img src={thinkingGif} alt='' className='avatar-trail avatar-trail--gif trail-3' draggable={false} />
            <img src={thinkingGif} alt='' className='avatar-trail avatar-trail--gif trail-2' draggable={false} />
            <img src={thinkingGif} alt='' className='avatar-trail avatar-trail--gif trail-1' draggable={false} />
          </>
        ) : (
          <>
            <img src={staticLogo} alt='' className='avatar-trail trail-3' draggable={false} />
            <img src={staticLogo} alt='' className='avatar-trail trail-2' draggable={false} />
            <img src={staticLogo} alt='' className='avatar-trail trail-1' draggable={false} />
          </>
        )}

        {/* 主 logo */}
        <img src={isThinking ? thinkingGif : staticLogo} alt='avatar' className={`avatar-img${isThinking ? ' avatar-img--thinking' : ' avatar-img--static'}`} draggable={false} />
      </div>
    </div>
  );
};

export default App;
