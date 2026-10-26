import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import 'virtual:uno.css';
import WindowStreamSurface, { type IWindowStreamContext } from '../../../../../packages/renderer/src/components/browser/WindowStreamSurface';

/** Actual shared component with an isolated, authenticated-worker fixture host. */
function App() {
  const [stream, setStream] = useState<IWindowStreamContext | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [isInteractive, setIsInteractive] = useState(true);
  const [isTouchDragging, setIsTouchDragging] = useState(false);
  const [zoom, setZoom] = useState<number | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void fetch('/stream-context')
      .then(async (response) => {
        if (!response.ok) throw new Error(`Context unavailable (${response.status})`);
        setStream(await response.json());
      })
      .catch((failure) => setError(String(failure)));
  }, []);
  return (
    <main style={{ height: '100vh', margin: 0, display: 'flex', flexDirection: 'column' }}>
      <header style={{ height: 40, display: 'flex', gap: 16, alignItems: 'center' }}>
        <span id='status'>{error || (isReady ? 'ready' : 'connecting')}</span>
        <label>
          Zoom{' '}
          <select aria-label='Zoom' value={zoom ?? 'fit'} onChange={(event) => setZoom(event.target.value === 'fit' ? null : Number(event.target.value))}>
            <option value='fit'>Fit</option>
            <option value='1'>100%</option>
            <option value='1.5'>150%</option>
          </select>
        </label>
        <label>
          <input aria-label='Allow checked input' type='checkbox' checked={isInteractive} onChange={(event) => setIsInteractive(event.target.checked)} />
          Input
        </label>
        <button
          aria-pressed={isTouchDragging}
          onClick={() => {
            setIsReady(false);
            setIsTouchDragging((value) => !value);
          }}
        >
          Change gesture
        </button>
      </header>
      <section style={{ position: 'relative', flex: 1, overflow: 'auto' }}>
        {stream ? (
          <WindowStreamSurface
            stream={stream}
            isInteractive={isInteractive && isReady}
            isDragSupported
            isLiveDragSupported
            isTouchDragging={isTouchDragging}
            zoom={zoom}
            label='Shared Chrome window'
            onInput={(value) => {
              return fetch('/input', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }).then(async (response) => {
                if (!response.ok) {
                  setError(`Input failed (${response.status})`);
                  throw new Error(`Input failed (${response.status})`);
                }
                const reply = await response.json();
                if (reply.session.controlEpoch !== stream.controlEpoch || reply.session.targetEpoch !== stream.targetEpoch) {
                  setIsReady(false);
                  const refreshed = await fetch('/stream-context');
                  if (!refreshed.ok) throw new Error(`Context unavailable (${refreshed.status})`);
                  setStream(await refreshed.json());
                }
              });
            }}
            onReady={() => setIsReady(true)}
            onDisconnect={() => setError('disconnected')}
          />
        ) : null}
      </section>
    </main>
  );
}

document.body.style.margin = '0';
document.documentElement.dataset.streamBoot = crypto.randomUUID();
createRoot(document.getElementById('root')!).render(<App />);
